import type {
  AnnotationRecord,
  AuthStateRecord,
  GitHubUserId,
  NativeListNodeId,
  NativeListRecord,
  NativeMembershipRecord,
  RepositoryNodeId,
  RepositoryRecord,
  SettingsRecord,
  SyncKind,
  SyncStateRecord,
  TriageState,
  WriteAuthStateRecord
} from '../domain/types'
import {
  libraryIndexes,
  libraryStores,
  requestResult,
  runLibraryTransaction
} from './database'

interface StoredAnnotationRecord extends AnnotationRecord {
  readonly indexedTags: readonly string[]
}

export async function putRepository(
  database: IDBDatabase,
  repository: RepositoryRecord
): Promise<void> {
  await putRecord(database, libraryStores.repositories, repository)
}

export async function getRepository(
  database: IDBDatabase,
  githubUserId: GitHubUserId,
  repositoryNodeId: RepositoryNodeId
): Promise<RepositoryRecord | null> {
  return getRecord<RepositoryRecord>(database, libraryStores.repositories, [
    githubUserId,
    repositoryNodeId
  ])
}

export async function listRepositories(
  database: IDBDatabase,
  githubUserId: GitHubUserId
): Promise<readonly RepositoryRecord[]> {
  return getAllFromIndex<RepositoryRecord>(
    database,
    libraryStores.repositories,
    libraryIndexes.byAccount,
    githubUserId
  )
}

export interface RepositoryReconciliationResult {
  readonly added: number
  readonly updated: number
  readonly markedUnstarred: number
}

export async function reconcileStarredRepositories(
  database: IDBDatabase,
  githubUserId: GitHubUserId,
  observedRepositories: readonly RepositoryRecord[],
  reconciledAt: string
): Promise<RepositoryReconciliationResult> {
  return runLibraryTransaction(
    database,
    libraryStores.repositories,
    'readwrite',
    async (transaction) => {
      const store = transaction.objectStore(libraryStores.repositories)
      const existing = await requestResult(
        store.index(libraryIndexes.byAccount).getAll(githubUserId) as IDBRequest<
          RepositoryRecord[]
        >
      )
      const existingByNodeId = new Map(
        existing.map((repository) => [repository.repositoryNodeId, repository])
      )
      const observedNodeIds = new Set(
        observedRepositories.map((repository) => repository.repositoryNodeId)
      )
      let added = 0
      let updated = 0
      let markedUnstarred = 0
      const writes: Array<Promise<IDBValidKey>> = []

      for (const repository of observedRepositories) {
        const previous = existingByNodeId.get(repository.repositoryNodeId)
        if (previous) updated += 1
        else added += 1
        writes.push(
          requestResult(
            store.put({
              ...repository,
              githubUserId,
              firstObservedAt: previous?.firstObservedAt ?? repository.firstObservedAt,
              lastObservedAt: reconciledAt,
              isStarred: true,
              unstarredAt: null
            })
          )
        )
      }

      for (const repository of existing) {
        if (!repository.isStarred || observedNodeIds.has(repository.repositoryNodeId)) {
          continue
        }
        markedUnstarred += 1
        writes.push(
          requestResult(
            store.put({...repository, isStarred: false, unstarredAt: reconciledAt})
          )
        )
      }

      await Promise.all(writes)
      return {added, updated, markedUnstarred}
    }
  )
}

export async function putNativeList(
  database: IDBDatabase,
  list: NativeListRecord
): Promise<void> {
  await putRecord(database, libraryStores.nativeLists, list)
}

export async function getNativeList(
  database: IDBDatabase,
  githubUserId: GitHubUserId,
  listNodeId: NativeListNodeId
): Promise<NativeListRecord | null> {
  return getRecord<NativeListRecord>(database, libraryStores.nativeLists, [
    githubUserId,
    listNodeId
  ])
}

export async function listNativeLists(
  database: IDBDatabase,
  githubUserId: GitHubUserId
): Promise<readonly NativeListRecord[]> {
  return getAllFromIndex<NativeListRecord>(
    database,
    libraryStores.nativeLists,
    libraryIndexes.byAccount,
    githubUserId
  )
}

