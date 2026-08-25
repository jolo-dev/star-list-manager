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
  getAnnotation,
  getNativeList,
  getRepository,
  listMembershipsForList,
  listMembershipsForRepository,
  listNativeLists,
  putAnnotation,
  putNativeList,
  putNativeMembership,
  putRepository,
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
    await putNativeMembership(database, {
      githubUserId,
      listNodeId: 'UL_old',
      repositoryNodeId: 'R_kept',
      lastObservedAt: timestamp
    })
    const repository = storedRepository()
    const annotation = storedAnnotation()
    await putRepository(database, repository)
    await putAnnotation(database, annotation)
    const service = new NativeListSyncService({
      database,
      reader: new FixtureReader([catalogPage([], false, null, 0)], {}),
      now: () => Date.parse(timestamp)
    })

    expect((await service.synchronize(githubUserId)).phase).toBe('complete')
    expect(await listNativeLists(database, githubUserId)).toEqual([])
    expect(await listMembershipsForRepository(database, githubUserId, 'R_kept')).toEqual([])
    expect(await getRepository(database, githubUserId, repository.repositoryNodeId)).toEqual(repository)
    expect(await getAnnotation(database, githubUserId, repository.repositoryNodeId)).toEqual(annotation)
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

  test('starts a new reconciliation after an overlapping preflight sync completes', async () => {
    const database = await testDatabase('native-lists-fresh-after-overlap')
    let releaseFirstCatalog!: () => void
    let beginFirstCatalog!: () => void
    const firstCatalogStarted = new Promise<void>((resolve) => { beginFirstCatalog = resolve })
    const firstCatalogReleased = new Promise<void>((resolve) => { releaseFirstCatalog = resolve })
    let catalogReads = 0
    const service = new NativeListSyncService({
      database,
      reader: {
        probeNativeLists: async () => ({available: true, rateLimit}),
        fetchNativeListCatalogPage: async () => {
          catalogReads += 1
          if (catalogReads === 1) {
            beginFirstCatalog()
            await firstCatalogReleased
            return catalogPage([listMetadata('UL_target', 'Before', 0)], false, null, 1)
          }
          return catalogPage([listMetadata('UL_target', 'After', 0)], false, null, 1)
        },
        fetchNativeListItemsPage: async () => itemsPage(0, [], false, null)
      },
      now: () => Date.parse(timestamp)
    })

    const preflight = service.synchronize(githubUserId)
    await firstCatalogStarted
    const fresh = service.synchronizeFresh(githubUserId)
    releaseFirstCatalog()
    await Promise.all([preflight, fresh])

    expect(catalogReads).toBe(2)
    expect((await getNativeList(database, githubUserId, 'UL_target'))?.name).toBe('After')
    database.close()
  })

  test('observes complete targeted catalog metadata and fingerprints changed name, visibility, and item count', async () => {
    const database = await testDatabase('native-lists-catalog-observation')
    const first = listMetadata('UL_target', 'Before', 1)
    const changed = {...listMetadata('UL_target', 'After', 2), isPrivate: true}
    const reader = new FixtureReader([catalogPage([first], false, null, 1)], {})
    const service = new NativeListSyncService({database, reader, now: () => Date.parse(timestamp)})
    const before = await service.observeCatalog(githubUserId, ['UL_target'])
    expect(before.complete).toBe(true)
    expect(before.targets.get('UL_target')).toMatchObject({name: 'Before', isPrivate: false, reportedItemCount: 1})

    const changedService = new NativeListSyncService({
      database,
      reader: new FixtureReader([catalogPage([changed], false, null, 1)], {}),
      now: () => Date.parse(timestamp)
    })
    const after = await changedService.observeCatalog(githubUserId, ['UL_target'])
    expect(after.targets.get('UL_target')).toMatchObject({name: 'After', isPrivate: true, reportedItemCount: 2})
    expect(after.fingerprint).not.toBe(before.fingerprint)
    database.close()
  })

  test('proves target absence only from a complete validated catalog without changing the mirror', async () => {
    const database = await testDatabase('native-lists-catalog-absence')
    await putNativeList(database, storedList('UL_existing'))
    const service = new NativeListSyncService({
      database,
      reader: new FixtureReader([catalogPage([], false, null, 0)], {}),
      now: () => Date.parse(timestamp)
    })
    const observation = await service.observeCatalog(githubUserId, ['UL_existing'])
    expect(observation.complete).toBe(true)
    expect(observation.targets.get('UL_existing')).toBeNull()
    expect(await getNativeList(database, githubUserId, 'UL_existing')).not.toBeNull()
    database.close()
  })

  test('rejects invalid catalog pagination and preserves the mirror', async () => {
    const invalidCatalogs = [
      [catalogPage([listMetadata('UL_a', 'A', 0)], true, 'repeat', 2), catalogPage([listMetadata('UL_b', 'B', 0)], true, 'repeat', 2)],
      [catalogPage([listMetadata('UL_a', 'A', 0)], true, null, 1)],
      [catalogPage([listMetadata('UL_a', 'A', 0), listMetadata('UL_a', 'A duplicate', 0)], false, null, 2)],
      [catalogPage([listMetadata('UL_a', 'A', 0)], false, null, 2)]
    ]
    for (const [index, catalog] of invalidCatalogs.entries()) {
      const database = await testDatabase(`native-lists-invalid-catalog-${index}`)
      await putNativeList(database, storedList('UL_existing'))
      const service = new NativeListSyncService({database, reader: new FixtureReader(catalog, {}), now: () => Date.parse(timestamp)})
      await expect(service.observeCatalog(githubUserId, ['UL_a'])).rejects.toThrow()
      expect(await getNativeList(database, githubUserId, 'UL_existing')).not.toBeNull()
      database.close()
    }
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

function storedRepository() {
  return {githubUserId, repositoryNodeId: 'R_kept', ownerLogin: 'octocat', name: 'kept', fullName: 'octocat/kept', htmlUrl: 'https://github.com/octocat/kept', description: null, topics: [], primaryLanguage: null, starredAt: timestamp, pushedAt: null, archived: false, disabled: false, isStarred: true, firstObservedAt: timestamp, lastObservedAt: timestamp, unstarredAt: null}
}

function storedAnnotation() {
  return {githubUserId, repositoryNodeId: 'R_kept', triageState: 'backlog' as const, tags: ['local'], note: 'kept', favorite: true, revisitAt: null, reviewedAt: timestamp, localModifiedAt: timestamp}
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
