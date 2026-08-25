import {describe, expect, test} from 'bun:test'
import {IDBFactory} from 'fake-indexeddb'
import {
  libraryDatabaseVersion,
  libraryStores,
  openLibraryDatabase
} from '../../src/storage/database'
import {
  clearAllLibraryData,
  getActiveNativeListLifecycleOperation,
  listNativeListLifecycleOperations,
  putNativeListLifecycleOperation
} from '../../src/storage/library'

describe('native List lifecycle operation storage', () => {
  test('adds a versioned lifecycle-operation store', async () => {
    expect(libraryDatabaseVersion).toBe(5)

    const database = await openLibraryDatabase({
      name: 'native-list-lifecycle-store',
      factory: new IDBFactory()
    })
    expect([...database.objectStoreNames]).toContain('nativeListLifecycleOperations')
    expect(libraryStores.nativeListLifecycleOperations).toBe(
      'nativeListLifecycleOperations'
    )
    database.close()
  })

  test('persists create intent, delete snapshot, and terminal operation history per account', async () => {
    const database = await openLibraryDatabase({
      name: 'native-list-lifecycle-history',
      factory: new IDBFactory()
    })
    const create = lifecycleOperation('account-a', 'create-a', 'queued')
    const deleted = {
      ...lifecycleOperation('account-a', 'delete-a', 'succeeded'),
      intent: {
        kind: 'delete' as const,
        listNodeId: 'L_disposable',
        name: 'Disposable List',
        visibility: 'private' as const,
        reportedItemCount: 3,
        importStatus: 'partial' as const
      },
      candidateListNodeId: 'L_disposable',
      confirmationFingerprint: 'catalog-fingerprint',
      completedAt: '2026-08-12T22:05:00.000Z'
    }
    const otherAccount = lifecycleOperation('account-b', 'create-b', 'preflight')
    await putNativeListLifecycleOperation(database, create)
    await putNativeListLifecycleOperation(database, deleted)
    await putNativeListLifecycleOperation(database, otherAccount)

    expect(await getActiveNativeListLifecycleOperation(database, 'account-a')).toEqual(create)
    expect(await listNativeListLifecycleOperations(database, 'account-a')).toEqual([create, deleted])
    expect(await listNativeListLifecycleOperations(database, 'account-b')).toEqual([otherAccount])
    await expect(
      putNativeListLifecycleOperation(
        database,
        lifecycleOperation('account-a', 'delete-active', 'preflight')
      )
    ).rejects.toThrow('active native List lifecycle operation')
    database.close()
  })

  test('removes lifecycle operations with complete local-data deletion', async () => {
    const database = await openLibraryDatabase({
      name: 'native-list-lifecycle-clear-all',
      factory: new IDBFactory()
    })
    await putNativeListLifecycleOperation(database, lifecycleOperation('account-a', 'create-a', 'cancelled'))
    await putNativeListLifecycleOperation(database, lifecycleOperation('account-b', 'create-b', 'failed'))

    await clearAllLibraryData(database)

    expect(await listNativeListLifecycleOperations(database, 'account-a')).toEqual([])
    expect(await listNativeListLifecycleOperations(database, 'account-b')).toEqual([])
    database.close()
  })
})

function lifecycleOperation(
  githubUserId: string,
  operationId: string,
  phase: 'queued' | 'preflight' | 'succeeded' | 'cancelled' | 'failed'
) {
  return {
    githubUserId,
    operationId,
    intent: {kind: 'create' as const, name: 'Ideas', visibility: 'private' as const},
    phase,
    attemptCount: 0,
    candidateListNodeId: null,
    confirmationFingerprint: null,
    lastError: null,
    createdAt: '2026-08-12T22:00:00.000Z',
    updatedAt: '2026-08-12T22:00:00.000Z',
    completedAt: phase === 'queued' || phase === 'preflight' ? null : '2026-08-12T22:05:00.000Z'
  }
}