export async function putNativeMembership(
  database: IDBDatabase,
  membership: NativeMembershipRecord
): Promise<void> {
  await putRecord(database, libraryStores.nativeMemberships, membership)
}

export async function listMembershipsForRepository(
  database: IDBDatabase,
  githubUserId: GitHubUserId,
  repositoryNodeId: RepositoryNodeId
): Promise<readonly NativeMembershipRecord[]> {
  return getAllFromIndex<NativeMembershipRecord>(
    database,
    libraryStores.nativeMemberships,
    libraryIndexes.byRepository,
    [githubUserId, repositoryNodeId]
  )
}

export async function listMembershipsForList(
  database: IDBDatabase,
  githubUserId: GitHubUserId,
  listNodeId: NativeListNodeId
): Promise<readonly NativeMembershipRecord[]> {
  return getAllFromIndex<NativeMembershipRecord>(
    database,
    libraryStores.nativeMemberships,
    libraryIndexes.byList,
    [githubUserId, listNodeId]
  )
}

export async function listNativeMemberships(
  database: IDBDatabase,
  githubUserId: GitHubUserId
): Promise<readonly NativeMembershipRecord[]> {
  return getAllFromIndex<NativeMembershipRecord>(
    database,
    libraryStores.nativeMemberships,
    libraryIndexes.byAccount,
    githubUserId
  )
}

export interface NativeListReconciliationResult {
  readonly lists: number
  readonly memberships: number
}

export async function reconcileNativeLists(
  database: IDBDatabase,
  githubUserId: GitHubUserId,
  lists: readonly NativeListRecord[],
  memberships: readonly NativeMembershipRecord[]
): Promise<NativeListReconciliationResult> {
  return runLibraryTransaction(
    database,
    [libraryStores.nativeLists, libraryStores.nativeMemberships],
    'readwrite',
    async (transaction) => {
      const listStore = transaction.objectStore(libraryStores.nativeLists)
      const membershipStore = transaction.objectStore(libraryStores.nativeMemberships)
      const [listKeys, membershipKeys] = await Promise.all([
        requestResult(
          listStore.index(libraryIndexes.byAccount).getAllKeys(githubUserId)
        ),
        requestResult(
          membershipStore.index(libraryIndexes.byAccount).getAllKeys(githubUserId)
        )
      ])
      const writes: Array<Promise<IDBValidKey | undefined>> = []
      for (const key of listKeys) writes.push(requestResult(listStore.delete(key)))
      for (const key of membershipKeys) {
        writes.push(requestResult(membershipStore.delete(key)))
      }
      for (const list of lists) writes.push(requestResult(listStore.put(list)))
      for (const membership of memberships) {
        writes.push(requestResult(membershipStore.put(membership)))
      }
      await Promise.all(writes)
      return {lists: lists.length, memberships: memberships.length}
    }
  )
}

export async function putAnnotation(
  database: IDBDatabase,
  annotation: AnnotationRecord
): Promise<void> {
  await putRecord(
    database,
    libraryStores.annotations,
    toStoredAnnotation(annotation)
  )
}

export async function putAnnotations(
  database: IDBDatabase,
  annotations: readonly AnnotationRecord[]
): Promise<void> {
  if (annotations.length === 0) return
  await runLibraryTransaction(
    database,
    libraryStores.annotations,
    'readwrite',
    async (transaction) => {
      const store = transaction.objectStore(libraryStores.annotations)
      await Promise.all(
        annotations.map((annotation) =>
          requestResult(store.put(toStoredAnnotation(annotation)))
        )
      )
    }
  )
}

export async function getAnnotation(
  database: IDBDatabase,
  githubUserId: GitHubUserId,
  repositoryNodeId: RepositoryNodeId
): Promise<AnnotationRecord | null> {
  const stored = await getRecord<StoredAnnotationRecord>(
    database,
    libraryStores.annotations,
    [githubUserId, repositoryNodeId]
  )
  return stored ? fromStoredAnnotation(stored) : null
}

