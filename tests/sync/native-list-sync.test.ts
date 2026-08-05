import {describe, expect, test} from 'bun:test'
import {IDBFactory} from 'fake-indexeddb'
import type {
  NativeListRecord,
  SyncStateRecord
} from '../../src/domain/types'
import type {
  NativeListCapability,
  NativeListCatalogPage,
  NativeListItemsPage
} from '../../src/github/graphql-client'
import {AppFailure} from '../../src/shared/errors'
import {openLibraryDatabase} from '../../src/storage/database'
import {
  getNativeList,
  listMembershipsForList,
  listMembershipsForRepository,
  listNativeLists,
  putNativeList,
  putSyncState
} from '../../src/storage/library'
import {
  NativeListSyncService,
  type NativeListReader
} from '../../src/sync/native-list-sync'

const githubUserId = '42'
const timestamp = '2026-08-03T12:00:00Z'
const rateLimit = {limit: 5000, remaining: 4999, resetAt: timestamp} as const

describe('native List synchronization', () => {
  test('paginates metadata and each List independently with multiple memberships', async () => {
    const database = await testDatabase('native-lists-paginated')
    const reader = new FixtureReader(
      [
        catalogPage([listMetadata('UL_a', 'List A', 2)], true, 'catalog-2', 2),
        catalogPage([listMetadata('UL_b', 'List B', 1)], false, null, 2)
      ],
      {
        UL_a: [
          itemsPage(2, ['R_one'], true, 'items-2'),
          itemsPage(2, ['R_two'], false, null)
        ],
        UL_b: [itemsPage(1, ['R_one'], false, null)]
      }
    )
    const service = new NativeListSyncService({
      database,
      reader,
      now: () => Date.parse(timestamp)
    })

    const state = await service.synchronize(githubUserId)
    expect(state).toMatchObject({phase: 'complete', pagesProcessed: 5, itemsObserved: 3})
    expect(await listNativeLists(database, githubUserId)).toHaveLength(2)
    expect(await listMembershipsForList(database, githubUserId, 'UL_a')).toHaveLength(2)
    expect(await listMembershipsForRepository(database, githubUserId, 'R_one')).toHaveLength(
      2
    )
    database.close()
  })

  test('reconciles deletion for a no-list account while preserving non-List data', async () => {
    const database = await testDatabase('native-lists-empty')
    await putNativeList(database, storedList('UL_old'))
    const service = new NativeListSyncService({
      database,
      reader: new FixtureReader([catalogPage([], false, null, 0)], {}),
      now: () => Date.parse(timestamp)
    })

    expect((await service.synchronize(githubUserId)).phase).toBe('complete')
    expect(await listNativeLists(database, githubUserId)).toEqual([])
    database.close()
  })

  test('marks Lists partial when reported items are inaccessible', async () => {
    const database = await testDatabase('native-lists-partial')
    const service = new NativeListSyncService({
      database,
      reader: new FixtureReader(
        [catalogPage([listMetadata('UL_partial', 'Partial', 2)], false, null, 1)],
        {UL_partial: [itemsPage(2, ['R_visible'], false, null)]}
      ),
      now: () => Date.parse(timestamp)
    })

    const state = await service.synchronize(githubUserId)
    expect(state).toMatchObject({phase: 'partial', skippedItems: 1})
    expect(await getNativeList(database, githubUserId, 'UL_partial')).toMatchObject({
      reportedItemCount: 2,
      importedItemCount: 1,
      importStatus: 'partial'
    })
    database.close()
  })

  test('preserves the prior mirror when capability is unavailable or sync is interrupted', async () => {
    const unavailableDatabase = await testDatabase('native-lists-unavailable')
    await putNativeList(unavailableDatabase, storedList('UL_existing'))
    const unavailable = new NativeListSyncService({
      database: unavailableDatabase,
      reader: new FixtureReader([], {}, false),
      now: () => Date.parse(timestamp)
    })
    expect((await unavailable.synchronize(githubUserId)).phase).toBe('unavailable')
    expect(await getNativeList(unavailableDatabase, githubUserId, 'UL_existing')).not.toBeNull()
    unavailableDatabase.close()

    const interruptedDatabase = await testDatabase('native-lists-interrupted')
    await putNativeList(interruptedDatabase, storedList('UL_existing'))
    await putSyncState(interruptedDatabase, completedSyncState())
    const interrupted = new NativeListSyncService({
      database: interruptedDatabase,
      reader: {
        probeNativeLists: async () => ({available: true, rateLimit}),
        fetchNativeListCatalogPage: async () => {
          throw new AppFailure({
            category: 'network',
            message: 'Native List sync was interrupted.',
            retryable: true
          })
        },
        fetchNativeListItemsPage: async () => itemsPage(0, [], false, null)
      },
      now: () => Date.parse(timestamp)
    })
    expect((await interrupted.synchronize(githubUserId)).phase).toBe('stale')
    expect(await getNativeList(interruptedDatabase, githubUserId, 'UL_existing')).not.toBeNull()
    interruptedDatabase.close()
  })
})

