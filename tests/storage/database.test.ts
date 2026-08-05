import {describe, expect, test} from 'bun:test'
import {IDBFactory} from 'fake-indexeddb'
import type {
  AnnotationRecord,
  AuthStateRecord,
  NativeListRecord,
  NativeMembershipRecord,
  RepositoryRecord,
  WriteAuthStateRecord
} from '../../src/domain/types'
import {
  libraryDatabaseVersion,
  libraryIndexes,
  libraryStores,
  openLibraryDatabase,
  runLibraryTransaction
} from '../../src/storage/database'
import {
  getAnnotation,
  getAuthState,
  getNativeList,
  getRepository,
  getWriteAuthState,
  listAnnotationsByTag,
  listAnnotationsByTriage,
  listMembershipsForList,
  listMembershipsForRepository,
  listRepositories,
  putAnnotation,
  putAuthState,
  putNativeList,
  putNativeMembership,
  putRepository,
  putWriteAuthState,
  replaceAuthStateIfGeneration,
  deleteAuthStateIfGeneration,
  deleteWriteAuthState,
  clearWriteAuthStates,
  clearAllLibraryData
} from '../../src/storage/library'

const githubUserId = '42'
const timestamp = '2026-08-03T12:00:00Z'

describe('library IndexedDB', () => {
  test('creates schema version 3 through the initial upgrade', async () => {
    const upgrades: Array<readonly [number, number]> = []
    const database = await openLibraryDatabase({
      name: 'schema-test',
      factory: new IDBFactory(),
      onUpgrade: (oldVersion, newVersion) => upgrades.push([oldVersion, newVersion])
    })

    expect(database.version).toBe(libraryDatabaseVersion)
    expect(upgrades).toEqual([[0, 3]])
    expect(Array.from(database.objectStoreNames).sort()).toEqual(
      Object.values(libraryStores).sort()
    )

    const transaction = database.transaction(
      [
        libraryStores.repositories,
        libraryStores.nativeLists,
        libraryStores.nativeMemberships,
        libraryStores.annotations
      ],
      'readonly'
    )
    expect(
      transaction.objectStore(libraryStores.repositories).indexNames.contains(
        libraryIndexes.byAccountStarred
      )
    ).toBe(true)
    expect(
      transaction.objectStore(libraryStores.nativeMemberships).indexNames.contains(
        libraryIndexes.byRepository
      )
    ).toBe(true)
    expect(
      transaction.objectStore(libraryStores.annotations).indexNames.contains(
        libraryIndexes.byTag
      )
    ).toBe(true)

    const mutationTransaction = database.transaction(
      [
        libraryStores.mutationBatches,
        libraryStores.mutationJobs,
        libraryStores.mutationAttempts,
        libraryStores.operationHistory
      ],
      'readonly'
    )
    const jobs = mutationTransaction.objectStore(libraryStores.mutationJobs)
    expect(jobs.indexNames.contains(libraryIndexes.byAccount)).toBe(true)
    expect(jobs.indexNames.contains(libraryIndexes.byStatus)).toBe(true)
    expect(jobs.indexNames.contains(libraryIndexes.byAccountRepository)).toBe(true)
    expect(jobs.indexNames.contains(libraryIndexes.byAccountBatch)).toBe(true)
    expect(
      jobs.indexNames.contains(libraryIndexes.byAccountNextEligibleExecution)
    ).toBe(true)
    expect(
      mutationTransaction
        .objectStore(libraryStores.operationHistory)
        .indexNames.contains(libraryIndexes.byAccountStatus)
    ).toBe(true)
    database.close()
  })

  test('upgrades version 1 without changing existing stores or records', async () => {
    const factory = new IDBFactory()
    const name = 'version-one-upgrade-test'
    const legacyAuthState = authStateFixture(1)
    const versionOne = await createVersionOneDatabase(factory, name, legacyAuthState)
    versionOne.close()
    const upgrades: Array<readonly [number, number]> = []

    const database = await openLibraryDatabase({
      name,
      factory,
      onUpgrade: (oldVersion, newVersion) => upgrades.push([oldVersion, newVersion])
    })

    expect(upgrades).toEqual([[1, 3]])
    expect(Array.from(database.objectStoreNames).sort()).toEqual(
      Object.values(libraryStores).sort()
    )
    expect(await getAuthState(database, githubUserId)).toEqual(legacyAuthState)
    database.close()
  })

  test('upgrades version 2 while preserving version 1 and 2 records', async () => {
    const factory = new IDBFactory()
    const name = 'version-two-upgrade-test'
    const legacyAuthState = authStateFixture(1)
    const legacyWriteAuthState = writeAuthStateFixture()
    const versionTwo = await createVersionTwoDatabase(
      factory,
      name,
      legacyAuthState,
      legacyWriteAuthState
    )
    versionTwo.close()

    const database = await openLibraryDatabase({name, factory})

    expect(database.version).toBe(3)
    expect(await getAuthState(database, githubUserId)).toEqual(legacyAuthState)
    expect(await getWriteAuthState(database, githubUserId)).toEqual(
      legacyWriteAuthState
    )
    expect(database.objectStoreNames.contains(libraryStores.mutationJobs)).toBe(true)
    database.close()
  })

  test('rolls back all version 3 stores when the upgrade aborts', async () => {
    const factory = new IDBFactory()
    const name = 'version-three-upgrade-rollback-test'
    const legacyAuthState = authStateFixture(1)
    const legacyWriteAuthState = writeAuthStateFixture()
    const versionTwo = await createVersionTwoDatabase(
      factory,
      name,
      legacyAuthState,
      legacyWriteAuthState
    )
    versionTwo.close()

    await expect(
      openLibraryDatabase({
        name,
        factory,
        onUpgrade: () => {
          throw new Error('deliberate migration rollback')
        }
      })
    ).rejects.toThrow('deliberate migration rollback')

    const rolledBack = await openDatabaseAtVersion(factory, name, 2)
    expect(rolledBack.version).toBe(2)
    expect(rolledBack.objectStoreNames.contains(libraryStores.mutationJobs)).toBe(false)
    expect(
      await readObjectStoreRecord<AuthStateRecord>(
        rolledBack,
        libraryStores.authState,
        githubUserId
      )
    ).toEqual(legacyAuthState)
    expect(
      await readObjectStoreRecord<WriteAuthStateRecord>(
        rolledBack,
        libraryStores.writeAuthState,
        githubUserId
      )
    ).toEqual(legacyWriteAuthState)
    rolledBack.close()
  })

  test('stores and looks up account-scoped library records', async () => {
    const database = await openLibraryDatabase({
      name: 'operations-test',
      factory: new IDBFactory()
    })
    const repository = repositoryFixture()
    const list = nativeListFixture()
    const membership = membershipFixture()
    const annotation = annotationFixture()

    await putRepository(database, repository)
    await putNativeList(database, list)
    await putNativeMembership(database, membership)
    await putAnnotation(database, annotation)

    expect(await getRepository(database, githubUserId, repository.repositoryNodeId)).toEqual(
      repository
    )
    expect(await listRepositories(database, githubUserId)).toEqual([repository])
    expect(await getNativeList(database, githubUserId, list.listNodeId)).toEqual(list)
    expect(
      await listMembershipsForRepository(
        database,
        githubUserId,
        repository.repositoryNodeId
      )
    ).toEqual([membership])
    expect(await listMembershipsForList(database, githubUserId, list.listNodeId)).toEqual([
      membership
    ])
    expect(await getAnnotation(database, githubUserId, repository.repositoryNodeId)).toEqual(
      annotation
    )
    expect(await listAnnotationsByTriage(database, githubUserId, 'backlog')).toEqual([
      annotation
    ])
    expect(await listAnnotationsByTag(database, githubUserId, 'RESEARCH')).toEqual([
      annotation
    ])
    expect(await listRepositories(database, 'another-account')).toEqual([])
    database.close()
  })

  test('aborts queued writes when a transaction operation fails', async () => {
    const database = await openLibraryDatabase({
      name: 'rollback-test',
      factory: new IDBFactory()
    })
    const repository = repositoryFixture()

    await expect(
      runLibraryTransaction(
        database,
        [libraryStores.repositories, libraryStores.writeAuthState],
        'readwrite',
        (transaction) => {
          transaction.objectStore(libraryStores.repositories).put(repository)
          transaction
            .objectStore(libraryStores.writeAuthState)
            .put(writeAuthStateFixture())
          throw new Error('deliberate rollback')
        }
      )
    ).rejects.toThrow('deliberate rollback')
    expect(await getRepository(database, githubUserId, repository.repositoryNodeId)).toBeNull()
    expect(await getWriteAuthState(database, githubUserId)).toBeNull()
    database.close()
  })

  test('stores, deletes, clears, and completely removes write authorization', async () => {
    const database = await openLibraryDatabase({
      name: 'write-auth-operations-test',
      factory: new IDBFactory()
    })
    const first = writeAuthStateFixture()
    const second = writeAuthStateFixture('84')

    await putWriteAuthState(database, first)
    await putWriteAuthState(database, second)
    expect(await getWriteAuthState(database, githubUserId)).toEqual(first)
    expect(await getWriteAuthState(database, '84')).toEqual(second)

    await deleteWriteAuthState(database, githubUserId)
    expect(await getWriteAuthState(database, githubUserId)).toBeNull()
    expect(await getWriteAuthState(database, '84')).toEqual(second)

    await clearWriteAuthStates(database)
    expect(await getWriteAuthState(database, '84')).toBeNull()

    await putWriteAuthState(database, first)
    await clearAllLibraryData(database)
    expect(await getWriteAuthState(database, githubUserId)).toBeNull()
    database.close()
  })

  test('rotates and clears credentials only for the expected generation', async () => {
    const database = await openLibraryDatabase({
      name: 'auth-generation-test',
      factory: new IDBFactory()
    })
    const initial = authStateFixture(1)
    const rotated = authStateFixture(2)
    await putAuthState(database, initial)

    expect(await replaceAuthStateIfGeneration(database, 0, rotated)).toBe(false)
    expect((await getAuthState(database, githubUserId))?.credentials.generation).toBe(1)
    expect(await replaceAuthStateIfGeneration(database, 1, rotated)).toBe(true)
    expect(await deleteAuthStateIfGeneration(database, githubUserId, 1)).toBe(false)
    expect((await getAuthState(database, githubUserId))?.credentials.generation).toBe(2)
    expect(await deleteAuthStateIfGeneration(database, githubUserId, 2)).toBe(true)
    expect(await getAuthState(database, githubUserId)).toBeNull()
    database.close()
  })
})

