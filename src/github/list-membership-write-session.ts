import type {WriteAuthStore} from '../auth/write-store'
import type {
  GitHubUserId,
  NativeListNodeId,
  RepositoryNodeId
} from '../domain/types'
import {AppFailure, githubHttpFailure} from '../shared/errors'

const graphqlUrl = 'https://api.github.com/graphql'
const apiVersion = '2026-03-10'
const requiredScope = 'user'
const updateMembershipsDocument = `mutation UpdateUserListsForItem($itemId: ID!, $listIds: [ID!]!) {
  updateUserListsForItem(input: {itemId: $itemId, listIds: $listIds}) {
    lists { id }
  }
}`

export interface ListMembershipMutationRequest {
  readonly expectedGitHubUserId: GitHubUserId
  readonly repositoryNodeId: RepositoryNodeId
  readonly completeListIds: readonly NativeListNodeId[]
}

export interface ListMembershipMutationResult {
  readonly updatedListIds: readonly NativeListNodeId[]
}

export type ListMembershipMutationFailureReason =
  | 'invalid-request'
  | 'account-changed'
  | 'authorization-required'
  | 'authorization-mismatch'
  | 'scope-denied'
  | 'credential-rejected'
  | 'schema-unavailable'
  | 'permission'
  | 'invalid-identifiers'
  | 'rate-limit'
  | 'server'
  | 'network-ambiguous'
  | 'malformed-response'

export class ListMembershipMutationFailure extends AppFailure {
  readonly reason: ListMembershipMutationFailureReason

  constructor(
    reason: ListMembershipMutationFailureReason,
    publicError: ConstructorParameters<typeof AppFailure>[0]
  ) {
    super(publicError)
    this.name = 'ListMembershipMutationFailure'
    this.reason = reason
  }
}

export interface ListMembershipOwnerStore {
  loadActive(): Promise<{
    readonly githubUserId: GitHubUserId
    readonly identity: {readonly githubUserId: GitHubUserId}
  } | null>
}

export type ListMembershipWriteStore = Pick<
  WriteAuthStore,
  'loadAccount' | 'deleteAccount'
>

export interface ListMembershipWriteSessionOptions {
  readonly authStore: ListMembershipOwnerStore
  readonly writeStore: ListMembershipWriteStore
  readonly fetch?: MembershipFetch
}

export class ListMembershipWriteSession {
  readonly #authStore: ListMembershipOwnerStore
  readonly #writeStore: ListMembershipWriteStore
  readonly #fetch: MembershipFetch

  constructor(options: ListMembershipWriteSessionOptions) {
    this.#authStore = options.authStore
    this.#writeStore = options.writeStore
    this.#fetch = options.fetch ?? globalThis.fetch
  }

  async updateMemberships(
    request: ListMembershipMutationRequest
  ): Promise<ListMembershipMutationResult> {
    validateRequest(request)

    const active = await this.#authStore.loadActive()
    if (
      active?.githubUserId !== request.expectedGitHubUserId ||
      active.identity.githubUserId !== request.expectedGitHubUserId
    ) {
      throw failure(
        'account-changed',
        'authentication',
        'The active GitHub account changed. Retry the native List action.',
        true
      )
    }

    const writeState = await this.#writeStore.loadAccount(
      request.expectedGitHubUserId
    )
    if (!writeState) {
      throw failure(
        'authorization-required',
        'authentication',
        'Authorize GitHub write access before changing native List membership.',
        false
      )
    }
    if (
      writeState.githubUserId !== request.expectedGitHubUserId ||
      writeState.identity.githubUserId !== request.expectedGitHubUserId
    ) {
      throw failure(
        'authorization-mismatch',
        'authentication',
        'GitHub write authorization does not match the active account.',
        false
      )
    }
    if (
      writeState.credential.tokenType !== 'bearer' ||
      !writeState.credential.accessToken ||
      !writeState.credential.grantedScopes.includes(requiredScope)
    ) {
      throw failure(
        'scope-denied',
        'permission',
        'Native List membership requires same-account authorization with the user scope.',
        false
      )
    }

