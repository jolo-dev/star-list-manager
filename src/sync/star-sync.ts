import type {
  GitHubUserId,
  RateLimitState,
  RepositoryRecord,
  SyncStateRecord
} from '../domain/types'
import type {PublicStarObservation} from '../github/rest-client'
import {sanitizeError} from '../shared/errors'
import {
  getSyncState,
  putSyncState,
  reconcileStarredRepositories
} from '../storage/library'

export interface PublicStarObserver {
  observePublicStars(
    githubUserId: GitHubUserId,
    observedAt: string
  ): Promise<PublicStarObservation>
}

export interface StarSyncOptions {
  readonly database: IDBDatabase
  readonly observer: PublicStarObserver
  readonly now?: () => number
  readonly maxConvergenceAttempts?: number
}

export class StarSyncService {
  readonly #database: IDBDatabase
  readonly #observer: PublicStarObserver
  readonly #now: () => number
  readonly #maxConvergenceAttempts: number
  readonly #activeRuns = new Map<GitHubUserId, Promise<SyncStateRecord>>()

  constructor(options: StarSyncOptions) {
    this.#database = options.database
    this.#observer = options.observer
    this.#now = options.now ?? Date.now
    this.#maxConvergenceAttempts = options.maxConvergenceAttempts ?? 4
  }

  synchronize(githubUserId: GitHubUserId): Promise<SyncStateRecord> {
    const active = this.#activeRuns.get(githubUserId)
    if (active) return active

    const run = this.#run(githubUserId).finally(() => {
      if (this.#activeRuns.get(githubUserId) === run) {
        this.#activeRuns.delete(githubUserId)
      }
    })
    this.#activeRuns.set(githubUserId, run)
    return run
  }

  async #run(githubUserId: GitHubUserId): Promise<SyncStateRecord> {
    const previous = await getSyncState(this.#database, githubUserId, 'stars')
    const startedAt = this.#timestamp()
    let state: SyncStateRecord = {
      githubUserId,
      kind: 'stars',
      phase: 'running',
      attempt: (previous?.attempt ?? 0) + 1,
      pagesProcessed: 0,
      itemsObserved: 0,
      skippedItems: 0,
      convergenceAttempt: 0,
      baselineCompletedAt: previous?.baselineCompletedAt ?? null,
      lastStartedAt: startedAt,
      lastCompletedAt: previous?.lastCompletedAt ?? null,
      lastSuccessfulAt: previous?.lastSuccessfulAt ?? null,
      rateLimit: previous?.rateLimit ?? emptyRateLimit(),
      lastError: null
    }
    await putSyncState(this.#database, state)

    let previousObservation: PublicStarObservation | null = null
    let totalPages = 0
    try {
      for (
        let convergenceAttempt = 1;
        convergenceAttempt <= this.#maxConvergenceAttempts;
        convergenceAttempt += 1
      ) {
        const observedAt = this.#timestamp()
        const observation = await this.#observer.observePublicStars(
          githubUserId,
          observedAt
        )
        totalPages += observation.pagesProcessed
        state = {
          ...state,
          pagesProcessed: totalPages,
          itemsObserved: observation.repositories.length,
          skippedItems: observation.skippedPrivateRepositories,
          convergenceAttempt,
          rateLimit: observation.rateLimit
        }
        await putSyncState(this.#database, state)

        if (
          previousObservation &&
          matchingRepositorySets(
            previousObservation.repositories,
            observation.repositories
          )
        ) {
          const completedAt = this.#timestamp()
          await reconcileStarredRepositories(
            this.#database,
            githubUserId,
            observation.repositories,
            completedAt
          )
          state = {
            ...state,
            phase: 'complete',
            baselineCompletedAt: state.baselineCompletedAt ?? completedAt,
            lastCompletedAt: completedAt,
            lastSuccessfulAt: completedAt,
            lastError: null
          }
          await putSyncState(this.#database, state)
          return state
        }
        previousObservation = observation
      }

      const completedAt = this.#timestamp()
      state = {
        ...state,
        phase: state.lastSuccessfulAt ? 'stale' : 'error',
        lastCompletedAt: completedAt,
        lastError: {
          category: 'network',
          message: 'GitHub stars changed during pagination and did not stabilize.',
          retryable: true
        }
      }
      await putSyncState(this.#database, state)
      return state
    } catch (error: unknown) {
      state = {
        ...state,
        phase: state.lastSuccessfulAt ? 'stale' : 'error',
        lastCompletedAt: this.#timestamp(),
        lastError: sanitizeError(error)
      }
      await putSyncState(this.#database, state)
      return state
    }
  }

  #timestamp(): string {
    return new Date(this.#now()).toISOString()
  }
}

function matchingRepositorySets(
  left: readonly RepositoryRecord[],
  right: readonly RepositoryRecord[]
): boolean {
  if (left.length !== right.length) return false
  const leftIds = new Set(left.map((repository) => repository.repositoryNodeId))
  return right.every((repository) => leftIds.has(repository.repositoryNodeId))
}

function emptyRateLimit(): RateLimitState {
  return {limit: null, remaining: null, resetAt: null}
}
