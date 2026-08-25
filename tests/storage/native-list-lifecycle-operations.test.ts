import {describe, expect, test} from 'bun:test'
import {IDBFactory} from 'fake-indexeddb'
import {
  libraryDatabaseVersion,
  libraryStores,
  openLibraryDatabase
} from '../../src/storage/database'
import {
  cancelNativeListLifecycleOperationIfPreDispatch,
  clearAllLibraryData,
  deleteNativeListLifecycleOperationsForAccount,
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

  test('atomically cancels only the same queued or preflight operation', async () => {
    const database = await openLibraryDatabase({
      name: 'native-list-lifecycle-conditional-cancel',
      factory: new IDBFactory()
    })
    await putNativeListLifecycleOperation(database, lifecycleOperation('account-a', 'queued', 'queued'))
    expect(
      await cancelNativeListLifecycleOperationIfPreDispatch(
        database,
        'account-a',
        'queued',
        '2026-08-12T22:01:00.000Z'
      )
    ).toMatchObject({phase: 'cancelled', completedAt: '2026-08-12T22:01:00.000Z'})

    await putNativeListLifecycleOperation(database, lifecycleOperation('account-a', 'preflight', 'preflight'))
    expect(
      await cancelNativeListLifecycleOperationIfPreDispatch(
        database,
        'account-a',
        'preflight',
        '2026-08-12T22:01:00.000Z'
      )
    ).toMatchObject({phase: 'cancelled'})

    const mutating = {...lifecycleOperation('account-a', 'mutating', 'failed'), phase: 'mutating' as const, completedAt: null}
    await putNativeListLifecycleOperation(database, mutating)
    expect(
      await cancelNativeListLifecycleOperationIfPreDispatch(
        database,
        'account-a',
        'mutating',
        '2026-08-12T22:01:00.000Z'
      )
    ).toBeNull()
    expect((await listNativeListLifecycleOperations(database, 'account-a')).find((operation) => operation.operationId === 'mutating')).toEqual(mutating)
    database.close()
  })

  test('removes lifecycle operations when the selected account is deleted without crossing accounts', async () => {
    const database = await openLibraryDatabase({
      name: 'native-list-lifecycle-account-delete',
      factory: new IDBFactory()
    })
    await putNativeListLifecycleOperation(database, lifecycleOperation('account-a', 'create-a', 'cancelled'))
    const otherAccount = lifecycleOperation('account-b', 'create-b', 'failed')
    await putNativeListLifecycleOperation(database, otherAccount)

    await deleteNativeListLifecycleOperationsForAccount(database, 'account-a')

    expect(await listNativeListLifecycleOperations(database, 'account-a')).toEqual([])
    expect(await listNativeListLifecycleOperations(database, 'account-b')).toEqual([otherAccount])
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