function repositoryFixture(): RepositoryRecord {
  return {
    githubUserId,
    repositoryNodeId: 'R_fixture',
    ownerLogin: 'jolo-dev',
    name: 'star-list-manager',
    fullName: 'jolo-dev/star-list-manager',
    htmlUrl: 'https://github.com/jolo-dev/star-list-manager',
    description: 'A fixture repository',
    topics: ['browser-extension'],
    primaryLanguage: 'TypeScript',
    starredAt: timestamp,
    pushedAt: timestamp,
    archived: false,
    disabled: false,
    isStarred: true,
    firstObservedAt: timestamp,
    lastObservedAt: timestamp,
    unstarredAt: null
  }
}

function nativeListFixture(): NativeListRecord {
  return {
    githubUserId,
    listNodeId: 'UL_fixture',
    name: 'Browser tools',
    description: 'Useful browser projects',
    visibility: 'public',
    slug: 'browser-tools',
    createdAt: timestamp,
    updatedAt: timestamp,
    lastAddedAt: timestamp,
    reportedItemCount: 1,
    importedItemCount: 1,
    importStatus: 'complete',
    lastObservedAt: timestamp
  }
}

function membershipFixture(): NativeMembershipRecord {
  return {
    githubUserId,
    listNodeId: 'UL_fixture',
    repositoryNodeId: 'R_fixture',
    lastObservedAt: timestamp
  }
}

