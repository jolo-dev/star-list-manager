import type {
  GitHubUserId,
  IsoDateTime,
  NativeListNodeId,
  NativeListVisibility,
  RateLimitState,
  RepositoryNodeId
} from '../domain/types'
import {
  canonicalMembershipSet,
  planMembershipIntent,
  referencedListNodeIds,
  relevantListCatalogFingerprint,
  type CanonicalListCatalogFingerprint,
  type CanonicalMembershipSet,
  type ExistingListCatalogIdentity,
  type MembershipIntentPlan,
  type NativeListMembershipIntent
} from '../domain/native-list-membership'
import {sanitizeError, validationFailure, type AppError} from '../shared/errors'
import type {NativeListReader} from './native-list-sync'

export interface SelectedRepositoryObservationTarget {
  readonly repositoryNodeId: RepositoryNodeId
  readonly relevantListNodeIds: readonly NativeListNodeId[]
}

export interface ObservationCaptureInterval {
  readonly startedAt: IsoDateTime
  readonly completedAt: IsoDateTime
}

export interface ObservedRepositoryMembership {
  readonly repositoryNodeId: RepositoryNodeId
  readonly observed: CanonicalMembershipSet
  readonly relevantCatalog: CanonicalListCatalogFingerprint
}

export interface CompleteMembershipObservation {
  readonly githubUserId: GitHubUserId
  readonly completeness: 'complete'
  readonly nonAtomic: true
  readonly captureInterval: ObservationCaptureInterval
  readonly repositories: readonly ObservedRepositoryMembership[]
  readonly fingerprint: string
}

export interface StableMembershipObservation {
  readonly status: 'stable'
  readonly githubUserId: GitHubUserId
  readonly attempts: number
  readonly captureInterval: ObservationCaptureInterval
  readonly observations: readonly [
    CompleteMembershipObservation,
    CompleteMembershipObservation
  ]
  readonly repositories: readonly ObservedRepositoryMembership[]
  readonly fingerprint: string
}

export interface ChangingMembershipObservation {
  readonly status: 'changing'
  readonly githubUserId: GitHubUserId
  readonly attempts: number
  readonly observations: readonly CompleteMembershipObservation[]
}

interface FailedMembershipObservation {
  readonly githubUserId: GitHubUserId
  readonly attempts: number
  readonly error: AppError | null
}

export interface PartialMembershipObservation extends FailedMembershipObservation {
  readonly status: 'partial'
}

export interface InterruptedMembershipObservation extends FailedMembershipObservation {
  readonly status: 'interrupted'
}

export interface UnavailableMembershipObservation extends FailedMembershipObservation {
  readonly status: 'unavailable'
}

export interface RateLimitedMembershipObservation extends FailedMembershipObservation {
  readonly status: 'rate-limited'
  readonly rateLimit: RateLimitState
}

export type NonStableMembershipObservation =
  | ChangingMembershipObservation
  | PartialMembershipObservation
  | InterruptedMembershipObservation
  | UnavailableMembershipObservation
  | RateLimitedMembershipObservation

export type MembershipObservationOutcome =
  | StableMembershipObservation
  | NonStableMembershipObservation

export interface StableMembershipBatchPreview {
  readonly status: 'stable'
  readonly observation: StableMembershipObservation
  readonly previews: readonly MembershipIntentPlan[]
}

export interface InvalidMembershipBatchPreview {
  readonly status: 'invalid-intent'
  readonly observation: StableMembershipObservation
  readonly repositoryNodeId: RepositoryNodeId
  readonly sourceListNodeId: NativeListNodeId
}

export type MembershipBatchPreviewOutcome =
  | StableMembershipBatchPreview
  | InvalidMembershipBatchPreview
  | NonStableMembershipObservation

export interface NativeListMembershipObservationOptions {
  readonly reader: NativeListReader
  readonly maxAttempts?: number
  readonly now?: () => number
}

type CaptureOutcome =
  | {readonly status: 'complete'; readonly observation: CompleteMembershipObservation}
  | PartialMembershipObservation
  | InterruptedMembershipObservation
  | UnavailableMembershipObservation
  | RateLimitedMembershipObservation

export class NativeListMembershipObservationService {
  readonly #reader: NativeListReader
  readonly #maxAttempts: number
  readonly #now: () => number

  constructor(options: NativeListMembershipObservationOptions) {
    if (!Number.isSafeInteger(options.maxAttempts ?? 3) || (options.maxAttempts ?? 3) < 2) {
      throw new RangeError('Membership observation requires at least two attempts.')
    }
    this.#reader = options.reader
    this.#maxAttempts = options.maxAttempts ?? 3
    this.#now = options.now ?? Date.now
  }

