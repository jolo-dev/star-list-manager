import {describe, expect, test} from 'bun:test'
import {IDBFactory} from 'fake-indexeddb'
import type {
  AnnotationRecord,
  RepositoryRecord,
  SyncStateRecord
} from '../../src/domain/types'
import type {PublicStarObservation} from '../../src/github/rest-client'
import {AppFailure} from '../../src/shared/errors'
import {openLibraryDatabase} from '../../src/storage/database'
import {
  getAnnotation,
  getRepository,
  getSyncState,
  putAnnotation,
  putRepository,
  putSyncState
} from '../../src/storage/library'
import {StarSyncService} from '../../src/sync/star-sync'

const githubUserId = '42'
const timestamp = '2026-08-03T12:00:00Z'

describe('public star synchronization', () => {
  test('commits only a converged observation and reconciles by node ID', async () => {
    const database = await testDatabase('star-sync-converged')
    await putRepository(database, repositoryFixture('R_a', 'old-owner', 'alpha'))
    await putRepository(database, repositoryFixture('R_b', 'jolo-dev', 'beta'))
    await putAnnotation(database, annotationFixture('R_b'))
    const observed = [
      repositoryFixture('R_a', 'new-owner', 'renamed-alpha'),
      repositoryFixture('R_c', 'jolo-dev', 'gamma')
    ]
    const service = new StarSyncService({
      database,
      observer: sequenceObserver([observation(observed), observation(observed)]),
      now: () => Date.parse(timestamp)
    })

    const state = await service.synchronize(githubUserId)
    expect(state.phase).toBe('complete')
    expect(state.convergenceAttempt).toBe(2)
    expect((await getRepository(database, githubUserId, 'R_a'))?.fullName).toBe(
      'new-owner/renamed-alpha'
    )
    expect((await getRepository(database, githubUserId, 'R_b'))?.isStarred).toBe(false)
    expect((await getRepository(database, githubUserId, 'R_c'))?.isStarred).toBe(true)
    expect(await getAnnotation(database, githubUserId, 'R_b')).toEqual(
      annotationFixture('R_b')
    )
    database.close()
  })

  test('retains the authoritative library when observations do not stabilize', async () => {
    const database = await testDatabase('star-sync-unstable')
    await putRepository(database, repositoryFixture('R_existing', 'jolo-dev', 'existing'))
    await putSyncState(database, completedSyncState())
    const service = new StarSyncService({
      database,
      observer: sequenceObserver([
        observation([repositoryFixture('R_a', 'jolo-dev', 'a')]),
        observation([repositoryFixture('R_b', 'jolo-dev', 'b')]),
        observation([repositoryFixture('R_c', 'jolo-dev', 'c')])
      ]),
      maxConvergenceAttempts: 3,
      now: () => Date.parse(timestamp)
    })

    const state = await service.synchronize(githubUserId)
    expect(state.phase).toBe('stale')
    expect(state.lastError?.message).toContain('did not stabilize')
    expect((await getRepository(database, githubUserId, 'R_existing'))?.isStarred).toBe(
      true
    )
    expect(await getRepository(database, githubUserId, 'R_a')).toBeNull()
    database.close()
  })

  test('preserves the previous library after interruption and records failure', async () => {
    const database = await testDatabase('star-sync-interrupted')
    await putRepository(database, repositoryFixture('R_existing', 'jolo-dev', 'existing'))
    const service = new StarSyncService({
      database,
      observer: {
        observePublicStars: async () => {
          throw new AppFailure({
            category: 'network',
            message: 'GitHub could not be reached.',
            retryable: true
          })
        }
      },
      now: () => Date.parse(timestamp)
    })

    const state = await service.synchronize(githubUserId)
    expect(state.phase).toBe('error')
    expect(state.lastError?.message).toBe('GitHub could not be reached.')
    expect((await getRepository(database, githubUserId, 'R_existing'))?.isStarred).toBe(
      true
    )
    expect((await getSyncState(database, githubUserId, 'stars'))?.phase).toBe('error')
    database.close()
  })

  test('coalesces duplicate refresh requests into one convergence run', async () => {
    const database = await testDatabase('star-sync-coalesced')
    const gate = deferred<void>()
    let observations = 0
    const observed = observation([repositoryFixture('R_a', 'jolo-dev', 'a')])
    const service = new StarSyncService({
      database,
      observer: {
        observePublicStars: async () => {
          observations += 1
          if (observations === 1) await gate.promise
          return observed
        }
      },
      now: () => Date.parse(timestamp)
    })

    const first = service.synchronize(githubUserId)
    const second = service.synchronize(githubUserId)
    expect(first).toBe(second)
    gate.resolve()
    await Promise.all([first, second])
    expect(observations).toBe(2)
    database.close()
  })
})

function sequenceObserver(observations: readonly PublicStarObservation[]) {
  const remaining = [...observations]
  return {
    observePublicStars: async () => {
      const next = remaining.shift()
      if (!next) throw new Error('Missing star observation fixture.')
      return next
    }
  }
}

function observation(
  repositories: readonly RepositoryRecord[]
): PublicStarObservation {
  return {
    repositories,
    pagesProcessed: 1,
    skippedPrivateRepositories: 0,
    rateLimit: {limit: 5000, remaining: 4999, resetAt: timestamp},
    etag: '"fixture"'
  }
}

function repositoryFixture(
  repositoryNodeId: string,
  ownerLogin: string,
  name: string
): RepositoryRecord {
  return {
    githubUserId,
    repositoryNodeId,
    ownerLogin,
    name,
    fullName: `${ownerLogin}/${name}`,
    htmlUrl: `https://github.com/${ownerLogin}/${name}`,
    description: null,
    topics: [],
    primaryLanguage: null,
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

function annotationFixture(repositoryNodeId: string): AnnotationRecord {
  return {
    githubUserId,
    repositoryNodeId,
    triageState: 'backlog',
    tags: ['Research'],
    note: 'Retain this note.',
    favorite: false,
    revisitAt: null,
    reviewedAt: null,
    localModifiedAt: timestamp
  }
}

function completedSyncState(): SyncStateRecord {
  return {
    githubUserId,
    kind: 'stars',
    phase: 'complete',
    attempt: 1,
    pagesProcessed: 2,
    itemsObserved: 1,
    skippedItems: 0,
    convergenceAttempt: 2,
    baselineCompletedAt: timestamp,
    lastStartedAt: timestamp,
    lastCompletedAt: timestamp,
    lastSuccessfulAt: timestamp,
    rateLimit: {limit: 5000, remaining: 4999, resetAt: timestamp},
    lastError: null
  }
}

function testDatabase(name: string): Promise<IDBDatabase> {
  return openLibraryDatabase({name, factory: new IDBFactory()})
}

function deferred<T>() {
  let resolvePromise: (value: T | PromiseLike<T>) => void = () => undefined
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve
  })
  return {promise, resolve: resolvePromise}
}