function annotationFixture(): AnnotationRecord {
  return {
    githubUserId,
    repositoryNodeId: 'R_fixture',
    triageState: 'backlog',
    tags: ['Research'],
    note: 'Review the storage design.',
    favorite: true,
    revisitAt: null,
    reviewedAt: null,
    localModifiedAt: timestamp
  }
}

function authStateFixture(generation: number): AuthStateRecord {
  return {
    githubUserId,
    identity: {
      githubUserId,
      userNodeId: 'U_fixture',
      login: 'jolo-dev',
      avatarUrl: 'https://avatars.githubusercontent.com/u/42'
    },
    credentials: {
      accessToken: `access-${generation}`,
      refreshToken: `refresh-${generation}`,
      accessTokenExpiresAt: '2026-08-03T20:00:00Z',
      refreshTokenExpiresAt: '2027-02-03T12:00:00Z',
      generation
    },
    authenticatedAt: timestamp,
    refreshedAt: timestamp
  }
}

function writeAuthStateFixture(userId = githubUserId): WriteAuthStateRecord {
  return {
    githubUserId: userId,
    identity: {
      githubUserId: userId,
      userNodeId: `U_${userId}`,
      login: `user-${userId}`,
      avatarUrl: `https://avatars.githubusercontent.com/u/${userId}`
    },
    credential: {
      accessToken: `write-access-${userId}`,
      tokenType: 'bearer',
      grantedScopes: ['public_repo']
    },
    authorizedAt: timestamp,
    lastFailure: null
  }
}

