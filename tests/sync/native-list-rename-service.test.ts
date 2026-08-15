import {describe, expect, test} from 'bun:test'
import {IDBFactory} from 'fake-indexeddb'
import type {
  AnnotationRecord,
  NativeListRecord,
  NativeMembershipRecord
} from '../../src/domain/types'
import {
  ListRenameMutationFailure,
  type ListRenameMutationRequest
} from '../../src/github/list-rename-write-session'
import type {NativeListCatalogPage} from '../../src/github/graphql-client'
import {openLibraryDatabase} from '../../src/storage/database'
import {
  deleteNativeList,
  getAnnotation,
  getNativeList,
  listMembershipsForList,
  listNativeLists,
  putAnnotation,
  putNativeList,
  putNativeMembership
} from '../../src/storage/library'
import {
  NativeListRenameService,
  NativeListRenameServiceFailure,
  type NativeListRenameStorage
} from '../../src/sync/native-list-rename-service'

const githubUserId = '42'
const timestamp = '2026-08-15T12:00:00.000Z'

const target = nativeList('UL_target', 'Existing', {
  importedItemCount: 3,
  importStatus: 'partial',
  lastObservedAt: '2026-08-14T12:00:00.000Z'
})
const companion = nativeList('UL_companion', 'Archive')

describe('native List rename reconciliation', () => {
  test('persists only the verified target after every catalog page, preserving local membership state', async () => {
    const database = await testDatabase('rename-happy-pagination')
    await putNativeList(database, target)
    await putNativeList(database, companion)
    const membership = nativeMembership()
    const annotation = annotationFixture()
    await putNativeMembership(database, membership)
    await putAnnotation(database, annotation)

    const writer = new RecordingWriter({listNodeId: 'UL_target', name: 'untrusted mutation name'})
    const reader = new FixtureCatalogReader([
      catalogPage(
        [remoteList('UL_target', 'Tools', {description: 'Verified description', isPrivate: true})],
        true,
        'page-2',
        2
      ),
      catalogPage([remoteList('UL_companion', 'Archive')], false, null, 2)
    ])
    const putCalls: NativeListRecord[] = []
    const service = createService(database, reader, writer, {
      ...storageForDatabase(),
      putNativeList: async (database, list) => {
        putCalls.push(list)
        await putNativeList(database, list)
      }
    })

    const updated = await service.rename({
      expectedGitHubUserId: githubUserId,
      listNodeId: 'UL_target',
      name: '  Ｔools  '
    })

    expect(writer.requests).toEqual([
      {expectedGitHubUserId: githubUserId, listNodeId: 'UL_target', name: 'Tools'}
    ])
    expect(reader.cursors).toEqual([null, 'page-2'])
    expect(updated).toEqual({
      ...target,
      name: 'Tools',
      description: 'Verified description',
      visibility: 'private',
      slug: 'tools',
      createdAt: '2026-08-15T10:00:00.000Z',
      updatedAt: '2026-08-15T11:00:00.000Z',
      lastAddedAt: '2026-08-15T09:00:00.000Z',
      reportedItemCount: 7,
      lastObservedAt: timestamp
    })
    expect(await getNativeList(database, githubUserId, 'UL_target')).toEqual(updated)
    expect(await getNativeList(database, githubUserId, 'UL_companion')).toEqual(companion)
    expect(putCalls).toEqual([updated])
    expect(await listNativeLists(database, githubUserId)).toHaveLength(2)
    expect(await listMembershipsForList(database, githubUserId, membership.listNodeId)).toEqual([
      membership
    ])
    expect(await getAnnotation(database, githubUserId, annotation.repositoryNodeId)).toEqual(
      annotation
    )
    database.close()
  })

  test('reconciles an ambiguous network mutation to the exact target found in a complete catalog', async () => {
    const database = await databaseWithTarget('rename-ambiguous-network-confirmed')
    await putNativeList(database, companion)
    const writer = new RecordingWriter(
      {listNodeId: 'UL_target', name: 'untrusted mutation name'},
      ambiguousNetworkFailure()
    )
    const reader = new FixtureCatalogReader([
      catalogPage(
        [remoteList('UL_target', 'Tools', {description: 'Verified after ambiguous write'})],
        true,
        'page-2',
        2
      ),
      catalogPage([remoteList('UL_companion', 'Archive')], false, null, 2)
    ])
    const service = createService(database, reader, writer)

    const updated = await service.rename(renameRequest())

    expect(writer.requests).toEqual([
      {expectedGitHubUserId: githubUserId, listNodeId: 'UL_target', name: 'Tools'}
    ])
    expect(reader.cursors).toEqual([null, 'page-2'])
    expect(updated).toEqual({
      ...target,
      name: 'Tools',
      description: 'Verified after ambiguous write',
      slug: 'tools',
      createdAt: '2026-08-15T10:00:00.000Z',
      updatedAt: '2026-08-15T11:00:00.000Z',
      lastAddedAt: '2026-08-15T09:00:00.000Z',
      reportedItemCount: 7,
      lastObservedAt: timestamp
    })
    expect(await getNativeList(database, githubUserId, 'UL_target')).toEqual(updated)
    expect(await getNativeList(database, githubUserId, 'UL_companion')).toEqual(companion)
    database.close()
  })

  test('reconciles an ambiguous network mutation to divergent target metadata and requires a new save', async () => {
    const database = await databaseWithTarget('rename-ambiguous-network-divergent')
    await putNativeList(database, companion)
    const membership = nativeMembership()
    const annotation = annotationFixture()
    await putNativeMembership(database, membership)
    await putAnnotation(database, annotation)
    const writer = new RecordingWriter({listNodeId: 'UL_target', name: 'Tools'}, ambiguousNetworkFailure())
    const service = createService(
      database,
      new FixtureCatalogReader([
        catalogPage(
          [
            remoteList('UL_target', 'Concurrent', {description: 'Observed after ambiguous write'}),
            remoteList('UL_companion', 'Archive')
          ],
          false,
          null,
          2
        )
      ]),
      writer
    )

    const error = await expectFailure(service.rename(renameRequest()), 'read-back-name-mismatch')

    expect(error.publicError.message).not.toContain('writer transport secret')
    expect(await getNativeList(database, githubUserId, 'UL_target')).toEqual({
      ...target,
      name: 'Concurrent',
      description: 'Observed after ambiguous write',
      slug: 'concurrent',
      createdAt: '2026-08-15T10:00:00.000Z',
      updatedAt: '2026-08-15T11:00:00.000Z',
      lastAddedAt: '2026-08-15T09:00:00.000Z',
      reportedItemCount: 7,
      lastObservedAt: timestamp
    })
    expect(await getNativeList(database, githubUserId, 'UL_companion')).toEqual(companion)
    expect(await listMembershipsForList(database, githubUserId, membership.listNodeId)).toEqual([
      membership
    ])
    expect(await getAnnotation(database, githubUserId, annotation.repositoryNodeId)).toEqual(
      annotation
    )
    database.close()
  })

  test('removes only an ambiguously renamed target absent from a complete catalog', async () => {
    const database = await databaseWithTarget('rename-ambiguous-network-missing')
    await putNativeList(database, companion)
    const membership = nativeMembership()
    const annotation = annotationFixture()
    await putNativeMembership(database, membership)
    await putAnnotation(database, annotation)
    const writer = new RecordingWriter({listNodeId: 'UL_target', name: 'Tools'}, ambiguousNetworkFailure())
    const reader = new FixtureCatalogReader([catalogPage([remoteList('UL_companion', 'Archive')], false, null, 1)])
    const service = createService(database, reader, writer)

    const error = await expectFailure(service.rename(renameRequest()), 'read-back-target-missing')

    expect(error.publicError.message).not.toContain('writer transport secret')
    expect(reader.cursors).toEqual([null])
    expect(await getNativeList(database, githubUserId, 'UL_target')).toBeNull()
    expect(await getNativeList(database, githubUserId, 'UL_companion')).toEqual(companion)
    expect(await listMembershipsForList(database, githubUserId, membership.listNodeId)).toEqual([
      membership
    ])
    expect(await getAnnotation(database, githubUserId, annotation.repositoryNodeId)).toEqual(
      annotation
    )
    database.close()
  })

  test('leaves local state unchanged and rethrows the sanitized ambiguity when catalog reconciliation fails', async () => {
    const cases: ReadonlyArray<{readonly name: string; readonly reader: FixtureCatalogReader}> = [
      {
        name: 'reader error',
        reader: new FixtureCatalogReader([], new Error('catalog transport secret'))
      },
      {
        name: 'malformed catalog',
        reader: new FixtureCatalogReader([{} as unknown as NativeListCatalogPage])
      }
    ]

    for (const item of cases) {
      const database = await databaseWithTarget(`rename-ambiguous-network-${item.name}`)
      const originalFailure = ambiguousNetworkFailure()
      const writer = new RecordingWriter({listNodeId: 'UL_target', name: 'Tools'}, originalFailure)
      const service = createService(database, item.reader, writer)

      let caught: unknown
      try {
        await service.rename(renameRequest())
      } catch (error: unknown) {
        caught = error
      }

      expect(caught).toBe(originalFailure)
      expect(caught).toBeInstanceOf(ListRenameMutationFailure)
      expect(originalFailure.reason).toBe('network-ambiguous')
      expect(originalFailure.publicError.message).not.toContain('catalog transport secret')
      expect(item.reader.cursors).toEqual([null])
      expect(await getNativeList(database, githubUserId, 'UL_target')).toEqual(target)
      database.close()
    }
  })

  test('does not reconcile or alter state after a non-ambiguous writer failure', async () => {
    const database = await databaseWithTarget('rename-non-ambiguous-writer-failure')
    const reader = new FixtureCatalogReader([catalogPage([remoteList('UL_target', 'Tools')], false, null, 1)])
    const originalFailure = new ListRenameMutationFailure('permission', {
      category: 'permission',
      message: 'GitHub denied native List rename permission.',
      retryable: false
    })
    const service = createService(
      database,
      reader,
      new RecordingWriter({listNodeId: 'UL_target', name: 'Tools'}, originalFailure)
    )

    await expect(service.rename(renameRequest())).rejects.toBe(originalFailure)

    expect(reader.cursors).toEqual([])
    expect(await getNativeList(database, githubUserId, 'UL_target')).toEqual(target)
    database.close()
  })

  test('reconciles only a divergent target to authoritative catalog metadata without preserving an optimistic name', async () => {
    const database = await databaseWithTarget('rename-divergent-read-back')
    await putNativeList(database, companion)
    const membership = nativeMembership()
    const annotation = annotationFixture()
    await putNativeMembership(database, membership)
    await putAnnotation(database, annotation)
    const writer = new RecordingWriter({listNodeId: 'UL_target', name: 'Tools'})
    const putCalls: NativeListRecord[] = []
    const service = createService(
      database,
      new FixtureCatalogReader([
        catalogPage(
          [
            remoteList('UL_target', 'Concurrent', {
              description: 'Observed concurrent description',
              isPrivate: true,
              slug: 'concurrent',
              createdAt: '2026-08-15T10:30:00.000Z',
              updatedAt: '2026-08-15T11:30:00.000Z',
              lastAddedAt: '2026-08-15T09:30:00.000Z',
              reportedItemCount: 9
            }),
            remoteList('UL_companion', 'Archive')
          ],
          false,
          null,
          2
        )
      ]),
      writer,
      {
        ...storageForDatabase(),
        putNativeList: async (database, list) => {
          putCalls.push(list)
          await putNativeList(database, list)
        }
      }
    )

    await expectFailure(service.rename(renameRequest()), 'read-back-name-mismatch')
    expect(writer.requests).toHaveLength(1)
    const observed = {
      ...target,
      name: 'Concurrent',
      description: 'Observed concurrent description',
      visibility: 'private' as const,
      slug: 'concurrent',
      createdAt: '2026-08-15T10:30:00.000Z',
      updatedAt: '2026-08-15T11:30:00.000Z',
      lastAddedAt: '2026-08-15T09:30:00.000Z',
      reportedItemCount: 9,
      lastObservedAt: timestamp
    }
    expect(await getNativeList(database, githubUserId, 'UL_target')).toEqual(observed)
    expect(observed.name).not.toBe('Tools')
    expect(observed.importedItemCount).toBe(target.importedItemCount)
    expect(observed.importStatus).toBe(target.importStatus)
    expect(await getNativeList(database, githubUserId, 'UL_companion')).toEqual(companion)
    expect(await listMembershipsForList(database, githubUserId, membership.listNodeId)).toEqual([
      membership
    ])
    expect(await getAnnotation(database, githubUserId, annotation.repositoryNodeId)).toEqual(
      annotation
    )
    expect(putCalls).toEqual([observed])
    database.close()
  })

  test('rejects incomplete, malformed-cursor, and duplicate-ID fresh catalogs without changing the target', async () => {
    const cases: ReadonlyArray<{
      readonly name: string
      readonly pages: NativeListCatalogPage[]
      readonly reason: NativeListRenameServiceFailure['reason']
    }> = [
      {
        name: 'reported total mismatch',
        pages: [catalogPage([remoteList('UL_target', 'Tools')], false, null, 2)],
        reason: 'catalog-incomplete'
      },
      {
        name: 'missing next cursor',
        pages: [catalogPage([remoteList('UL_target', 'Tools')], true, null, 1)],
        reason: 'catalog-invalid'
      },
      {
        name: 'duplicate IDs across pages',
        pages: [
          catalogPage([remoteList('UL_target', 'Tools')], true, 'next', 2),
          catalogPage([remoteList('UL_target', 'Tools')], false, null, 2)
        ],
        reason: 'catalog-duplicate'
      }
    ]

    for (const item of cases) {
      const database = await databaseWithTarget(`rename-${item.name}`)
      const writer = new RecordingWriter({listNodeId: 'UL_target', name: 'Tools'})
      const service = createService(database, new FixtureCatalogReader(item.pages), writer)

      await expectFailure(service.rename(renameRequest()), item.reason)
      expect(writer.requests).toHaveLength(1)
      expect(await getNativeList(database, githubUserId, 'UL_target')).toEqual(target)
      database.close()
    }
  })

  test('removes only a target absent from a complete authoritative catalog without deleting related local state', async () => {
    const database = await databaseWithTarget('rename-missing-read-back')
    await putNativeList(database, companion)
    const membership = nativeMembership()
    const annotation = annotationFixture()
    await putNativeMembership(database, membership)
    await putAnnotation(database, annotation)
    const writer = new RecordingWriter({listNodeId: 'UL_target', name: 'Tools'})
    const putCalls: NativeListRecord[] = []
    const deleteCalls: Array<readonly [string, string]> = []
    const service = createService(
      database,
      new FixtureCatalogReader([catalogPage([remoteList('UL_companion', 'Archive')], false, null, 1)]),
      writer,
      {
        ...storageForDatabase(),
        putNativeList: async (database, list) => {
          putCalls.push(list)
          await putNativeList(database, list)
        },
        deleteNativeList: async (database, userId, listNodeId) => {
          deleteCalls.push([userId, listNodeId])
          await deleteNativeList(database, userId, listNodeId)
        }
      }
    )

    await expectFailure(service.rename(renameRequest()), 'read-back-target-missing')
    expect(writer.requests).toHaveLength(1)
    expect(await getNativeList(database, githubUserId, 'UL_target')).toBeNull()
    expect(await getNativeList(database, githubUserId, 'UL_companion')).toEqual(companion)
    expect(await listNativeLists(database, githubUserId)).toEqual([companion])
    expect(await listMembershipsForList(database, githubUserId, membership.listNodeId)).toEqual([
      membership
    ])
    expect(await getAnnotation(database, githubUserId, annotation.repositoryNodeId)).toEqual(
      annotation
    )
    expect(putCalls).toEqual([])
    expect(deleteCalls).toEqual([[githubUserId, 'UL_target']])
    database.close()
  })

  test('rejects duplicate fresh names and reader errors without changing the target', async () => {
    const cases: ReadonlyArray<{
      readonly name: string
      readonly reader: FixtureCatalogReader
      readonly reason: NativeListRenameServiceFailure['reason']
    }> = [
      {
        name: 'duplicate fresh name',
        reader: new FixtureCatalogReader([
          catalogPage(
            [remoteList('UL_target', 'Tools'), remoteList('UL_other', ' tools ')],
            false,
            null,
            2
          )
        ]),
        reason: 'read-back-duplicate-name'
      },
      {
        name: 'reader error',
        reader: new FixtureCatalogReader([], new Error('reader secret')),
        reason: 'catalog-reader-failed'
      }
    ]

    for (const item of cases) {
      const database = await databaseWithTarget(`rename-${item.name}`)
      const writer = new RecordingWriter({listNodeId: 'UL_target', name: 'Tools'})
      const service = createService(database, item.reader, writer)

      const error = await expectFailure(service.rename(renameRequest()), item.reason)
      expect(error.publicError.message).not.toContain('secret')
      expect(writer.requests).toHaveLength(1)
      expect(await getNativeList(database, githubUserId, 'UL_target')).toEqual(target)
      database.close()
    }
  })

  test('rejects absent or account-mismatched local targets before remote mutation', async () => {
    const database = await testDatabase('rename-local-target-rejections')
    const writer = new RecordingWriter({listNodeId: 'UL_target', name: 'Tools'})
    const absent = createService(database, new FixtureCatalogReader([]), writer)

    await expectFailure(absent.rename(renameRequest()), 'local-target-missing')
    expect(writer.requests).toEqual([])

    const accountMismatch = createService(database, new FixtureCatalogReader([]), writer, {
      ...storageForDatabase(),
      getNativeList: async () => ({...target, githubUserId: '84'})
    })
    await expectFailure(accountMismatch.rename(renameRequest()), 'local-account-mismatch')
    expect(writer.requests).toEqual([])
    database.close()
  })

  test('rejects local canonical collisions before remote mutation', async () => {
    const database = await databaseWithTarget('rename-local-collision')
    await putNativeList(database, nativeList('UL_other', ' ｔＯＯｌＳ '))
    const writer = new RecordingWriter({listNodeId: 'UL_target', name: 'Tools'})
    const service = createService(database, new FixtureCatalogReader([]), writer)

    await expectFailure(service.rename(renameRequest()), 'local-duplicate-name')
    expect(writer.requests).toEqual([])
    expect(await getNativeList(database, githubUserId, 'UL_target')).toEqual(target)
    database.close()
  })

  test('rejects local Unicode case-fold-equivalent collisions before remote mutation', async () => {
    const database = await databaseWithTarget('rename-local-unicode-casefold-collision')
    await putNativeList(database, nativeList('UL_other', 'Straße'))
    const writer = new RecordingWriter({listNodeId: 'UL_target', name: 'STRASSE'})
    const service = createService(database, new FixtureCatalogReader([]), writer)

    await expectFailure(
      service.rename({...renameRequest(), name: 'STRASSE'}),
      'local-duplicate-name'
    )
    expect(writer.requests).toEqual([])
    expect(await getNativeList(database, githubUserId, 'UL_target')).toEqual(target)
    database.close()
  })

  test('rejects fresh Unicode case-fold-equivalent collisions after strict target read-back', async () => {
    const database = await databaseWithTarget('rename-fresh-unicode-casefold-collision')
    const writer = new RecordingWriter({listNodeId: 'UL_target', name: 'STRASSE'})
    const service = createService(
      database,
      new FixtureCatalogReader([
        catalogPage(
          [remoteList('UL_target', 'STRASSE'), remoteList('UL_other', 'Straße')],
          false,
          null,
          2
        )
      ]),
      writer
    )

    await expectFailure(
      service.rename({...renameRequest(), name: 'STRASSE'}),
      'read-back-duplicate-name'
    )
    expect(writer.requests).toEqual([
      {expectedGitHubUserId: githubUserId, listNodeId: 'UL_target', name: 'STRASSE'}
    ])
    expect(await getNativeList(database, githubUserId, 'UL_target')).toEqual(target)
    database.close()
  })

  test('keeps fresh target name evidence exact despite Unicode case-fold equivalence', async () => {
    const database = await databaseWithTarget('rename-fresh-exact-target-evidence')
    const writer = new RecordingWriter({listNodeId: 'UL_target', name: 'STRASSE'})
    const service = createService(
      database,
      new FixtureCatalogReader([catalogPage([remoteList('UL_target', 'Straße')], false, null, 1)]),
      writer
    )

    await expectFailure(
      service.rename({...renameRequest(), name: 'STRASSE'}),
      'read-back-name-mismatch'
    )
    expect(writer.requests).toHaveLength(1)
    expect(await getNativeList(database, githubUserId, 'UL_target')).toEqual({
      ...target,
      name: 'Straße',
      description: null,
      slug: 'straße',
      createdAt: '2026-08-15T10:00:00.000Z',
      updatedAt: '2026-08-15T11:00:00.000Z',
      lastAddedAt: '2026-08-15T09:00:00.000Z',
      reportedItemCount: 7,
      lastObservedAt: timestamp
    })
    database.close()
  })

  test('rejects mismatched direct and catalog local targets before remote mutation or persistence', async () => {
    const cases: ReadonlyArray<{
      readonly name: string
      readonly storage: NativeListRenameStorage
      readonly reason: NativeListRenameServiceFailure['reason']
    }> = [
      {
        name: 'direct lookup with a different List ID',
        storage: {
          ...storageForDatabase(),
          getNativeList: async () => nativeList('UL_other', 'Other')
        },
        reason: 'local-target-missing'
      },
      {
        name: 'catalog missing the direct lookup target',
        storage: {...storageForDatabase(), listNativeLists: async () => []},
        reason: 'local-target-missing'
      },
      {
        name: 'catalog target with another account',
        storage: {
          ...storageForDatabase(),
          listNativeLists: async () => [{...target, githubUserId: '84'}]
        },
        reason: 'local-account-mismatch'
      },
      {
        name: 'multiple matching catalog targets',
        storage: {...storageForDatabase(), listNativeLists: async () => [target, target]},
        reason: 'local-target-missing'
      }
    ]

    for (const item of cases) {
      const database = await databaseWithTarget(`rename-${item.name}`)
      const writer = new RecordingWriter({listNodeId: 'UL_target', name: 'Tools'})
      const putCalls: NativeListRecord[] = []
      const service = createService(database, verifiedTargetReader(), writer, {
        ...item.storage,
        putNativeList: async (database, list) => {
          putCalls.push(list)
          await putNativeList(database, list)
        }
      })

      await expectFailure(service.rename(renameRequest()), item.reason)
      expect(writer.requests).toEqual([])
      expect(putCalls).toEqual([])
      expect(await getNativeList(database, githubUserId, 'UL_target')).toEqual(target)
      database.close()
    }
  })

  test('rejects malformed catalog date and rate-limit metadata without local persistence', async () => {
    const cases: ReadonlyArray<{
      readonly name: string
      readonly page: NativeListCatalogPage
      readonly secret: string
    }> = [
      {
        name: 'malformed List timestamp',
        page: catalogPage(
          [remoteList('UL_target', 'Tools', {createdAt: 'timestamp-secret'})],
          false,
          null,
          1
        ),
        secret: 'timestamp-secret'
      },
      {
        name: 'malformed rate-limit timestamp',
        page: {
          ...catalogPage([remoteList('UL_target', 'Tools')], false, null, 1),
          rateLimit: {limit: 5000, remaining: 4999, resetAt: 'rate-limit-secret'}
        },
        secret: 'rate-limit-secret'
      }
    ]

    for (const item of cases) {
      const database = await databaseWithTarget(`rename-${item.name}`)
      const writer = new RecordingWriter({listNodeId: 'UL_target', name: 'Tools'})
      const putCalls: NativeListRecord[] = []
      const service = createService(database, new FixtureCatalogReader([item.page]), writer, {
        ...storageForDatabase(),
        putNativeList: async (database, list) => {
          putCalls.push(list)
          await putNativeList(database, list)
        }
      })

      const error = await expectFailure(service.rename(renameRequest()), 'catalog-invalid')
      expect(error.publicError.message).not.toContain(item.secret)
      expect(writer.requests).toHaveLength(1)
      expect(putCalls).toEqual([])
      expect(await getNativeList(database, githubUserId, 'UL_target')).toEqual(target)
      database.close()
    }
  })

  test('rejects repeated cursors, catalog total changes, and page bounds without local persistence', async () => {
    const cases: ReadonlyArray<{
      readonly name: string
      readonly pages: NativeListCatalogPage[]
      readonly maxCatalogPages?: number
      readonly reason: NativeListRenameServiceFailure['reason']
    }> = [
      {
        name: 'repeated non-null cursor',
        pages: [
          catalogPage([remoteList('UL_target', 'Tools')], true, 'again', 2),
          catalogPage([remoteList('UL_companion', 'Archive')], true, 'again', 2)
        ],
        reason: 'catalog-invalid'
      },
      {
        name: 'catalog total changes across pages',
        pages: [
          catalogPage([remoteList('UL_target', 'Tools')], true, 'next', 2),
          catalogPage([remoteList('UL_companion', 'Archive')], false, null, 3)
        ],
        reason: 'catalog-incomplete'
      },
      {
        name: 'configured catalog page bound is exhausted',
        pages: [catalogPage([remoteList('UL_target', 'Tools')], true, 'next', 2)],
        maxCatalogPages: 1,
        reason: 'catalog-bound-exceeded'
      }
    ]

    for (const item of cases) {
      const database = await databaseWithTarget(`rename-${item.name}`)
      const writer = new RecordingWriter({listNodeId: 'UL_target', name: 'Tools'})
      const putCalls: NativeListRecord[] = []
      const service = createService(
        database,
        new FixtureCatalogReader(item.pages),
        writer,
        {
          ...storageForDatabase(),
          putNativeList: async (database, list) => {
            putCalls.push(list)
            await putNativeList(database, list)
          }
        },
        item.maxCatalogPages
      )

      await expectFailure(service.rename(renameRequest()), item.reason)
      expect(writer.requests).toHaveLength(1)
      expect(putCalls).toEqual([])
      expect(await getNativeList(database, githubUserId, 'UL_target')).toEqual(target)
      database.close()
    }
  })

  test('rejects non-enumerable and symbol request keys before remote mutation or persistence', async () => {
    const requests = [
      Object.defineProperty({...renameRequest()}, 'arbitrary', {value: true}),
      Object.defineProperty({...renameRequest()}, Symbol('arbitrary'), {value: true})
    ]

    for (const request of requests) {
      const database = await databaseWithTarget('rename-untrusted-request-keys')
      const writer = new RecordingWriter({listNodeId: 'UL_target', name: 'Tools'})
      const putCalls: NativeListRecord[] = []
      const service = createService(database, new FixtureCatalogReader([]), writer, {
        ...storageForDatabase(),
        putNativeList: async (database, list) => {
          putCalls.push(list)
          await putNativeList(database, list)
        }
      })

      await expectFailure(service.rename(request), 'invalid-request')
      expect(writer.requests).toEqual([])
      expect(putCalls).toEqual([])
      expect(await getNativeList(database, githubUserId, 'UL_target')).toEqual(target)
      database.close()
    }
  })
})

