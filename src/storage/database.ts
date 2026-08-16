export const libraryDatabaseName = 'star-list-manager'
export const libraryDatabaseVersion = 5

export const libraryStores = {
  repositories: 'repositories',
  nativeLists: 'nativeLists',
  nativeMemberships: 'nativeMemberships',
  annotations: 'annotations',
  syncState: 'syncState',
  authState: 'authState',
  writeAuthState: 'writeAuthState',
  settings: 'settings',
  mutationBatches: 'mutationBatches',
  mutationJobs: 'mutationJobs',
  mutationAttempts: 'mutationAttempts',
  operationHistory: 'operationHistory',
  nativeListLifecycleOperations: 'nativeListLifecycleOperations'
} as const

export type LibraryStoreName = (typeof libraryStores)[keyof typeof libraryStores]

export const libraryIndexes = {
  byAccount: 'byAccount',
  byAccountName: 'byAccountName',
  byAccountStarred: 'byAccountStarred',
  byList: 'byList',
  byRepository: 'byRepository',
  byTriage: 'byTriage',
  byFavorite: 'byFavorite',
  byTag: 'byTag',
  byPhase: 'byPhase',
  byStatus: 'byStatus',
  byAccountStatus: 'byAccountStatus',
  byAccountRepository: 'byAccountRepository',
  byBatch: 'byBatch',
  byAccountBatch: 'byAccountBatch',
  byNextEligibleExecution: 'byNextEligibleExecution',
  byAccountNextEligibleExecution: 'byAccountNextEligibleExecution'
} as const

export interface OpenLibraryDatabaseOptions {
  readonly name?: string
  readonly factory?: IDBFactory
  readonly onUpgrade?: (oldVersion: number, newVersion: number) => void
}

export function openLibraryDatabase(
  options: OpenLibraryDatabaseOptions = {}
): Promise<IDBDatabase> {
  const factory = options.factory ?? globalThis.indexedDB
  if (!factory) return Promise.reject(new Error('IndexedDB is unavailable.'))

  return new Promise((resolve, reject) => {
    const request = factory.open(
      options.name ?? libraryDatabaseName,
      libraryDatabaseVersion
    )

    request.onupgradeneeded = (event) => {
      const transaction = request.transaction
      if (!transaction) {
        reject(new Error('IndexedDB upgrade transaction is unavailable.'))
        return
      }

      try {
        migrateLibraryDatabase(request.result, transaction, event.oldVersion)
        options.onUpgrade?.(event.oldVersion, event.newVersion ?? libraryDatabaseVersion)
      } catch (error: unknown) {
        transaction.abort()
        reject(error)
      }
    }
    request.onerror = () => reject(request.error ?? new Error('Unable to open IndexedDB.'))
    request.onblocked = () => reject(new Error('IndexedDB upgrade is blocked.'))
    request.onsuccess = () => resolve(request.result)
  })
}

export function deleteLibraryDatabase(
  name = libraryDatabaseName,
  factory: IDBFactory = globalThis.indexedDB
): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = factory.deleteDatabase(name)
    request.onerror = () => reject(request.error ?? new Error('Unable to delete IndexedDB.'))
    request.onblocked = () => reject(new Error('IndexedDB deletion is blocked.'))
    request.onsuccess = () => resolve()
  })
}

export async function runLibraryTransaction<T>(
  database: IDBDatabase,
  storeNames: LibraryStoreName | readonly LibraryStoreName[],
  mode: IDBTransactionMode,
  operation: (transaction: IDBTransaction) => T | Promise<T>
): Promise<T> {
  const transaction = database.transaction(storeNames, mode)
  const completion = transactionCompletion(transaction).then(
    () => null,
    (error: unknown) => error
  )

  try {
    const result = await operation(transaction)
    const completionError = await completion
    if (completionError) throw completionError
    return result
  } catch (error: unknown) {
    try {
      transaction.abort()
    } catch {
      // The transaction may already have aborted because of a failed request.
    }
    await completion
    throw error
  }
}

export function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed.'))
    request.onsuccess = () => resolve(request.result)
  })
}

function migrateLibraryDatabase(
  database: IDBDatabase,
  transaction: IDBTransaction,
  oldVersion: number
): void {
  if (oldVersion < 1) createLibraryDatabaseVersionOne(database)
  if (oldVersion < 2) {
    database.createObjectStore(libraryStores.writeAuthState, {
      keyPath: 'githubUserId'
    })
  }
  if (oldVersion < 3) createLibraryDatabaseVersionThree(database)
  if (oldVersion < 4) migrateLibraryDatabaseVersionFour(transaction)
  if (oldVersion < 5) createLibraryDatabaseVersionFive(database)
}

function createLibraryDatabaseVersionFive(database: IDBDatabase): void {
  const operations = database.createObjectStore(
    libraryStores.nativeListLifecycleOperations,
    {keyPath: ['githubUserId', 'operationId']}
  )
  operations.createIndex(libraryIndexes.byAccount, 'githubUserId')
  operations.createIndex(libraryIndexes.byStatus, 'phase')
  operations.createIndex(libraryIndexes.byAccountStatus, ['githubUserId', 'phase'])
}

function migrateLibraryDatabaseVersionFour(transaction: IDBTransaction): void {
  for (const storeName of [libraryStores.mutationJobs, libraryStores.operationHistory]) {
    const request = transaction.objectStore(storeName).openCursor()
    request.onsuccess = () => {
      const cursor = request.result
      if (!cursor) return
      const value: unknown = cursor.value
      if (typeof value === 'object' && value !== null) {
        cursor.update({...value, membershipDetails: null})
      }
      cursor.continue()
    }
  }
}

