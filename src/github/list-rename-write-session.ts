import type {WriteAuthStore} from '../auth/write-store'
import type {GitHubUserId, NativeListNodeId} from '../domain/types'
import {AppFailure, githubHttpFailure} from '../shared/errors'

const graphqlUrl = 'https://api.github.com/graphql'
const apiVersion = '2026-03-10'
const requiredScope = 'user'
const updateUserListDocument = `mutation UpdateUserList($listId: ID!, $name: String!) {
  updateUserList(input: {listId: $listId, name: $name}) {
    list { id name }
  }
}`

export interface ListRenameMutationRequest {
  readonly expectedGitHubUserId: GitHubUserId
  readonly listNodeId: NativeListNodeId
  readonly name: string
}

export interface ListRenameMutationResult {
  readonly listNodeId: NativeListNodeId
  readonly name: string
}

export type ListRenameMutationFailureReason =
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

export class ListRenameMutationFailure extends AppFailure {
  readonly reason: ListRenameMutationFailureReason

  constructor(
    reason: ListRenameMutationFailureReason,
    publicError: ConstructorParameters<typeof AppFailure>[0]
  ) {
    super(publicError)
    this.name = 'ListRenameMutationFailure'
    this.reason = reason
  }
}

export interface ListRenameOwnerStore {
  loadActive(): Promise<{
    readonly githubUserId: GitHubUserId
    readonly identity: {readonly githubUserId: GitHubUserId}
  } | null>
}

export type ListRenameWriteStore = Pick<
  WriteAuthStore,
  'loadAccount' | 'deleteAccount'
>

export interface ListRenameWriteSessionOptions {
  readonly authStore: ListRenameOwnerStore
  readonly writeStore: ListRenameWriteStore
  readonly fetch?: RenameFetch
}

export class ListRenameWriteSession {
  readonly #authStore: ListRenameOwnerStore
  readonly #writeStore: ListRenameWriteStore
  readonly #fetch: RenameFetch

  constructor(options: ListRenameWriteSessionOptions) {
    this.#authStore = options.authStore
    this.#writeStore = options.writeStore
    this.#fetch = options.fetch ?? globalThis.fetch
  }

  async rename(request: ListRenameMutationRequest): Promise<ListRenameMutationResult> {
    const canonicalRequest = validateRequest(request)

    await assertActiveOwner(this.#authStore, canonicalRequest.expectedGitHubUserId)

    const writeState = await this.#writeStore.loadAccount(
      canonicalRequest.expectedGitHubUserId
    )
    if (!writeState) {
      throw failure(
        'authorization-required',
        'authentication',
        'Authorize GitHub write access before renaming a native List.',
        false
      )
    }
    if (
      writeState.githubUserId !== canonicalRequest.expectedGitHubUserId ||
      writeState.identity.githubUserId !== canonicalRequest.expectedGitHubUserId
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
        'Native List rename requires same-account authorization with the user scope.',
        false
      )
    }