function createService(
  database: IDBDatabase,
  reader: FixtureCatalogReader,
  writer: RecordingWriter,
  storage: NativeListRenameStorage = storageForDatabase(),
  maxCatalogPages?: number
): NativeListRenameService {
  return new NativeListRenameService({
    database,
    storage,
    reader,
    writer,
    now: () => Date.parse(timestamp),
    ...(maxCatalogPages === undefined ? {} : {maxCatalogPages})
  })
}

function verifiedTargetReader(): FixtureCatalogReader {
  return new FixtureCatalogReader([catalogPage([remoteList('UL_target', 'Tools')], false, null, 1)])
}

function storageForDatabase(): NativeListRenameStorage {
  return {getNativeList, listNativeLists, putNativeList, deleteNativeList}
}

class RecordingWriter {
  readonly requests: ListRenameMutationRequest[] = []
  readonly #result: {readonly listNodeId: string; readonly name: string}
  readonly #failure: ListRenameMutationFailure | null

  constructor(
    result: {readonly listNodeId: string; readonly name: string},
    failure: ListRenameMutationFailure | null = null
  ) {
    this.#result = result
    this.#failure = failure
  }

  rename(request: ListRenameMutationRequest): Promise<{readonly listNodeId: string; readonly name: string}> {
    this.requests.push(request)
    return this.#failure ? Promise.reject(this.#failure) : Promise.resolve(this.#result)
  }
}