  async observeSelected(
    githubUserId: GitHubUserId,
    targets: readonly SelectedRepositoryObservationTarget[],
    signal?: AbortSignal
  ): Promise<MembershipObservationOutcome> {
    const normalizedTargets = normalizeTargets(targets)
    const complete: CompleteMembershipObservation[] = []

    for (let attempt = 1; attempt <= this.#maxAttempts; attempt += 1) {
      const capture = await this.#capture(
        githubUserId,
        normalizedTargets,
        attempt,
        signal
      )
      if (capture.status !== 'complete') return capture

      const previous = complete.at(-1)
      complete.push(capture.observation)
      if (previous?.fingerprint === capture.observation.fingerprint) {
        return {
          status: 'stable',
          githubUserId,
          attempts: attempt,
          captureInterval: {
            startedAt: previous.captureInterval.startedAt,
            completedAt: capture.observation.captureInterval.completedAt
          },
          observations: [previous, capture.observation],
          repositories: capture.observation.repositories,
          fingerprint: capture.observation.fingerprint
        }
      }
    }

    return {
      status: 'changing',
      githubUserId,
      attempts: this.#maxAttempts,
      observations: complete
    }
  }

  async previewBatch(
    githubUserId: GitHubUserId,
    intents: readonly NativeListMembershipIntent[],
    signal?: AbortSignal
  ): Promise<MembershipBatchPreviewOutcome> {
    for (const intent of intents) {
      if (intent.githubUserId !== githubUserId) {
        throw validationFailure('Membership intent owner does not match the observation owner.')
      }
    }

    const targets = intents.map((intent) => ({
      repositoryNodeId: intent.repositoryNodeId,
      relevantListNodeIds: referencedListNodeIds(intent)
    }))
    const observation = await this.observeSelected(githubUserId, targets, signal)
    if (observation.status !== 'stable') return observation

    const memberships = new Map(
      observation.repositories.map((repository) => [
        repository.repositoryNodeId,
        repository.observed.listNodeIds
      ])
    )
    const previews: MembershipIntentPlan[] = []
    for (const intent of intents) {
      const preview = planMembershipIntent(
        memberships.get(intent.repositoryNodeId) ?? [],
        intent
      )
      if (!preview.ok) {
        return {
          status: 'invalid-intent',
          observation,
          repositoryNodeId: intent.repositoryNodeId,
          sourceListNodeId: preview.error.sourceListNodeId
        }
      }
      previews.push(preview.value)
    }
    return {status: 'stable', observation, previews}
  }

  async #capture(
    githubUserId: GitHubUserId,
    targets: readonly SelectedRepositoryObservationTarget[],
    attempt: number,
    signal: AbortSignal | undefined
  ): Promise<CaptureOutcome> {
    const startedAt = this.#timestamp()
    try {
      if (signal?.aborted) return interrupted(githubUserId, attempt)
      const capability = await this.#reader.probeNativeLists()
      const capabilityLimit = rateLimitOutcome(githubUserId, attempt, capability.rateLimit)
      if (capabilityLimit) return capabilityLimit
      if (!capability.available) {
        return {status: 'unavailable', githubUserId, attempts: attempt, error: null}
      }

      const catalog = new Map<NativeListNodeId, CatalogEntry>()
      let catalogCursor: string | null = null
      let catalogTotal: number | null = null
      do {
        if (signal?.aborted) return interrupted(githubUserId, attempt)
        const page = await this.#reader.fetchNativeListCatalogPage(catalogCursor)
        const pageLimit = rateLimitOutcome(githubUserId, attempt, page.rateLimit)
        if (pageLimit) return pageLimit
        if (catalogTotal !== null && catalogTotal !== page.totalCount) {
          return partial(githubUserId, attempt, 'GitHub native List catalog changed during pagination.')
        }
        catalogTotal = page.totalCount
        for (const list of page.lists) {
          if (catalog.has(list.listNodeId)) {
            return partial(githubUserId, attempt, 'GitHub native List catalog contained duplicate Lists.')
          }
          catalog.set(list.listNodeId, {
            listNodeId: list.listNodeId,
            name: list.name,
            visibility: list.isPrivate ? 'private' : 'public',
            reportedItemCount: list.reportedItemCount
          })
        }
        catalogCursor = nextCursor(page.pageInfo.hasNextPage, page.pageInfo.endCursor)
      } while (catalogCursor)

      if (catalog.size !== catalogTotal) {
        return partial(githubUserId, attempt, 'GitHub native List catalog pagination was incomplete.')
      }

      const selectedIds = new Set(targets.map((target) => target.repositoryNodeId))
      const reverseIndex = new Map<RepositoryNodeId, Set<NativeListNodeId>>()
      for (const repositoryNodeId of selectedIds) reverseIndex.set(repositoryNodeId, new Set())

      for (const list of catalog.values()) {
        let itemCursor: string | null = null
        let itemTotal: number | null = null
        const observedItems = new Set<RepositoryNodeId>()
        do {
          if (signal?.aborted) return interrupted(githubUserId, attempt)
          const page = await this.#reader.fetchNativeListItemsPage(
            list.listNodeId,
            itemCursor
          )
          const pageLimit = rateLimitOutcome(githubUserId, attempt, page.rateLimit)
          if (pageLimit) return pageLimit
          if (itemTotal !== null && itemTotal !== page.totalCount) {
            return partial(githubUserId, attempt, 'GitHub native List items changed during pagination.')
          }
          itemTotal = page.totalCount
          for (const repositoryNodeId of page.repositoryNodeIds) {
            observedItems.add(repositoryNodeId)
          }
          itemCursor = nextCursor(page.pageInfo.hasNextPage, page.pageInfo.endCursor)
        } while (itemCursor)

        if (itemTotal !== list.reportedItemCount || observedItems.size !== itemTotal) {
          return partial(githubUserId, attempt, 'GitHub native List items were incomplete.')
        }
        for (const repositoryNodeId of selectedIds) {
          if (observedItems.has(repositoryNodeId)) {
            reverseIndex.get(repositoryNodeId)?.add(list.listNodeId)
          }
        }
      }

      if (signal?.aborted) return interrupted(githubUserId, attempt)
      const catalogIdentities: ExistingListCatalogIdentity[] = [...catalog.values()]
      const repositories = targets.map((target): ObservedRepositoryMembership => ({
        repositoryNodeId: target.repositoryNodeId,
        observed: canonicalMembershipSet(reverseIndex.get(target.repositoryNodeId) ?? []),
        relevantCatalog: relevantListCatalogFingerprint(
          target.relevantListNodeIds,
          catalogIdentities
        )
      }))
      const completedAt = this.#timestamp()
      return {
        status: 'complete',
        observation: {
          githubUserId,
          completeness: 'complete',
          nonAtomic: true,
          captureInterval: {startedAt, completedAt},
          repositories,
          fingerprint: JSON.stringify(
            repositories.map((repository) => [
              repository.repositoryNodeId,
              repository.observed.fingerprint,
              repository.relevantCatalog.fingerprint
            ])
          )
        }
      }
    } catch (error: unknown) {
      const safeError = sanitizeError(error)
      if (safeError.category === 'rate-limit') {
        return {
          status: 'rate-limited',
          githubUserId,
          attempts: attempt,
          error: safeError,
          rateLimit: safeError.rateLimit ?? emptyRateLimit()
        }
      }
      if (safeError.category === 'validation') {
        return {status: 'partial', githubUserId, attempts: attempt, error: safeError}
      }
      if (safeError.category === 'unsupported') {
        return {status: 'unavailable', githubUserId, attempts: attempt, error: safeError}
      }
      return {status: 'interrupted', githubUserId, attempts: attempt, error: safeError}
    }
  }

  #timestamp(): IsoDateTime {
    return new Date(this.#now()).toISOString()
  }
}

