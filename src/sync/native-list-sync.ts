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

/** A complete catalog observation, intentionally independent of item import. */
export interface NativeListCatalogObservation {
  readonly githubUserId: GitHubUserId
  readonly complete: true
  readonly targets: ReadonlyMap<string, NativeListCatalogPage['lists'][number] | null>
  readonly fingerprint: string
  readonly rateLimit: RateLimitState
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

  /**
   * Reads and validates every catalog page without importing repository items
   * or modifying the local mirror.  A missing target is authoritative only
   * after this method resolves.
   */
  async observeCatalog(
    githubUserId: GitHubUserId,
    targetListNodeIds: readonly string[]
  ): Promise<NativeListCatalogObservation> {
    const capability = await this.#reader.probeNativeLists()
    if (!capability.available) {
      throw validationFailure('GitHub native List catalog is unavailable.')
    }
    const catalog = await this.#collectCatalog(capability.rateLimit)
    const targetIds = [...new Set(targetListNodeIds)].sort()
    const targets = new Map<string, NativeListCatalogPage['lists'][number] | null>()
    for (const listNodeId of targetIds) targets.set(listNodeId, catalog.lists.get(listNodeId) ?? null)
    return {
      githubUserId,
      complete: true,
      targets,
      fingerprint: JSON.stringify(targetIds.map((listNodeId) => catalogFingerprintEntry(catalog.lists.get(listNodeId) ?? null))),
      rateLimit: catalog.rateLimit
    }
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

      const catalog = await this.#collectCatalog(capability.rateLimit, async (rateLimit) => {
        state = {
          ...state,
          pagesProcessed: state.pagesProcessed + 1,
          rateLimit: mergeRateLimit(state.rateLimit, rateLimit)
        }
        await putSyncState(this.#database, state)
      })
      state = {...state, rateLimit: mergeRateLimit(state.rateLimit, catalog.rateLimit)}
      const metadata = catalog.lists

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

  async #collectCatalog(
    initialRateLimit: RateLimitState,
    onPage?: (rateLimit: RateLimitState) => Promise<void>
  ): Promise<{readonly lists: ReadonlyMap<string, NativeListCatalogPage['lists'][number]>; readonly rateLimit: RateLimitState}> {
    const lists = new Map<string, NativeListCatalogPage['lists'][number]>()
    const seenCursors = new Set<string>()
    let cursor: string | null = null
    let totalCount: number | null = null
    let rateLimit = initialRateLimit
    do {
      if (cursor !== null && !seenCursors.add(cursor)) {
        throw validationFailure('GitHub native List metadata pagination repeated a cursor.')
      }
      const page = await this.#reader.fetchNativeListCatalogPage(cursor)
      if (!Number.isSafeInteger(page.totalCount) || page.totalCount < 0) {
        throw validationFailure('GitHub native List metadata pagination returned an invalid total.')
      }
      if (totalCount === null) totalCount = page.totalCount
      else if (totalCount !== page.totalCount) {
        throw validationFailure('GitHub native List metadata pagination changed its total.')
      }
      rateLimit = mergeRateLimit(rateLimit, page.rateLimit)
      await onPage?.(page.rateLimit)
      for (const list of page.lists) {
        if (lists.has(list.listNodeId)) {
          throw validationFailure('GitHub native List metadata pagination repeated a List ID.')
        }
        lists.set(list.listNodeId, list)
      }
      cursor = nextCursor(page.pageInfo.hasNextPage, page.pageInfo.endCursor)
    } while (cursor)
    if (lists.size !== totalCount) {
      throw validationFailure('GitHub native List metadata pagination was incomplete.')
    }
    return {lists, rateLimit}
  }

  #timestamp(): string {
    return new Date(this.#now()).toISOString()
  }
}

function catalogFingerprintEntry(list: NativeListCatalogPage['lists'][number] | null): readonly unknown[] | null {
  return list === null
    ? null
    : [list.listNodeId, list.name, list.isPrivate ? 'private' : 'public', list.reportedItemCount]
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