class FixtureCatalogReader {
  readonly cursors: Array<string | null> = []
  readonly #pages: NativeListCatalogPage[]
  readonly #error: Error | null

  constructor(pages: NativeListCatalogPage[], error: Error | null = null) {
    this.#pages = [...pages]
    this.#error = error
  }

  fetchNativeListCatalogPage(after: string | null): Promise<NativeListCatalogPage> {
    this.cursors.push(after)
    if (this.#error) return Promise.reject(this.#error)
    const page = this.#pages.shift()
    if (!page) return Promise.reject(new Error('Missing catalog page.'))
    return Promise.resolve(page)
  }
}

function renameRequest(): ListRenameMutationRequest {
  return {expectedGitHubUserId: githubUserId, listNodeId: 'UL_target', name: ' Tools '}
}

function ambiguousNetworkFailure(): ListRenameMutationFailure {
  return new ListRenameMutationFailure('network-ambiguous', {
    category: 'network',
    message: 'The native List rename may have been sent, but GitHub did not return a response.',
    retryable: true
  })
}

function catalogPage(
  lists: NativeListCatalogPage['lists'],
  hasNextPage: boolean,
  endCursor: string | null,
  totalCount: number
): NativeListCatalogPage {
  return {
    lists,
    totalCount,
    pageInfo: {hasNextPage, endCursor},
    rateLimit: {limit: 5000, remaining: 4999, resetAt: timestamp}
  }
}

function remoteList(
  listNodeId: string,
  name: string,
  overrides: Partial<NativeListCatalogPage['lists'][number]> = {}
): NativeListCatalogPage['lists'][number] {
  return {
    listNodeId,
    name,
    description: null,
    isPrivate: false,
    slug: name.trim().toLocaleLowerCase().replaceAll(' ', '-'),
    createdAt: '2026-08-15T10:00:00.000Z',
    updatedAt: '2026-08-15T11:00:00.000Z',
    lastAddedAt: '2026-08-15T09:00:00.000Z',
    reportedItemCount: 7,
    ...overrides
  }
}

function nativeList(
  listNodeId: string,
  name: string,
  overrides: Partial<NativeListRecord> = {}
): NativeListRecord {
  return {
    githubUserId,
    listNodeId,
    name,
    description: 'Previous description',
    visibility: 'public',
    slug: 'existing',
    createdAt: '2026-08-01T10:00:00.000Z',
    updatedAt: '2026-08-01T11:00:00.000Z',
    lastAddedAt: '2026-08-01T09:00:00.000Z',
    reportedItemCount: 3,
    importedItemCount: 3,
    importStatus: 'complete',
    lastObservedAt: '2026-08-01T12:00:00.000Z',
    ...overrides
  }
}

function nativeMembership(): NativeMembershipRecord {
  return {
    githubUserId,
    listNodeId: 'UL_target',
    repositoryNodeId: 'R_fixture',
    lastObservedAt: '2026-08-14T12:00:00.000Z'
  }
}

function annotationFixture(): AnnotationRecord {
  return {
    githubUserId,
    repositoryNodeId: 'R_fixture',
    triageState: 'backlog',
    tags: ['Research'],
    note: 'Unchanged local annotation.',
    favorite: true,
    revisitAt: null,
    reviewedAt: null,
    localModifiedAt: '2026-08-14T12:00:00.000Z'
  }
}

async function databaseWithTarget(name: string): Promise<IDBDatabase> {
  const database = await testDatabase(name)
  await putNativeList(database, target)
  return database
}

function testDatabase(name: string): Promise<IDBDatabase> {
  return openLibraryDatabase({name, factory: new IDBFactory()})
}

async function expectFailure(
  promise: Promise<unknown>,
  reason: NativeListRenameServiceFailure['reason']
): Promise<NativeListRenameServiceFailure> {
  try {
    await promise
    throw new Error(`Expected ${reason}`)
  } catch (error: unknown) {
    expect(error).toBeInstanceOf(NativeListRenameServiceFailure)
    if (!(error instanceof NativeListRenameServiceFailure)) throw error
    expect(error.reason).toBe(reason)
    return error
  }
}