interface CatalogEntry extends ExistingListCatalogIdentity {
  readonly visibility: NativeListVisibility
  readonly reportedItemCount: number
}

function normalizeTargets(
  targets: readonly SelectedRepositoryObservationTarget[]
): readonly SelectedRepositoryObservationTarget[] {
  const relevantByRepository = new Map<RepositoryNodeId, Set<NativeListNodeId>>()
  for (const target of targets) {
    const relevant = relevantByRepository.get(target.repositoryNodeId) ?? new Set()
    for (const listNodeId of target.relevantListNodeIds) relevant.add(listNodeId)
    relevantByRepository.set(target.repositoryNodeId, relevant)
  }
  return [...relevantByRepository]
    .sort(([left], [right]) => compareStrings(left, right))
    .map(([repositoryNodeId, relevantListNodeIds]) => ({
      repositoryNodeId,
      relevantListNodeIds: canonicalMembershipSet(relevantListNodeIds).listNodeIds
    }))
}

function nextCursor(hasNextPage: boolean, endCursor: string | null): string | null {
  if (!hasNextPage) return null
  if (endCursor) return endCursor
  throw validationFailure('GitHub pagination omitted the next cursor.')
}

function partial(
  githubUserId: GitHubUserId,
  attempts: number,
  message: string
): PartialMembershipObservation {
  return {
    status: 'partial',
    githubUserId,
    attempts,
    error: sanitizeError(validationFailure(message))
  }
}

function interrupted(
  githubUserId: GitHubUserId,
  attempts: number
): InterruptedMembershipObservation {
  return {
    status: 'interrupted',
    githubUserId,
    attempts,
    error: {
      category: 'network',
      message: 'Native List membership observation was interrupted.',
      retryable: true
    }
  }
}

function rateLimitOutcome(
  githubUserId: GitHubUserId,
  attempts: number,
  rateLimit: RateLimitState
): RateLimitedMembershipObservation | null {
  if (rateLimit.remaining !== 0) return null
  return {
    status: 'rate-limited',
    githubUserId,
    attempts,
    error: {
      category: 'rate-limit',
      message: 'GitHub rate limited native List membership observation.',
      retryable: true,
      ...(rateLimit.resetAt ? {retryAt: rateLimit.resetAt} : {}),
      rateLimit
    },
    rateLimit
  }
}

function emptyRateLimit(): RateLimitState {
  return {limit: null, remaining: null, resetAt: null}
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}
