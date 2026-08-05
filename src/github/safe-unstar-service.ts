import type {AuthStore} from '../auth/store'
import type {GitHubUserId, RepositoryNodeId} from '../domain/types'
import {sanitizeError} from '../shared/errors'
import {decodePublicRepositoryRoute} from './decoders'
import type {PublicStarObservation} from './rest-client'
import {
  StarringOperation,
  type StarringMutationRequest,
  type StarringStatusRequest
} from './starring-write-session'

const apiOrigin = 'https://api.github.com'
const apiVersion = '2026-03-10'

export interface RepositoryRoute {
  readonly owner: string
  readonly repositoryName: string
}

export interface SafeUnstarTarget extends RepositoryRoute {
  readonly expectedGitHubUserId: GitHubUserId
  readonly repositoryNodeId: RepositoryNodeId
}

export type BlockedUnknownReason =
  | 'route'
  | 'node'
  | 'unavailable'
  | 'unstable'
  | 'malformed'

export interface ReadyToDeleteOutcome {
  readonly kind: 'ready-to-delete'
  readonly currentRoute: RepositoryRoute
}

export interface ConfirmedAlreadyAbsentOutcome {
  readonly kind: 'confirmed-already-absent'
  readonly observationAttempts: number
}

export interface VerifiedAbsentOutcome {
  readonly kind: 'verified-absent'
  readonly currentRoute: RepositoryRoute
  readonly observationAttempts: number
}

export interface DeleteAcceptedOutcome {
  readonly kind: 'delete-accepted'
  readonly currentRoute: RepositoryRoute
}

export interface DeleteObservationRequiredOutcome {
  readonly kind: 'delete-observation-required'
  readonly statusCode: number
}

export interface ConfirmedPresentOutcome {
  readonly kind: 'confirmed-present'
  readonly currentRoute: RepositoryRoute
  readonly observationAttempts: number
}

export interface ConfirmedAbsentOutcome {
  readonly kind: 'confirmed-absent'
  readonly currentRoute: RepositoryRoute
  readonly observationAttempts: number
}

export interface BlockedUnknownOutcome {
  readonly kind: 'blocked-unknown'
  readonly reason: BlockedUnknownReason
  readonly statusCode: number | null
}

export type RemoteFailureKind =
  | 'authentication'
  | 'permission'
  | 'rate-limit'
  | 'server'
  | 'network'

export interface RemoteFailureOutcome {
  readonly kind: RemoteFailureKind
  readonly statusCode: number | null
  readonly retryAt: string | null
}

export type UnstarPreparationOutcome =
  | ReadyToDeleteOutcome
  | ConfirmedAlreadyAbsentOutcome
  | BlockedUnknownOutcome
  | RemoteFailureOutcome

export type UnstarDeletionOutcome =
  | VerifiedAbsentOutcome
  | BlockedUnknownOutcome
  | RemoteFailureOutcome

export type UnstarDeleteRequestOutcome =
  | DeleteAcceptedOutcome
  | DeleteObservationRequiredOutcome
  | BlockedUnknownOutcome
  | RemoteFailureOutcome

export type StableUnstarObservationOutcome =
  | ConfirmedPresentOutcome
  | ConfirmedAbsentOutcome
  | BlockedUnknownOutcome
  | RemoteFailureOutcome

interface PublicStarObserver {
  observePublicStars(
    githubUserId: GitHubUserId,
    observedAt: string
  ): Promise<PublicStarObservation>
}

interface StarringExecutor {
  execute(request: StarringStatusRequest): Promise<boolean>
  execute(request: StarringMutationRequest): Promise<void>
}

export interface SafeUnstarServiceOptions {
  readonly authStore: Pick<AuthStore, 'loadActive'>
  readonly writeSession: StarringExecutor
  readonly starObserver: PublicStarObserver
  readonly publicFetch?: HttpFetch
  readonly now?: () => number
  readonly maxObservationAttempts?: number
  readonly observationDelayMs?: number
  readonly sleep?: (milliseconds: number) => Promise<void>
}

export class SafeUnstarService {
  readonly #authStore: Pick<AuthStore, 'loadActive'>
  readonly #writeSession: StarringExecutor
  readonly #starObserver: PublicStarObserver
  readonly #publicFetch: HttpFetch
  readonly #now: () => number
  readonly #maxObservationAttempts: number
  readonly #observationDelayMs: number
  readonly #sleep: (milliseconds: number) => Promise<void>