export async function listAnnotationsByTriage(
  database: IDBDatabase,
  githubUserId: GitHubUserId,
  triageState: TriageState
): Promise<readonly AnnotationRecord[]> {
  const records = await getAllFromIndex<StoredAnnotationRecord>(
    database,
    libraryStores.annotations,
    libraryIndexes.byTriage,
    [githubUserId, triageState]
  )
  return records.map(fromStoredAnnotation)
}

export async function listAnnotations(
  database: IDBDatabase,
  githubUserId: GitHubUserId
): Promise<readonly AnnotationRecord[]> {
  const records = await getAllFromIndex<StoredAnnotationRecord>(
    database,
    libraryStores.annotations,
    libraryIndexes.byAccount,
    githubUserId
  )
  return records.map(fromStoredAnnotation)
}

export async function listAnnotationsByTag(
  database: IDBDatabase,
  githubUserId: GitHubUserId,
  tag: string
): Promise<readonly AnnotationRecord[]> {
  const records = await getAllFromIndex<StoredAnnotationRecord>(
    database,
    libraryStores.annotations,
    libraryIndexes.byTag,
    annotationTagIndexKey(githubUserId, tag)
  )
  return records.map(fromStoredAnnotation)
}

export async function putSyncState(
  database: IDBDatabase,
  state: SyncStateRecord
): Promise<void> {
  await putRecord(database, libraryStores.syncState, state)
}

export async function getSyncState(
  database: IDBDatabase,
  githubUserId: GitHubUserId,
  kind: SyncKind
): Promise<SyncStateRecord | null> {
  return getRecord<SyncStateRecord>(database, libraryStores.syncState, [
    githubUserId,
    kind
  ])
}

export async function putAuthState(
  database: IDBDatabase,
  state: AuthStateRecord
): Promise<void> {
  await putRecord(database, libraryStores.authState, state)
}

export async function getAuthState(
  database: IDBDatabase,
  githubUserId: GitHubUserId
): Promise<AuthStateRecord | null> {
  return getRecord<AuthStateRecord>(database, libraryStores.authState, githubUserId)
}

export async function replaceAuthStateIfGeneration(
  database: IDBDatabase,
  expectedGeneration: number,
  state: AuthStateRecord
): Promise<boolean> {
  return runLibraryTransaction(
    database,
    libraryStores.authState,
    'readwrite',
    async (transaction) => {
      const store = transaction.objectStore(libraryStores.authState)
      const current = await requestResult(
        store.get(state.githubUserId) as IDBRequest<AuthStateRecord | undefined>
      )
      if (current?.credentials.generation !== expectedGeneration) return false
      await requestResult(store.put(state))
      return true
    }
  )
}

export async function deleteAuthStateIfGeneration(
  database: IDBDatabase,
  githubUserId: GitHubUserId,
  expectedGeneration: number
): Promise<boolean> {
  return runLibraryTransaction(
    database,
    libraryStores.authState,
    'readwrite',
    async (transaction) => {
      const store = transaction.objectStore(libraryStores.authState)
      const current = await requestResult(
        store.get(githubUserId) as IDBRequest<AuthStateRecord | undefined>
      )
      if (current?.credentials.generation !== expectedGeneration) return false
      await requestResult(store.delete(githubUserId))
      return true
    }
  )
}

export async function deleteAuthState(
  database: IDBDatabase,
  githubUserId: GitHubUserId
): Promise<void> {
  await runLibraryTransaction(database, libraryStores.authState, 'readwrite', (transaction) =>
    requestResult(transaction.objectStore(libraryStores.authState).delete(githubUserId))
  )
}

export async function putWriteAuthState(
  database: IDBDatabase,
  state: WriteAuthStateRecord
): Promise<void> {
  await putRecord(database, libraryStores.writeAuthState, state)
}

export async function getWriteAuthState(
  database: IDBDatabase,
  githubUserId: GitHubUserId
): Promise<WriteAuthStateRecord | null> {
  return getRecord<WriteAuthStateRecord>(
    database,
    libraryStores.writeAuthState,
    githubUserId
  )
}

