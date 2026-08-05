import type {AuthStore} from '../auth/store'
import type {WriteAuthStore} from '../auth/write-store'
import type {GitHubUserId, WriteAuthStateRecord} from '../domain/types'
import {
  AppFailure,
  githubHttpFailure,
  sanitizeError,
  validationFailure
} from '../shared/errors'

const starringUrl = 'https://api.github.com/user/starred'
const apiVersion = '2026-03-10'
const requiredScope = 'public_repo'

export const StarringOperation = {
  Status: 'status',
  Star: 'star',
  Unstar: 'unstar'
} as const

export type StarringOperation =
  (typeof StarringOperation)[keyof typeof StarringOperation]

export interface StarringStatusRequest {
  readonly expectedGitHubUserId: GitHubUserId
  readonly owner: string
  readonly repositoryName: string
  readonly operation: typeof StarringOperation.Status
}

export interface StarringMutationRequest {
  readonly expectedGitHubUserId: GitHubUserId
  readonly owner: string
  readonly repositoryName: string
  readonly operation:
    | typeof StarringOperation.Star
    | typeof StarringOperation.Unstar
}

export type StarringWriteRequest = StarringStatusRequest | StarringMutationRequest

export type StarringWriteStore = Pick<
  WriteAuthStore,
  'loadAccount' | 'deleteAccount'
>

export interface StarringWriteSessionOptions {
  readonly authStore: Pick<AuthStore, 'loadActive'>
  readonly writeStore: StarringWriteStore
  readonly fetch?: HttpFetch
}

export class StarringWriteSession {
  readonly #authStore: Pick<AuthStore, 'loadActive'>
  readonly #writeStore: StarringWriteStore
  readonly #fetch: HttpFetch

  constructor(options: StarringWriteSessionOptions) {
    this.#authStore = options.authStore
    this.#writeStore = options.writeStore
    this.#fetch = options.fetch ?? globalThis.fetch
  }

  execute(request: StarringStatusRequest): Promise<boolean>
  execute(request: StarringMutationRequest): Promise<void>
  execute(request: StarringWriteRequest): Promise<boolean | void>
  async execute(request: StarringWriteRequest): Promise<boolean | void> {
    const method = methodForOperation(request.operation)
    const owner = encodeSegment(request.owner, 'owner')
    const repositoryName = encodeSegment(request.repositoryName, 'repository name')
    if (!request.expectedGitHubUserId) {
      throw validationFailure('An expected GitHub account is required.')
    }

    const active = await this.#authStore.loadActive()
    if (
      active?.githubUserId !== request.expectedGitHubUserId ||
      active.identity.githubUserId !== request.expectedGitHubUserId
    ) {
      throw new AppFailure({
        category: 'authentication',
        message: 'The active GitHub account changed. Retry the Starring action.',
        retryable: true
      })
    }

    const writeState = await this.#writeStore.loadAccount(request.expectedGitHubUserId)
    if (!writeState) {
      throw new AppFailure({
        category: 'authentication',
        message: 'Authorize GitHub Starring access to continue.',
        retryable: false
      })
    }
    if (
      writeState.githubUserId !== request.expectedGitHubUserId ||
      writeState.identity.githubUserId !== request.expectedGitHubUserId
    ) {
      throw new AppFailure({
        category: 'authentication',
        message: 'GitHub Starring authorization does not match the active account.',
        retryable: false
      })
    }
    if (
      writeState.credential.tokenType !== 'bearer' ||
      !writeState.credential.accessToken ||
      !writeState.credential.grantedScopes.includes(requiredScope)
    ) {
      throw new AppFailure({
        category: 'permission',
        message: 'GitHub Starring access requires authorization with the public_repo scope.',
        retryable: false
      })
    }

    const headers = new Headers({
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${writeState.credential.accessToken}`,
      'x-github-api-version': apiVersion
    })
    let response: Response
    try {
      const request = this.#fetch
      response = await request(
        `${starringUrl}/${owner}/${repositoryName}`,
        {method, headers}
      )
    } catch (error: unknown) {
      throw new AppFailure(sanitizeError(error))
    }

    if (request.operation === StarringOperation.Status) {
      if (response.status === 204) return true
      if (response.status === 404) return false
    } else if (response.status === 204) {
      return
    }

    if (response.status === 401) {
      await this.#writeStore.deleteAccount(request.expectedGitHubUserId)
      throw githubHttpFailure(
        response,
        'GitHub Starring authorization was rejected. Reauthorize write access.'
      )
    }

    const failure = githubHttpFailure(response)
    if (failure.publicError.category === 'rate-limit') {
      throw githubHttpFailure(
        response,
        'GitHub Starring is rate-limited. Retry after the limit resets.'
      )
    }
    if (failure.publicError.category === 'permission') {
      throw githubHttpFailure(
        response,
        'GitHub denied Starring access. Reauthorize with the public_repo scope.'
      )
    }
    throw githubHttpFailure(response, 'GitHub could not complete the Starring request.')
  }
}

function methodForOperation(operation: StarringOperation): 'GET' | 'PUT' | 'DELETE' {
  switch (operation) {
    case StarringOperation.Status:
      return 'GET'
    case StarringOperation.Star:
      return 'PUT'
    case StarringOperation.Unstar:
      return 'DELETE'
    default:
      throw validationFailure('Unsupported GitHub Starring operation.')
  }
}

function encodeSegment(value: string, label: string): string {
  if (!value || !value.trim() || value === '.' || value === '..') {
    throw validationFailure(`A valid repository ${label} is required.`)
  }
  return encodeURIComponent(value)
}

type HttpFetch = (
  input: RequestInfo | URL,
  init?: RequestInit
) => Promise<Response>