  constructor(options: SafeUnstarServiceOptions) {
    this.#authStore = options.authStore
    this.#writeSession = options.writeSession
    this.#starObserver = options.starObserver
    this.#publicFetch = options.publicFetch ?? globalThis.fetch
    this.#now = options.now ?? Date.now
    this.#maxObservationAttempts = options.maxObservationAttempts ?? 4
    this.#observationDelayMs = options.observationDelayMs ?? 250
    this.#sleep = options.sleep ?? defaultSleep
    if (
      !Number.isSafeInteger(this.#maxObservationAttempts) ||
      this.#maxObservationAttempts < 2
    ) {
      throw new TypeError('Safe unstar observation attempts must be at least two.')
    }
    if (!Number.isFinite(this.#observationDelayMs) || this.#observationDelayMs < 0) {
      throw new TypeError('Safe unstar observation delay must not be negative.')
    }
  }

  async prepare(target: SafeUnstarTarget): Promise<UnstarPreparationOutcome> {
    const resolution = await this.#resolveCurrentRoute(target)
    if (resolution.kind === 'unavailable') {
      const observation = await this.#observeConvergence(target)
      if (observation.kind !== 'converged') return observation.outcome
      return observation.present
        ? blocked('unavailable', resolution.statusCode)
        : {
            kind: 'confirmed-already-absent',
            observationAttempts: observation.attempts
          }
    }
    if (resolution.kind !== 'resolved') return resolution.outcome

    const ownershipFailure = await this.#requireOwner(target.expectedGitHubUserId)
    if (ownershipFailure) return ownershipFailure
    let starred: boolean
    try {
      starred = await this.#writeSession.execute({
        expectedGitHubUserId: target.expectedGitHubUserId,
        owner: resolution.route.owner,
        repositoryName: resolution.route.repositoryName,
        operation: StarringOperation.Status
      })
    } catch (error: unknown) {
      return mapFailure(error)
    }
    if (starred) return {kind: 'ready-to-delete', currentRoute: resolution.route}

    const observation = await this.#observeConvergence(target)
    if (observation.kind !== 'converged') return observation.outcome
    return observation.present
      ? {kind: 'ready-to-delete', currentRoute: resolution.route}
      : {
          kind: 'confirmed-already-absent',
          observationAttempts: observation.attempts
        }
  }

  async deleteAndVerify(target: SafeUnstarTarget): Promise<UnstarDeletionOutcome> {
    const deletion = await this.delete(target)
    if (
      deletion.kind !== 'delete-accepted' &&
      deletion.kind !== 'delete-observation-required'
    ) {
      return deletion
    }

    const observation = await this.observeStableState(target)
    if (observation.kind === 'confirmed-present') return blocked('unstable', null)
    if (observation.kind !== 'confirmed-absent') return observation
    return {
      kind: 'verified-absent',
      currentRoute: observation.currentRoute,
      observationAttempts: observation.observationAttempts
    }
  }

