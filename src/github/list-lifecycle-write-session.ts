import type {WriteAuthStore} from '../auth/write-store'
import type {GitHubUserId, NativeListNodeId, NativeListVisibility} from '../domain/types'
import {AppFailure, githubHttpFailure} from '../shared/errors'

const graphqlUrl = 'https://api.github.com/graphql'
const apiVersion = '2026-03-10'
const requiredScope = 'user'
const createListDocument = `mutation CreateUserList($name: String!, $isPrivate: Boolean!) {
  createUserList(input: {name: $name, isPrivate: $isPrivate}) {
    list { id name isPrivate }
  }
}`
const deleteListDocument = `mutation DeleteUserList($listId: ID!) {
  deleteUserList(input: {listId: $listId}) {
    clientMutationId
  }
}`

export interface CreateNativeListRequest {
  readonly expectedGitHubUserId: GitHubUserId
  readonly name: string
  readonly visibility: Exclude<NativeListVisibility, 'unknown'>
}

export interface DeleteNativeListRequest {
  readonly expectedGitHubUserId: GitHubUserId
  readonly listNodeId: NativeListNodeId
}

export interface CreatedNativeList {
  readonly listNodeId: NativeListNodeId
  readonly name: string
  readonly visibility: Exclude<NativeListVisibility, 'unknown'>
}

export type ListLifecycleMutationFailureReason =
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

export class ListLifecycleMutationFailure extends AppFailure {
  readonly reason: ListLifecycleMutationFailureReason

  constructor(
    reason: ListLifecycleMutationFailureReason,
    publicError: ConstructorParameters<typeof AppFailure>[0]
  ) {
    super(publicError)
    this.name = 'ListLifecycleMutationFailure'
    this.reason = reason
  }
}

export interface ListLifecycleOwnerStore {
  loadActive(): Promise<{
    readonly githubUserId: GitHubUserId
    readonly identity: {readonly githubUserId: GitHubUserId}
  } | null>
}

export type ListLifecycleWriteStore = Pick<WriteAuthStore, 'loadAccount' | 'deleteAccount'>
type LifecycleFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

export class ListLifecycleWriteSession {
  readonly #authStore: ListLifecycleOwnerStore
  readonly #writeStore: ListLifecycleWriteStore
  readonly #fetch: LifecycleFetch

  constructor(options: {
    readonly authStore: ListLifecycleOwnerStore
    readonly writeStore: ListLifecycleWriteStore
    readonly fetch?: LifecycleFetch
  }) {
    this.#authStore = options.authStore
    this.#writeStore = options.writeStore
    this.#fetch = options.fetch ?? globalThis.fetch
  }

  async createList(request: CreateNativeListRequest): Promise<CreatedNativeList> {
    const normalized = validateCreateRequest(request)
    const value = await this.#execute(request.expectedGitHubUserId, createListDocument, {
      name: normalized.name,
      isPrivate: normalized.visibility === 'private'
    })
    try {
      const root = record(value)
      const payload = record(record(root.data).createUserList)
      const list = record(payload.list)
      const id = identifier(list.id)
      const name = list.name
      const isPrivate = list.isPrivate
      if (!id || typeof name !== 'string' || name !== normalized.name || typeof isPrivate !== 'boolean') {
        throw new Error('invalid create payload')
      }
      return {listNodeId: id, name, visibility: isPrivate ? 'private' : 'public'}
    } catch {
      throw failure('malformed-response', 'validation', 'GitHub returned a malformed native List creation response.', false)
    }
  }

  async deleteList(request: DeleteNativeListRequest): Promise<void> {
    validateDeleteRequest(request)
    const value = await this.#execute(request.expectedGitHubUserId, deleteListDocument, {
      listId: request.listNodeId
    })
    try {
      const root = record(value)
      const payload = record(record(root.data).deleteUserList)
      if (!Object.hasOwn(payload, 'clientMutationId')) throw new Error('invalid delete payload')
    } catch {
      throw failure('malformed-response', 'validation', 'GitHub returned a malformed native List deletion response.', false)
    }
  }

  async #execute(
    expectedGitHubUserId: GitHubUserId,
    query: string,
    variables: Readonly<Record<string, unknown>>
  ): Promise<unknown> {
    if (!identifier(expectedGitHubUserId)) {
      throw failure('invalid-request', 'validation', 'An expected GitHub account is required.', false)
    }
    const active = await this.#authStore.loadActive()
    if (active?.githubUserId !== expectedGitHubUserId || active.identity.githubUserId !== expectedGitHubUserId) {
      throw failure('account-changed', 'authentication', 'The active GitHub account changed. Retry the native List action.', true)
    }
    const writeState = await this.#writeStore.loadAccount(expectedGitHubUserId)
    if (!writeState) {
      throw failure('authorization-required', 'authentication', 'Authorize GitHub write access before changing native Lists.', false)
    }
    if (writeState.githubUserId !== expectedGitHubUserId || writeState.identity.githubUserId !== expectedGitHubUserId) {
      throw failure('authorization-mismatch', 'authentication', 'GitHub write authorization does not match the active account.', false)
    }
    if (writeState.credential.tokenType !== 'bearer' || !writeState.credential.accessToken || !writeState.credential.grantedScopes.includes(requiredScope)) {
      throw failure('scope-denied', 'permission', 'Native List lifecycle requires same-account authorization with the user scope.', false)
    }

    let response: Response
    try {
      const send = this.#fetch
      response = await send(graphqlUrl, {
        method: 'POST',
        headers: new Headers({
          accept: 'application/vnd.github+json',
          authorization: `Bearer ${writeState.credential.accessToken}`,
          'content-type': 'application/json',
          'x-github-api-version': apiVersion
        }),
        body: JSON.stringify({query, variables})
      })
    } catch {
      throw failure('network-ambiguous', 'network', 'The native List request may have been sent, but GitHub did not return a response.', true)
    }
    if (!response.ok) throw await responseFailure(response, expectedGitHubUserId, this.#writeStore)
    let value: unknown
    try { value = await response.json() } catch {
      throw failure('malformed-response', 'validation', 'GitHub returned malformed JSON for the native List request.', false)
    }
    const reason = graphqlFailureReason(value)
    if (reason) throw graphqlFailure(reason)
    return value
  }
}