function createLibraryDatabaseVersionThree(database: IDBDatabase): void {
  const batches = database.createObjectStore(libraryStores.mutationBatches, {
    keyPath: ['githubUserId', 'batchId']
  })
  batches.createIndex(libraryIndexes.byAccount, 'githubUserId')
  batches.createIndex(libraryIndexes.byStatus, 'status')
  batches.createIndex(libraryIndexes.byAccountStatus, ['githubUserId', 'status'])

  const jobs = database.createObjectStore(libraryStores.mutationJobs, {
    keyPath: ['githubUserId', 'jobId']
  })
  jobs.createIndex(libraryIndexes.byAccount, 'githubUserId')
  jobs.createIndex(libraryIndexes.byStatus, 'status')
  jobs.createIndex(libraryIndexes.byAccountStatus, ['githubUserId', 'status'])
  jobs.createIndex(libraryIndexes.byRepository, 'repositoryNodeId')
  jobs.createIndex(libraryIndexes.byAccountRepository, [
    'githubUserId',
    'repositoryNodeId'
  ])
  jobs.createIndex(libraryIndexes.byBatch, 'batchId')
  jobs.createIndex(libraryIndexes.byAccountBatch, ['githubUserId', 'batchId'])
  jobs.createIndex(
    libraryIndexes.byNextEligibleExecution,
    'nextEligibleExecutionAt'
  )
  jobs.createIndex(libraryIndexes.byAccountNextEligibleExecution, [
    'githubUserId',
    'nextEligibleExecutionAt'
  ])

  const attempts = database.createObjectStore(libraryStores.mutationAttempts, {
    keyPath: ['githubUserId', 'attemptId']
  })
  attempts.createIndex(libraryIndexes.byAccount, 'githubUserId')
  attempts.createIndex(libraryIndexes.byRepository, 'repositoryNodeId')
  attempts.createIndex(libraryIndexes.byAccountRepository, [
    'githubUserId',
    'repositoryNodeId'
  ])
  attempts.createIndex(libraryIndexes.byBatch, 'batchId')
  attempts.createIndex(libraryIndexes.byAccountBatch, ['githubUserId', 'batchId'])

  const history = database.createObjectStore(libraryStores.operationHistory, {
    keyPath: ['githubUserId', 'historyId']
  })
  history.createIndex(libraryIndexes.byAccount, 'githubUserId')
  history.createIndex(libraryIndexes.byStatus, 'finalStatus')
  history.createIndex(libraryIndexes.byAccountStatus, [
    'githubUserId',
    'finalStatus'
  ])
  history.createIndex(libraryIndexes.byRepository, 'repositoryNodeId')
  history.createIndex(libraryIndexes.byAccountRepository, [
    'githubUserId',
    'repositoryNodeId'
  ])
  history.createIndex(libraryIndexes.byBatch, 'batchId')
  history.createIndex(libraryIndexes.byAccountBatch, ['githubUserId', 'batchId'])
}

function createLibraryDatabaseVersionOne(database: IDBDatabase): void {
  const repositories = database.createObjectStore(libraryStores.repositories, {
    keyPath: ['githubUserId', 'repositoryNodeId']
  })
  repositories.createIndex(libraryIndexes.byAccount, 'githubUserId')
  repositories.createIndex(libraryIndexes.byAccountName, [
    'githubUserId',
    'fullName'
  ])
  repositories.createIndex(libraryIndexes.byAccountStarred, [
    'githubUserId',
    'isStarred'
  ])

  const nativeLists = database.createObjectStore(libraryStores.nativeLists, {
    keyPath: ['githubUserId', 'listNodeId']
  })
  nativeLists.createIndex(libraryIndexes.byAccount, 'githubUserId')
  nativeLists.createIndex(libraryIndexes.byAccountName, ['githubUserId', 'name'])

  const nativeMemberships = database.createObjectStore(
    libraryStores.nativeMemberships,
    {keyPath: ['githubUserId', 'listNodeId', 'repositoryNodeId']}
  )
  nativeMemberships.createIndex(libraryIndexes.byAccount, 'githubUserId')
  nativeMemberships.createIndex(libraryIndexes.byList, [
    'githubUserId',
    'listNodeId'
  ])
  nativeMemberships.createIndex(libraryIndexes.byRepository, [
    'githubUserId',
    'repositoryNodeId'
  ])

  const annotations = database.createObjectStore(libraryStores.annotations, {
    keyPath: ['githubUserId', 'repositoryNodeId']
  })
  annotations.createIndex(libraryIndexes.byAccount, 'githubUserId')
  annotations.createIndex(libraryIndexes.byTriage, [
    'githubUserId',
    'triageState'
  ])
  annotations.createIndex(libraryIndexes.byFavorite, [
    'githubUserId',
    'favorite'
  ])
  annotations.createIndex(libraryIndexes.byTag, 'indexedTags', {multiEntry: true})

  const syncState = database.createObjectStore(libraryStores.syncState, {
    keyPath: ['githubUserId', 'kind']
  })
  syncState.createIndex(libraryIndexes.byAccount, 'githubUserId')
  syncState.createIndex(libraryIndexes.byPhase, ['githubUserId', 'phase'])

  database.createObjectStore(libraryStores.authState, {keyPath: 'githubUserId'})
  database.createObjectStore(libraryStores.settings, {keyPath: 'githubUserId'})
}

function transactionCompletion(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onabort = () =>
      reject(transaction.error ?? new Error('IndexedDB transaction was aborted.'))
    transaction.onerror = () =>
      reject(transaction.error ?? new Error('IndexedDB transaction failed.'))
  })
}