  async delete(target: SafeUnstarTarget): Promise<UnstarDeleteRequestOutcome> {
    const resolution = await this.#resolveCurrentRoute(target)
    if (resolution.kind === 'unavailable') {
      return {
        kind: 'delete-observation-required',
        statusCode: resolution.statusCode
      }
    }
    if (resolution.kind !== 'resolved') return resolution.outcome

    const ownershipFailure = await this.#requireOwner(target.expectedGitHubUserId)
    if (ownershipFailure) return ownershipFailure
    try {
      await this.#writeSession.execute({
        expectedGitHubUserId: target.expectedGitHubUserId,
        owner: resolution.route.owner,
        repositoryName: resolution.route.repositoryName,
        operation: StarringOperation.Unstar
      })
    } catch (error: unknown) {
      const sanitized = sanitizeError(error)
      if (sanitized.status !== 404) return mapFailure(error)
    }

    return {kind: 'delete-accepted', currentRoute: resolution.route}
  }

  async observeStableState(
    target: SafeUnstarTarget
  ): Promise<StableUnstarObservationOutcome> {
    const resolution = await this.#resolveCurrentRoute(target)
    if (resolution.kind === 'unavailable') {
      return this.#observeAfterUnavailableRoute(target, resolution.statusCode)
    }
    if (resolution.kind !== 'resolved') return resolution.outcome

    const observation = await this.#observeConvergence(target)
    if (observation.kind !== 'converged') return observation.outcome
    return observation.present
      ? {
          kind: 'confirmed-present',
          currentRoute: resolution.route,
          observationAttempts: observation.attempts
        }
      : {
          kind: 'confirmed-absent',
          currentRoute: resolution.route,
          observationAttempts: observation.attempts
        }
  }

  async #observeAfterUnavailableRoute(
    target: SafeUnstarTarget,
    statusCode: number
  ): Promise<StableUnstarObservationOutcome> {
    const observation = await this.#observeConvergence(target)
    if (observation.kind !== 'converged') return observation.outcome
    return observation.present
      ? blocked('unavailable', statusCode)
      : {
          kind: 'confirmed-absent',
          currentRoute: {owner: target.owner, repositoryName: target.repositoryName},
          observationAttempts: observation.attempts
        }
  }

  async #resolveCurrentRoute(target: SafeUnstarTarget): Promise<RouteResolution> {
    const initial = await this.#fetchRoute(target.expectedGitHubUserId, target)
    if (initial.kind !== 'found') return initial
    if (initial.repositoryNodeId !== target.repositoryNodeId) {
      return failedResolution(blocked('node', null))
    }

    const currentRoute = initial.route
    const revalidated = await this.#fetchRoute(
      target.expectedGitHubUserId,
      currentRoute
    )
    if (revalidated.kind !== 'found') return revalidated
    if (revalidated.repositoryNodeId !== target.repositoryNodeId) {
      return failedResolution(blocked('node', null))
    }
    if (!matchingRoutes(currentRoute, revalidated.route)) {
      return failedResolution(blocked('route', null))
    }
    return {kind: 'resolved', route: currentRoute}
  }

  async #fetchRoute(
    expectedGitHubUserId: GitHubUserId,
    route: RepositoryRoute
  ): Promise<RouteFetchResult> {
    const ownershipFailure = await this.#requireOwner(expectedGitHubUserId)
    if (ownershipFailure) return failedResolution(ownershipFailure)
    if (!validRoute(route)) return failedResolution(blocked('route', null))

    const url = `${apiOrigin}/repos/${encodeURIComponent(route.owner)}/${encodeURIComponent(
      route.repositoryName
    )}`
    let response: Response
    try {
      const request = this.#publicFetch
      response = await request(url, {
        method: 'GET',
        redirect: 'follow',
        headers: {
          accept: 'application/vnd.github+json',
          'x-github-api-version': apiVersion
        }
      })
    } catch (error: unknown) {
      return failedResolution(mapFailure(error))
    }
    if (response.status === 404) return {kind: 'unavailable', statusCode: 404}
    if (!response.ok) return failedResolution(mapResponseFailure(response))

    let payload: unknown
    try {
      payload = (await response.json()) as unknown
    } catch {
      return failedResolution(blocked('malformed', response.status))
    }
    const decoded = decodePublicRepositoryRoute(payload)
    if (!decoded.ok || !validRoute(decoded.value)) {
      return failedResolution(blocked('malformed', response.status))
    }
    if (decoded.value.private) {
      return failedResolution(blocked('unavailable', response.status))
    }
    return {
      kind: 'found',
      repositoryNodeId: decoded.value.repositoryNodeId,
      route: {
        owner: decoded.value.owner,
        repositoryName: decoded.value.repositoryName
      }
    }
  }

  async #observeConvergence(target: SafeUnstarTarget): Promise<ObservationResult> {
    let previousPresence: boolean | null = null
    for (let attempt = 1; attempt <= this.#maxObservationAttempts; attempt += 1) {
      if (attempt > 1 && this.#observationDelayMs > 0) {
        await this.#sleep(this.#observationDelayMs)
      }
      const ownershipFailure = await this.#requireOwner(target.expectedGitHubUserId)
      if (ownershipFailure) return {kind: 'failed', outcome: ownershipFailure}

      let observation: PublicStarObservation
      try {
        observation = await this.#starObserver.observePublicStars(
          target.expectedGitHubUserId,
          new Date(this.#now()).toISOString()
        )
      } catch (error: unknown) {
        return {kind: 'failed', outcome: mapFailure(error)}
      }
      const ids = observationIds(observation, target.expectedGitHubUserId)
      if (!ids) {
        return {kind: 'failed', outcome: blocked('malformed', null)}
      }
      const present = ids.has(target.repositoryNodeId)
      if (previousPresence === present) {
        return {
          kind: 'converged',
          present,
          attempts: attempt
        }
      }
      previousPresence = present
    }
    return {kind: 'failed', outcome: blocked('unstable', null)}
  }

  async #requireOwner(
    expectedGitHubUserId: GitHubUserId
  ): Promise<BlockedUnknownOutcome | RemoteFailureOutcome | null> {
    if (!expectedGitHubUserId) return remoteFailure('authentication', null, null)
    try {
      const active = await this.#authStore.loadActive()
      if (
        active?.githubUserId !== expectedGitHubUserId ||
        active.identity.githubUserId !== expectedGitHubUserId
      ) {
        return remoteFailure('authentication', null, null)
      }
      return null
    } catch (error: unknown) {
      return mapFailure(error)
    }
  }
}