    const headers = new Headers({
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${writeState.credential.accessToken}`,
      'content-type': 'application/json',
      'x-github-api-version': apiVersion
    })
    let response: Response
    try {
      // Native fetch implementations must be invoked without the session as receiver.
      const send = this.#fetch
      response = await send(graphqlUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          query: updateMembershipsDocument,
          variables: {
            itemId: request.repositoryNodeId,
            listIds: request.completeListIds
          }
        })
      })
    } catch {
      throw failure(
        'network-ambiguous',
        'network',
        'The native List mutation may have been sent, but GitHub did not return a response.',
        true
      )
    }

    if (!response.ok) {
      if (response.status === 401) {
        await this.#writeStore.deleteAccount(request.expectedGitHubUserId)
        throw responseFailure(
          'credential-rejected',
          response,
          'GitHub rejected the write credential. Reauthorize write access.'
        )
      }
      if (
        response.status === 429 ||
        (response.status === 403 &&
          response.headers.get('x-ratelimit-remaining') === '0')
      ) {
        throw responseFailure(
          'rate-limit',
          response,
          'GitHub rate-limited the native List mutation.'
        )
      }
      if (response.status === 403) {
        throw responseFailure(
          'permission',
          response,
          'GitHub denied native List membership permission.'
        )
      }
      if (response.status === 400 || response.status === 404) {
        throw responseFailure(
          'schema-unavailable',
          response,
          'GitHub does not expose the required native List mutation.'
        )
      }
      if (response.status === 422) {
        throw responseFailure(
          'invalid-identifiers',
          response,
          'GitHub rejected the repository or native List identifiers.'
        )
      }
      throw responseFailure(
        'server',
        response,
        'GitHub could not complete the native List mutation.'
      )
    }

    const value = await readJson(response)
    const graphqlReason = classifyGraphqlErrors(value)
    if (graphqlReason) throw graphqlFailure(graphqlReason)

    try {
      return {updatedListIds: decodeUpdatedListIds(value)}
    } catch {
      throw failure(
        'malformed-response',
        'validation',
        'GitHub returned a malformed native List mutation response.',
        false
      )
    }
  }
}

function validateRequest(request: ListMembershipMutationRequest): void {
  const allowedKeys = new Set([
    'expectedGitHubUserId',
    'repositoryNodeId',
    'completeListIds'
  ])
  if (Object.keys(request).some((key) => !allowedKeys.has(key))) {
    throw failure(
      'invalid-request',
      'validation',
      'Native List mutations accept only account, repository, and complete List IDs.',
      false
    )
  }
  if (!isIdentifier(request.expectedGitHubUserId)) {
    throw failure(
      'invalid-request',
      'validation',
      'An expected GitHub account is required.',
      false
    )
  }
  if (!isIdentifier(request.repositoryNodeId)) {
    throw failure(
      'invalid-request',
      'validation',
      'A repository node ID is required.',
      false
    )
  }
  if (
    !Array.isArray(request.completeListIds) ||
    request.completeListIds.some((id) => !isIdentifier(id)) ||
    request.completeListIds.some(
      (id, index) => index > 0 && id <= (request.completeListIds[index - 1] ?? '')
    )
  ) {
    throw failure(
      'invalid-request',
      'validation',
      'Complete native List IDs must be unique and in canonical order.',
      false
    )
  }
}

function isIdentifier(value: string): boolean {
  return value.length > 0 && value.trim() === value
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return (await response.json()) as unknown
  } catch {
    throw failure(
      'malformed-response',
      'validation',
      'GitHub returned malformed JSON for the native List mutation.',
      false
    )
  }
}

function classifyGraphqlErrors(
  value: unknown
): Exclude<
  ListMembershipMutationFailureReason,
  | 'invalid-request'
  | 'account-changed'
  | 'authorization-required'
  | 'authorization-mismatch'
  | 'scope-denied'
  | 'credential-rejected'
  | 'network-ambiguous'
  | 'malformed-response'
> | null {
  const root = asRecord(value)
  if (!root || root.errors === undefined) return null
  if (!Array.isArray(root.errors) || root.errors.length === 0) {
    throw failure(
      'malformed-response',
      'validation',
      'GitHub returned a malformed native List mutation response.',
      false
    )
  }

  const descriptors = root.errors.map((error) => {
    const record = asRecord(error)
    if (!record) {
      throw failure(
        'malformed-response',
        'validation',
        'GitHub returned a malformed native List mutation response.',
        false
      )
    }
    const extensions = asRecord(record.extensions)
    return [record.type, extensions?.type, extensions?.code, record.message]
      .filter((part): part is string => typeof part === 'string')
      .join(' ')
      .toLowerCase()
  })
  const combined = descriptors.join(' ')
  if (/rate.?limit|rate_limited/.test(combined)) return 'rate-limit'
  if (/forbidden|permission|insufficient|resource not accessible/.test(combined)) {
    return 'permission'
  }
  if (/not.?found|unprocessable|could not resolve|invalid.?id/.test(combined)) {
    return 'invalid-identifiers'
  }
  if (/graphql_validation|validation_failed|undefined field|doesn.t exist/.test(combined)) {
    return 'schema-unavailable'
  }
  return 'server'
}

function decodeUpdatedListIds(value: unknown): readonly NativeListNodeId[] {
  const root = requireRecord(value)
  if (root.errors !== undefined) throw new Error('GraphQL errors were present.')
  const data = requireRecord(root.data)
  const payload = requireRecord(data.updateUserListsForItem)
  if (!Array.isArray(payload.lists)) throw new Error('List payload was absent.')
  const listIds = payload.lists.map((list) => {
    const id = requireRecord(list).id
    if (!isIdentifierValue(id)) throw new Error('List ID was invalid.')
    return id
  })
  const canonical = [...listIds].sort()
  if (new Set(canonical).size !== canonical.length) {
    throw new Error('List IDs were duplicated.')
  }
  return canonical
}

function isIdentifierValue(value: unknown): value is string {
  return typeof value === 'string' && isIdentifier(value)
}

function requireRecord(value: unknown): Readonly<Record<string, unknown>> {
  const record = asRecord(value)
  if (!record) throw new Error('Expected a record.')
  return record
}

function asRecord(value: unknown): Readonly<Record<string, unknown>> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : null
}

function graphqlFailure(
  reason: 'schema-unavailable' | 'permission' | 'invalid-identifiers' | 'rate-limit' | 'server'
): ListMembershipMutationFailure {
  switch (reason) {
    case 'schema-unavailable':
      return failure(reason, 'unsupported', 'GitHub does not expose the required native List mutation.', false)
    case 'permission':
      return failure(reason, 'permission', 'GitHub denied native List membership permission.', false)
    case 'invalid-identifiers':
      return failure(reason, 'validation', 'GitHub rejected the repository or native List identifiers.', false)
    case 'rate-limit':
      return failure(reason, 'rate-limit', 'GitHub rate-limited the native List mutation.', true)
    case 'server':
      return failure(reason, 'network', 'GitHub could not complete the native List mutation.', true)
  }
}

function responseFailure(
  reason: ListMembershipMutationFailureReason,
  response: Response,
  message: string
): ListMembershipMutationFailure {
  const httpError = githubHttpFailure(response, message).publicError
  const category =
    reason === 'credential-rejected'
      ? 'authentication'
      : reason === 'schema-unavailable'
        ? 'unsupported'
        : reason === 'permission'
          ? 'permission'
          : reason === 'invalid-identifiers'
            ? 'validation'
            : reason === 'rate-limit'
              ? 'rate-limit'
              : 'network'
  return new ListMembershipMutationFailure(reason, {
    ...httpError,
    category,
    message,
    retryable: reason === 'rate-limit' || reason === 'server'
  })
}

function failure(
  reason: ListMembershipMutationFailureReason,
  category: ConstructorParameters<typeof AppFailure>[0]['category'],
  message: string,
  retryable: boolean
): ListMembershipMutationFailure {
  return new ListMembershipMutationFailure(reason, {category, message, retryable})
}

type MembershipFetch = (
  input: RequestInfo | URL,
  init?: RequestInit
) => Promise<Response>
