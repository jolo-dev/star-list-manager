import type {
  GitHubUserId,
  NativeListRecord,
  NativeMembershipRecord,
  RateLimitState,
  SyncStateRecord
} from '../domain/types'
import type {
  NativeListCapability,
  NativeListCatalogPage,
  NativeListItemsPage
} from '../github/graphql-client'
import {sanitizeError, validationFailure} from '../shared/errors'
import {
  getSyncState,
  putSyncState,
  reconcileNativeLists
} from '../storage/library'

export interface NativeListReader {
  probeNativeLists(): Promise<NativeListCapability>
  fetchNativeListCatalogPage(after: string | null): Promise<NativeListCatalogPage>
  fetchNativeListItemsPage(
    listNodeId: string,
    after: string | null
  ): Promise<NativeListItemsPage>
}

export interface NativeListSyncOptions {
  readonly database: IDBDatabase
  readonly reader: NativeListReader
  readonly now?: () => number
}

export class NativeListSyncService {
  readonly #database: IDBDatabase
  readonly #reader: NativeListReader
  readonly #now: () => number
  readonly #activeRuns = new Map<GitHubUserId, Promise<SyncStateRecord>>()

  constructor(options: NativeListSyncOptions) {
    this.#database = options.database
    this.#reader = options.reader
    this.#now = options.now ?? Date.now
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
    const previous = await getSyncState(this.#database, githubUserId, 'native-lists')
    const startedAt = this.#timestamp()
    let state: SyncStateRecord = {
      githubUserId,
      kind: 'native-lists',
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

    try {
      const capability = await this.#reader.probeNativeLists()
      state = {...state, rateLimit: mergeRateLimit(state.rateLimit, capability.rateLimit)}
      if (!capability.available) {
        const completedAt = this.#timestamp()
        state = {
          ...state,
          phase: 'unavailable',
          baselineCompletedAt: state.baselineCompletedAt ?? completedAt,
          lastCompletedAt: completedAt,
          lastSuccessfulAt: completedAt
        }
        await putSyncState(this.#database, state)
        return state
      }

      const metadata = new Map<string, NativeListCatalogPage['lists'][number]>()
      let catalogCursor: string | null = null
      let catalogTotal = 0
      do {
        const page = await this.#reader.fetchNativeListCatalogPage(catalogCursor)
        state = {
          ...state,
          pagesProcessed: state.pagesProcessed + 1,
          rateLimit: mergeRateLimit(state.rateLimit, page.rateLimit)
        }
        await putSyncState(this.#database, state)
        catalogTotal = page.totalCount
        for (const list of page.lists) metadata.set(list.listNodeId, list)
        catalogCursor = nextCursor(page.pageInfo.hasNextPage, page.pageInfo.endCursor)
      } while (catalogCursor)

      if (metadata.size !== catalogTotal) {
        throw validationFailure('GitHub native List metadata pagination was incomplete.')
      }

      const observedAt = this.#timestamp()
      const lists: NativeListRecord[] = []
      const memberships: NativeMembershipRecord[] = []
      let skippedItems = 0

      for (const list of metadata.values()) {
        const repositoryNodeIds = new Set<string>()
        let itemCursor: string | null = null
        let reportedItemCount = list.reportedItemCount
        do {
          const page = await this.#reader.fetchNativeListItemsPage(
            list.listNodeId,
            itemCursor
          )
          state = {
            ...state,
            pagesProcessed: state.pagesProcessed + 1,
            rateLimit: mergeRateLimit(state.rateLimit, page.rateLimit)
          }
          await putSyncState(this.#database, state)
          reportedItemCount = page.totalCount
          for (const repositoryNodeId of page.repositoryNodeIds) {
            repositoryNodeIds.add(repositoryNodeId)
          }
          itemCursor = nextCursor(page.pageInfo.hasNextPage, page.pageInfo.endCursor)
        } while (itemCursor)

        const inaccessibleItems = Math.max(
          0,
          reportedItemCount - repositoryNodeIds.size
        )
        skippedItems += inaccessibleItems
        lists.push({
          githubUserId,
          listNodeId: list.listNodeId,
          name: list.name,
          description: list.description,
          visibility: list.isPrivate ? 'private' : 'public',
          slug: list.slug,
          createdAt: list.createdAt,
          updatedAt: list.updatedAt,
          lastAddedAt: list.lastAddedAt,
          reportedItemCount,
          importedItemCount: repositoryNodeIds.size,
          importStatus:
            repositoryNodeIds.size === reportedItemCount ? 'complete' : 'partial',
          lastObservedAt: observedAt
        })
        for (const repositoryNodeId of repositoryNodeIds) {
          memberships.push({
            githubUserId,
            listNodeId: list.listNodeId,
            repositoryNodeId,
            lastObservedAt: observedAt
          })
        }
      }

      await reconcileNativeLists(this.#database, githubUserId, lists, memberships)
      const completedAt = this.#timestamp()
      state = {
        ...state,
        phase: lists.some((list) => list.importStatus === 'partial')
          ? 'partial'
          : 'complete',
        itemsObserved: memberships.length,
        skippedItems,
        baselineCompletedAt: state.baselineCompletedAt ?? completedAt,
        lastCompletedAt: completedAt,
        lastSuccessfulAt: completedAt,
        lastError: null
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

function nextCursor(hasNextPage: boolean, endCursor: string | null): string | null {
  if (!hasNextPage) return null
  if (endCursor) return endCursor
  throw validationFailure('GitHub pagination omitted the next cursor.')
}

function mergeRateLimit(
  previous: RateLimitState,
  current: RateLimitState
): RateLimitState {
  return {
    limit: current.limit ?? previous.limit,
    remaining: current.remaining ?? previous.remaining,
    resetAt: current.resetAt ?? previous.resetAt
  }
}

function emptyRateLimit(): RateLimitState {
  return {limit: null, remaining: null, resetAt: null}
}
