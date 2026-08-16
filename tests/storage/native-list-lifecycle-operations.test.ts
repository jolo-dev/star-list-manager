import {describe, expect, test} from 'bun:test'
import {IDBFactory} from 'fake-indexeddb'
import {
  libraryDatabaseVersion,
  libraryStores,
  openLibraryDatabase
} from '../../src/storage/database'
import {
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

  test('persists one active lifecycle operation per account without crossing account state', async () => {
    const database = await openLibraryDatabase({
      name: 'native-list-lifecycle-operations',
      factory: new IDBFactory()
    })
    const create = lifecycleOperation('account-a', 'create-a', 'queued')
    await putNativeListLifecycleOperation(database, create)

    expect(await getActiveNativeListLifecycleOperation(database, 'account-a')).toEqual(
      create
    )
    expect(await listNativeListLifecycleOperations(database, 'account-b')).toEqual([])
    await expect(
      putNativeListLifecycleOperation(
        database,
        lifecycleOperation('account-a', 'delete-a', 'preflight')
      )
    ).rejects.toThrow('active native List lifecycle operation')
    database.close()
  })
})

function lifecycleOperation(
  githubUserId: string,
  operationId: string,
  phase: 'queued' | 'preflight'
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
    completedAt: null
  }
}