type RouteFetchResult =
  | {
      readonly kind: 'found'
      readonly repositoryNodeId: RepositoryNodeId
      readonly route: RepositoryRoute
    }
  | {readonly kind: 'unavailable'; readonly statusCode: number}
  | {readonly kind: 'failed'; readonly outcome: BlockedUnknownOutcome | RemoteFailureOutcome}

type RouteResolution =
  | {readonly kind: 'resolved'; readonly route: RepositoryRoute}
  | Exclude<RouteFetchResult, {readonly kind: 'found'}>

type ObservationResult =
  | {readonly kind: 'converged'; readonly present: boolean; readonly attempts: number}
  | {readonly kind: 'failed'; readonly outcome: BlockedUnknownOutcome | RemoteFailureOutcome}

function failedResolution(
  outcome: BlockedUnknownOutcome | RemoteFailureOutcome
): {readonly kind: 'failed'; readonly outcome: BlockedUnknownOutcome | RemoteFailureOutcome} {
  return {kind: 'failed', outcome}
}

function validRoute(route: RepositoryRoute): boolean {
  return validSegment(route.owner) && validSegment(route.repositoryName)
}

function validSegment(value: string): boolean {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.trim() === value &&
    value !== '.' &&
    value !== '..' &&
    !/[\\/]/.test(value)
  )
}

function matchingRoutes(left: RepositoryRoute, right: RepositoryRoute): boolean {
  return left.owner === right.owner && left.repositoryName === right.repositoryName
}

function observationIds(
  observation: PublicStarObservation,
  expectedGitHubUserId: GitHubUserId
): ReadonlySet<string> | null {
  if (
    !observation ||
    !Array.isArray(observation.repositories) ||
    !Number.isSafeInteger(observation.pagesProcessed) ||
    observation.pagesProcessed < 1 ||
    !Number.isSafeInteger(observation.skippedPrivateRepositories) ||
    observation.skippedPrivateRepositories < 0
  ) {
    return null
  }
  const ids = new Set<string>()
  for (const repository of observation.repositories) {
    if (
      !repository ||
      repository.githubUserId !== expectedGitHubUserId ||
      typeof repository.repositoryNodeId !== 'string' ||
      repository.repositoryNodeId.length === 0 ||
      ids.has(repository.repositoryNodeId)
    ) {
      return null
    }
    ids.add(repository.repositoryNodeId)
  }
  return ids
}

function blocked(
  reason: BlockedUnknownReason,
  statusCode: number | null
): BlockedUnknownOutcome {
  return {kind: 'blocked-unknown', reason, statusCode}
}

function mapResponseFailure(response: Response): BlockedUnknownOutcome | RemoteFailureOutcome {
  const statusCode = response.status
  const retryAt = readResetAt(response.headers)
  const remaining = readInteger(response.headers.get('x-ratelimit-remaining'))
  if (statusCode === 401) return remoteFailure('authentication', statusCode, retryAt)
  if (statusCode === 429 || (statusCode === 403 && remaining === 0)) {
    return remoteFailure('rate-limit', statusCode, retryAt)
  }
  if (statusCode === 403) return remoteFailure('permission', statusCode, retryAt)
  if (statusCode >= 500) return remoteFailure('server', statusCode, retryAt)
  return blocked('route', statusCode)
}

function mapFailure(error: unknown): BlockedUnknownOutcome | RemoteFailureOutcome {
  const sanitized = sanitizeError(error)
  const statusCode = sanitized.status ?? null
  const retryAt = sanitized.retryAt ?? null
  if (statusCode !== null && statusCode >= 500) {
    return remoteFailure('server', statusCode, retryAt)
  }
  switch (sanitized.category) {
    case 'authentication':
      return remoteFailure('authentication', statusCode, retryAt)
    case 'permission':
      return remoteFailure('permission', statusCode, retryAt)
    case 'rate-limit':
      return remoteFailure('rate-limit', statusCode, retryAt)
    case 'validation':
      return blocked('malformed', statusCode)
    default:
      return remoteFailure('network', statusCode, retryAt)
  }
}

function remoteFailure(
  kind: RemoteFailureKind,
  statusCode: number | null,
  retryAt: string | null
): RemoteFailureOutcome {
  return {kind, statusCode, retryAt}
}

function readResetAt(headers: Headers): string | null {
  const seconds = readInteger(headers.get('x-ratelimit-reset'))
  return seconds === null ? null : new Date(seconds * 1000).toISOString()
}

function readInteger(value: string | null): number | null {
  if (value === null || !/^\d+$/.test(value)) return null
  const number = Number(value)
  return Number.isSafeInteger(number) ? number : null
}

function defaultSleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

type HttpFetch = (
  input: RequestInfo | URL,
  init?: RequestInit
) => Promise<Response>