function createVersionOneDatabase(
  factory: IDBFactory,
  name: string,
  authState: AuthStateRecord
): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open(name, 1)
    request.onupgradeneeded = () => {
      const database = request.result
      database.createObjectStore(libraryStores.repositories, {
        keyPath: ['githubUserId', 'repositoryNodeId']
      })
      database.createObjectStore(libraryStores.nativeLists, {
        keyPath: ['githubUserId', 'listNodeId']
      })
      database.createObjectStore(libraryStores.nativeMemberships, {
        keyPath: ['githubUserId', 'listNodeId', 'repositoryNodeId']
      })
      database.createObjectStore(libraryStores.annotations, {
        keyPath: ['githubUserId', 'repositoryNodeId']
      })
      database.createObjectStore(libraryStores.syncState, {
        keyPath: ['githubUserId', 'kind']
      })
      database.createObjectStore(libraryStores.authState, {
        keyPath: 'githubUserId'
      }).put(authState)
      database.createObjectStore(libraryStores.settings, {
        keyPath: 'githubUserId'
      })
    }
    request.onerror = () => reject(request.error ?? new Error('Unable to create v1 test database.'))
    request.onsuccess = () => resolve(request.result)
  })
}

async function createVersionTwoDatabase(
  factory: IDBFactory,
  name: string,
  authState: AuthStateRecord,
  writeAuthState: WriteAuthStateRecord
): Promise<IDBDatabase> {
  const versionOne = await createVersionOneDatabase(factory, name, authState)
  versionOne.close()
  return new Promise((resolve, reject) => {
    const request = factory.open(name, 2)
    request.onupgradeneeded = () => {
      request.result
        .createObjectStore(libraryStores.writeAuthState, {keyPath: 'githubUserId'})
        .put(writeAuthState)
    }
    request.onerror = () => reject(request.error ?? new Error('Unable to create v2 test database.'))
    request.onsuccess = () => resolve(request.result)
  })
}

function openDatabaseAtVersion(
  factory: IDBFactory,
  name: string,
  version: number
): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open(name, version)
    request.onerror = () => reject(request.error ?? new Error('Unable to open test database.'))
    request.onsuccess = () => resolve(request.result)
  })
}

function readObjectStoreRecord<T>(
  database: IDBDatabase,
  storeName: string,
  key: IDBValidKey
): Promise<T | null> {
  return new Promise((resolve, reject) => {
    const request = database.transaction(storeName).objectStore(storeName).get(key) as IDBRequest<
      T | undefined
    >
    request.onerror = () => reject(request.error ?? new Error('Unable to read test record.'))
    request.onsuccess = () => resolve(request.result ?? null)
  })
}