export async function deleteWriteAuthState(
  database: IDBDatabase,
  githubUserId: GitHubUserId
): Promise<void> {
  await runLibraryTransaction(
    database,
    libraryStores.writeAuthState,
    'readwrite',
    (transaction) =>
      requestResult(
        transaction.objectStore(libraryStores.writeAuthState).delete(githubUserId)
      )
  )
}

export async function clearWriteAuthStates(database: IDBDatabase): Promise<void> {
  await runLibraryTransaction(
    database,
    libraryStores.writeAuthState,
    'readwrite',
    (transaction) =>
      requestResult(transaction.objectStore(libraryStores.writeAuthState).clear())
  )
}

export async function putSettings(
  database: IDBDatabase,
  settings: SettingsRecord
): Promise<void> {
  await putRecord(database, libraryStores.settings, settings)
}

export async function getSettings(
  database: IDBDatabase,
  githubUserId: GitHubUserId
): Promise<SettingsRecord | null> {
  return getRecord<SettingsRecord>(database, libraryStores.settings, githubUserId)
}

export async function hasRetainedLibraryData(database: IDBDatabase): Promise<boolean> {
  const stores = [
    libraryStores.repositories,
    libraryStores.nativeLists,
    libraryStores.nativeMemberships,
    libraryStores.annotations,
    libraryStores.syncState,
    libraryStores.settings
  ] as const

  return runLibraryTransaction(database, stores, 'readonly', async (transaction) => {
    const counts = await Promise.all(
      stores.map((storeName) =>
        requestResult(transaction.objectStore(storeName).count())
      )
    )
    return counts.some((count) => count > 0)
  })
}

export async function clearAllLibraryData(database: IDBDatabase): Promise<void> {
  const stores = Object.values(libraryStores)
  await runLibraryTransaction(database, stores, 'readwrite', async (transaction) => {
    await Promise.all(
      stores.map((storeName) =>
        requestResult(transaction.objectStore(storeName).clear())
      )
    )
  })
}

export function annotationTagIndexKey(
  githubUserId: GitHubUserId,
  tag: string
): string {
  return JSON.stringify([githubUserId, tag.trim().toLocaleLowerCase()])
}

async function putRecord(
  database: IDBDatabase,
  storeName: (typeof libraryStores)[keyof typeof libraryStores],
  record: object
): Promise<void> {
  await runLibraryTransaction(database, storeName, 'readwrite', (transaction) =>
    requestResult(transaction.objectStore(storeName).put(record))
  )
}

async function getRecord<T>(
  database: IDBDatabase,
  storeName: (typeof libraryStores)[keyof typeof libraryStores],
  key: IDBValidKey
): Promise<T | null> {
  return runLibraryTransaction(database, storeName, 'readonly', async (transaction) => {
    const result = await requestResult(
      transaction.objectStore(storeName).get(key) as IDBRequest<T | undefined>
    )
    return result ?? null
  })
}

async function getAllFromIndex<T>(
  database: IDBDatabase,
  storeName: (typeof libraryStores)[keyof typeof libraryStores],
  indexName: string,
  key: IDBValidKey
): Promise<readonly T[]> {
  return runLibraryTransaction(database, storeName, 'readonly', (transaction) =>
    requestResult(
      transaction.objectStore(storeName).index(indexName).getAll(key) as IDBRequest<T[]>
    )
  )
}

function toStoredAnnotation(annotation: AnnotationRecord): StoredAnnotationRecord {
  return {
    ...annotation,
    indexedTags: annotation.tags.map((tag) =>
      annotationTagIndexKey(annotation.githubUserId, tag)
    )
  }
}

function fromStoredAnnotation(stored: StoredAnnotationRecord): AnnotationRecord {
  return {
    githubUserId: stored.githubUserId,
    repositoryNodeId: stored.repositoryNodeId,
    triageState: stored.triageState,
    tags: stored.tags,
    note: stored.note,
    favorite: stored.favorite,
    revisitAt: stored.revisitAt,
    reviewedAt: stored.reviewedAt,
    localModifiedAt: stored.localModifiedAt
  }
}