    await assertActiveOwner(this.#authStore, canonicalRequest.expectedGitHubUserId)

    const headers = new Headers({
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${writeState.credential.accessToken}`,
      'content-type': 'application/json',
      'x-github-api-version': apiVersion
    })
    let response: Response
    try {
      const send = this.#fetch
      response = await send(graphqlUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          query: updateUserListDocument,
          variables: {
            listId: canonicalRequest.listNodeId,
            name: canonicalRequest.name
          }
        })
      })
    } catch {
      throw failure(
        'network-ambiguous',
        'network',
        'The native List rename may have been sent, but GitHub did not return a response.',
        true
      )
    }

    if (!response.ok) {
      if (response.status === 401) {
        await this.#writeStore.deleteAccount(canonicalRequest.expectedGitHubUserId)
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
          'GitHub rate-limited the native List rename.'
        )
      }
      if (response.status === 403) {
        throw responseFailure(
          'permission',
          response,
          'GitHub denied native List rename permission.'
        )
      }
      if (response.status === 400 || response.status === 404) {
        throw responseFailure(
          'schema-unavailable',
          response,
          'GitHub does not expose the required native List rename mutation.'
        )
      }
      if (response.status === 422) {
        throw responseFailure(
          'invalid-identifiers',
          response,
          'GitHub rejected the native List identifier.'
        )
      }
      throw responseFailure(
        'server',
        response,
        'GitHub could not complete the native List rename.'
      )
    }

    const value = await readJson(response)
    const graphqlReason = classifyGraphqlErrors(value)
    if (graphqlReason) throw graphqlFailure(graphqlReason)

    try {
      return decodeRenamedList(value)
    } catch {
      throw failure(
        'malformed-response',
        'validation',
        'GitHub returned a malformed native List rename response.',
        false
      )
    }
  }
}

async function assertActiveOwner(
  authStore: ListRenameOwnerStore,
  expectedGitHubUserId: GitHubUserId
): Promise<void> {
  const active = await authStore.loadActive()
  if (
    active?.githubUserId !== expectedGitHubUserId ||
    active.identity.githubUserId !== expectedGitHubUserId
  ) {
    throw failure(
      'account-changed',
      'authentication',
      'The active GitHub account changed. Retry the native List rename.',
      true
    )
  }
}

function validateRequest(request: ListRenameMutationRequest): ListRenameMutationRequest {
  const record = asRecord(request)
  const allowedKeys = new Set(['expectedGitHubUserId', 'listNodeId', 'name'])
  if (
    !record ||
    Reflect.ownKeys(record).some((key) => typeof key !== 'string' || !allowedKeys.has(key))
  ) {
    throw failure(
      'invalid-request',
      'validation',
      'Native List rename accepts only account, List ID, and name.',
      false
    )
  }
  if (!isIdentifierValue(record.expectedGitHubUserId)) {
    throw failure(
      'invalid-request',
      'validation',
      'An expected GitHub account is required.',
      false
    )
  }
  if (!isIdentifierValue(record.listNodeId)) {
    throw failure(
      'invalid-request',
      'validation',
      'A native List node ID is required.',
      false
    )
  }
  if (typeof record.name !== 'string') {
    throw failure(
      'invalid-request',
      'validation',
      'A native List name is required.',
      false
    )
  }
  const name = record.name.normalize('NFKC').trim()
  if (name.length === 0) {
    throw failure(
      'invalid-request',
      'validation',
      'A native List name is required.',
      false
    )
  }
  return {
    expectedGitHubUserId: record.expectedGitHubUserId,
    listNodeId: record.listNodeId,
    name
  }
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return (await response.json()) as unknown
  } catch {
    throw failure(
      'malformed-response',
      'validation',
      'GitHub returned malformed JSON for the native List rename.',
      false
    )
  }
}

function classifyGraphqlErrors(
  value: unknown
): Exclude<
  ListRenameMutationFailureReason,
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
      'GitHub returned a malformed native List rename response.',
      false
    )
  }

  const descriptors = root.errors.map((error) => {
    const record = asRecord(error)
    if (!record) {
      throw failure(
        'malformed-response',
        'validation',
        'GitHub returned a malformed native List rename response.',
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

function decodeRenamedList(value: unknown): ListRenameMutationResult {
  const root = requireRecord(value)
  if (root.errors !== undefined) throw new Error('GraphQL errors were present.')
  const data = requireRecord(root.data)
  const payload = requireRecord(data.updateUserList)
  const list = requireRecord(payload.list)
  if (!isIdentifierValue(list.id) || typeof list.name !== 'string') {
    throw new Error('Renamed List payload was invalid.')
  }
  const name = list.name.normalize('NFKC').trim()
  if (name.length === 0) throw new Error('Renamed List name was invalid.')
  return {listNodeId: list.id, name}
}

function isIdentifierValue(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.trim() === value
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
): ListRenameMutationFailure {
  switch (reason) {
    case 'schema-unavailable':
      return failure(reason, 'unsupported', 'GitHub does not expose the required native List rename mutation.', false)
    case 'permission':
      return failure(reason, 'permission', 'GitHub denied native List rename permission.', false)
    case 'invalid-identifiers':
      return failure(reason, 'validation', 'GitHub rejected the native List identifier.', false)
    case 'rate-limit':
      return failure(reason, 'rate-limit', 'GitHub rate-limited the native List rename.', true)
    case 'server':
      return failure(reason, 'network', 'GitHub could not complete the native List rename.', true)
  }
}

function responseFailure(
  reason: ListRenameMutationFailureReason,
  response: Response,
  message: string
): ListRenameMutationFailure {
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
  return new ListRenameMutationFailure(reason, {
    ...httpError,
    category,
    message,
    retryable: reason === 'rate-limit' || reason === 'server'
  })
}

function failure(
  reason: ListRenameMutationFailureReason,
  category: ConstructorParameters<typeof AppFailure>[0]['category'],
  message: string,
  retryable: boolean
): ListRenameMutationFailure {
  return new ListRenameMutationFailure(reason, {category, message, retryable})
}

type RenameFetch = (
  input: RequestInfo | URL,
  init?: RequestInit
) => Promise<Response>
