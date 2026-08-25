import {expect, test} from 'bun:test'
import {IDBFactory} from 'fake-indexeddb'
import {
  libraryIndexes,
  libraryStores,
  openLibraryDatabase,
  requestResult
} from '../../src/storage/database'

test('version 4 migrates durable queue and history records with membership details', async () => {
  const factory = new IDBFactory()
  const name = 'membership-version-four-migration'
  const legacy = await createLegacyVersionThree(factory, name)
  legacy.close()

  const database = await openLibraryDatabase({factory, name})
  const transaction = database.transaction(['mutationJobs', 'operationHistory'], 'readonly')
  const job = await requestResult(transaction.objectStore('mutationJobs').get(['account-a', 'job']))
  const history = await requestResult(
    transaction.objectStore('operationHistory').get(['account-a', 'history'])
  )

  expect(database.version).toBe(5)
  expect(job).toMatchObject({jobId: 'job', membershipDetails: null})
  expect(history).toMatchObject({historyId: 'history', membershipDetails: null})
  database.close()
})

test('version 4 preserves existing records while adding lifecycle storage and indexes', async () => {
  const factory = new IDBFactory()
  const name = 'native-list-lifecycle-version-four-migration'
  const legacy = await createLegacyVersionFour(factory, name)
  legacy.close()

  const database = await openLibraryDatabase({factory, name})
  const transaction = database.transaction(
    [
      libraryStores.mutationJobs,
      libraryStores.operationHistory,
      libraryStores.nativeListLifecycleOperations
    ],
    'readonly'
  )
  const job = await requestResult(
    transaction.objectStore(libraryStores.mutationJobs).get(['account-a', 'job'])
  )
  const history = await requestResult(
    transaction.objectStore(libraryStores.operationHistory).get(['account-a', 'history'])
  )
  const lifecycle = transaction.objectStore(libraryStores.nativeListLifecycleOperations)

  expect(database.version).toBe(5)
  expect(job).toEqual({githubUserId: 'account-a', jobId: 'job', membershipDetails: null})
  expect(history).toEqual({githubUserId: 'account-a', historyId: 'history', membershipDetails: null})
  expect(lifecycle.indexNames.contains(libraryIndexes.byAccount)).toBe(true)
  expect(lifecycle.indexNames.contains(libraryIndexes.byStatus)).toBe(true)
  expect(lifecycle.indexNames.contains(libraryIndexes.byAccountStatus)).toBe(true)
  database.close()
})

function createLegacyVersionFour(factory: IDBFactory, name: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open(name, 4)
    request.onupgradeneeded = () => {
      request.result
        .createObjectStore(libraryStores.mutationJobs, {keyPath: ['githubUserId', 'jobId']})
        .put({githubUserId: 'account-a', jobId: 'job', membershipDetails: null})
      request.result
        .createObjectStore(libraryStores.operationHistory, {keyPath: ['githubUserId', 'historyId']})
        .put({githubUserId: 'account-a', historyId: 'history', membershipDetails: null})
    }
    request.onerror = () => reject(request.error ?? new Error('Unable to create legacy database.'))
    request.onsuccess = () => resolve(request.result)
  })
}

function createLegacyVersionThree(factory: IDBFactory, name: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open(name, 3)
    request.onupgradeneeded = () => {
      request.result
        .createObjectStore('mutationJobs', {keyPath: ['githubUserId', 'jobId']})
        .put({githubUserId: 'account-a', jobId: 'job'})
      request.result
        .createObjectStore('operationHistory', {keyPath: ['githubUserId', 'historyId']})
        .put({githubUserId: 'account-a', historyId: 'history'})
    }
    request.onerror = () => reject(request.error ?? new Error('Unable to create legacy database.'))
    request.onsuccess = () => resolve(request.result)
  })
}