class FixtureReader implements NativeListReader {
  readonly #catalog: NativeListCatalogPage[]
  readonly #items: Record<string, NativeListItemsPage[]>
  readonly #available: boolean

  constructor(
    catalog: NativeListCatalogPage[],
    items: Record<string, NativeListItemsPage[]>,
    available = true
  ) {
    this.#catalog = [...catalog]
    this.#items = Object.fromEntries(
      Object.entries(items).map(([key, pages]) => [key, [...pages]])
    )
    this.#available = available
  }

  probeNativeLists(): Promise<NativeListCapability> {
    return Promise.resolve({available: this.#available, rateLimit})
  }

  async fetchNativeListCatalogPage(): Promise<NativeListCatalogPage> {
    const page = this.#catalog.shift()
    if (!page) throw new Error('Missing catalog page fixture.')
    return page
  }

  async fetchNativeListItemsPage(
    listNodeId: string
  ): Promise<NativeListItemsPage> {
    const page = this.#items[listNodeId]?.shift()
    if (!page) throw new Error(`Missing item page fixture for ${listNodeId}.`)
    return page
  }
}

function catalogPage(
  lists: NativeListCatalogPage['lists'],
  hasNextPage: boolean,
  endCursor: string | null,
  totalCount: number
): NativeListCatalogPage {
  return {lists, totalCount, pageInfo: {hasNextPage, endCursor}, rateLimit}
}

function listMetadata(listNodeId: string, name: string, reportedItemCount: number) {
  return {
    listNodeId,
    name,
    description: null,
    isPrivate: false,
    slug: name.toLocaleLowerCase().replaceAll(' ', '-'),
    createdAt: timestamp,
    updatedAt: timestamp,
    lastAddedAt: timestamp,
    reportedItemCount
  }
}

function itemsPage(
  totalCount: number,
  repositoryNodeIds: readonly string[],
  hasNextPage: boolean,
  endCursor: string | null
): NativeListItemsPage {
  return {
    totalCount,
    repositoryNodeIds,
    pageInfo: {hasNextPage, endCursor},
    rateLimit
  }
}

function storedList(listNodeId: string): NativeListRecord {
  return {
    githubUserId,
    listNodeId,
    name: 'Existing',
    description: null,
    visibility: 'public',
    slug: 'existing',
    createdAt: timestamp,
    updatedAt: timestamp,
    lastAddedAt: timestamp,
    reportedItemCount: 0,
    importedItemCount: 0,
    importStatus: 'complete',
    lastObservedAt: timestamp
  }
}

function completedSyncState(): SyncStateRecord {
  return {
    githubUserId,
    kind: 'native-lists',
    phase: 'complete',
    attempt: 1,
    pagesProcessed: 1,
    itemsObserved: 0,
    skippedItems: 0,
    convergenceAttempt: 0,
    baselineCompletedAt: timestamp,
    lastStartedAt: timestamp,
    lastCompletedAt: timestamp,
    lastSuccessfulAt: timestamp,
    rateLimit,
    lastError: null
  }
}

function testDatabase(name: string): Promise<IDBDatabase> {
  return openLibraryDatabase({name, factory: new IDBFactory()})
}
