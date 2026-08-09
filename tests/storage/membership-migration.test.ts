import {expect, test} from 'bun:test'
import {IDBFactory} from 'fake-indexeddb'
import {openLibraryDatabase, requestResult} from '../../src/storage/database'

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

  expect(database.version).toBe(4)
  expect(job).toMatchObject({jobId: 'job', membershipDetails: null})
  expect(history).toMatchObject({historyId: 'history', membershipDetails: null})
  database.close()
})

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