function validateCreateRequest(request: CreateNativeListRequest): {name: string; visibility: Exclude<NativeListVisibility, 'unknown'>} {
  if (!onlyKeys(request, ['expectedGitHubUserId', 'name', 'visibility']) || typeof request.name !== 'string') {
    throw failure('invalid-request', 'validation', 'Native List creation accepts only account, name, and visibility.', false)
  }
  const name = request.name.trim()
  if (!name || name.length > 255 || !['public', 'private'].includes(request.visibility)) {
    throw failure('invalid-request', 'validation', 'A trimmed non-empty native List name and explicit visibility are required.', false)
  }
  return {name, visibility: request.visibility}
}

function validateDeleteRequest(request: DeleteNativeListRequest): void {
  if (!onlyKeys(request, ['expectedGitHubUserId', 'listNodeId']) || !identifier(request.listNodeId)) {
    throw failure('invalid-request', 'validation', 'Native List deletion accepts only an account and stable List ID.', false)
  }
}

function onlyKeys(value: object, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key))
}
function identifier(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 && value.trim() === value ? value : null
}
function record(value: unknown): Readonly<Record<string, unknown>> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('expected record')
  return value as Readonly<Record<string, unknown>>
}
function graphqlFailureReason(value: unknown): Exclude<ListLifecycleMutationFailureReason, 'invalid-request' | 'account-changed' | 'authorization-required' | 'authorization-mismatch' | 'scope-denied' | 'credential-rejected' | 'network-ambiguous' | 'malformed-response'> | null {
  const root = record(value)
  if (root.errors === undefined) return null
  if (!Array.isArray(root.errors) || root.errors.length === 0) return 'server'
  const text = root.errors.map((entry) => JSON.stringify(entry).toLowerCase()).join(' ')
  if (/rate.?limit|rate_limited/.test(text)) return 'rate-limit'
  if (/forbidden|permission|insufficient/.test(text)) return 'permission'
  if (/not.?found|unprocessable|invalid.?id/.test(text)) return 'invalid-identifiers'
  if (/graphql_validation|undefined field|doesn.t exist/.test(text)) return 'schema-unavailable'
  return 'server'
}
async function responseFailure(response: Response, githubUserId: GitHubUserId, store: ListLifecycleWriteStore): Promise<ListLifecycleMutationFailure> {
  if (response.status === 401) {
    await store.deleteAccount(githubUserId)
    return failure('credential-rejected', 'authentication', 'GitHub rejected the write credential. Reauthorize write access.', false, response)
  }
  if (response.status === 400 || response.status === 404) return failure('schema-unavailable', 'unsupported', 'GitHub does not expose the required native List mutation.', false, response)
  if (response.status === 422) return failure('invalid-identifiers', 'validation', 'GitHub rejected the native List identifier.', false, response)
  if (response.status === 403 && response.headers.get('x-ratelimit-remaining') !== '0') return failure('permission', 'permission', 'GitHub denied native List lifecycle permission.', false, response)
  if (response.status === 429 || response.status === 403) return failure('rate-limit', 'rate-limit', 'GitHub rate-limited the native List request.', true, response)
  return failure('server', 'network', 'GitHub could not complete the native List request.', true, response)
}
function graphqlFailure(reason: Exclude<ListLifecycleMutationFailureReason, 'invalid-request' | 'account-changed' | 'authorization-required' | 'authorization-mismatch' | 'scope-denied' | 'credential-rejected' | 'network-ambiguous' | 'malformed-response'>): ListLifecycleMutationFailure {
  const entries = {
    'schema-unavailable': ['unsupported', 'GitHub does not expose the required native List mutation.', false],
    permission: ['permission', 'GitHub denied native List lifecycle permission.', false],
    'invalid-identifiers': ['validation', 'GitHub rejected the native List identifier.', false],
    'rate-limit': ['rate-limit', 'GitHub rate-limited the native List request.', true],
    server: ['network', 'GitHub could not complete the native List request.', true]
  } as const
  const [category, message, retryable] = entries[reason]
  return failure(reason, category, message, retryable)
}
function failure(reason: ListLifecycleMutationFailureReason, category: ConstructorParameters<typeof AppFailure>[0]['category'], message: string, retryable: boolean, response?: Response): ListLifecycleMutationFailure {
  const details = response ? githubHttpFailure(response, message).publicError : {}
  return new ListLifecycleMutationFailure(reason, {...details, category, message, retryable})
}
