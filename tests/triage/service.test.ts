import {describe, expect, test} from 'bun:test'
import {IDBFactory} from 'fake-indexeddb'
import type {
  AnnotationRecord,
  NativeMembershipRecord,
  RepositoryRecord,
  SyncStateRecord
} from '../../src/domain/types'
import {openLibraryDatabase} from '../../src/storage/database'
import {
  getAnnotation,
  putAnnotation,
  putNativeMembership,
  putRepository,
  reconcileNativeLists,
  reconcileStarredRepositories
} from '../../src/storage/library'
import {TriageService} from '../../src/triage/service'

const githubUserId = '42'

describe('local triage', () => {
  test('classifies first-import listed stars as reviewed and others as Backlog', async () => {
    const database = await testDatabase('triage-first-import')
    await putRepository(database, repository('R_listed', '2026-08-03T11:00:00Z'))
    await putRepository(database, repository('R_unlisted', '2026-08-03T11:30:00Z'))
    await putNativeMembership(database, membership('UL_fixture', 'R_listed'))
    let badge = ''
    const service = new TriageService({
      database,
      now: () => Date.parse('2026-08-03T12:00:00Z'),
      setBadge: async (text) => {
        badge = text
      }
    })

    const additions = await service.classifyAfterSynchronization(
      githubUserId,
      syncState('stars', 'complete', '2026-08-03T12:00:00Z'),
      syncState('native-lists', 'partial', '2026-08-03T12:00:00Z')
    )
    expect(additions.map((annotation) => annotation.triageState).sort()).toEqual([
      'backlog',
      'reviewed'
    ])
    expect(
      (await getAnnotation(database, githubUserId, 'R_listed'))?.reviewedAt
    ).toBe('2026-08-03T12:00:00.000Z')
    expect(badge).toBe('')
    database.close()
  })

  test('places post-baseline discoveries in Inbox without resetting existing decisions', async () => {
    const database = await testDatabase('triage-new-stars')
    await putRepository(database, repository('R_existing', '2026-08-03T11:00:00Z'))
    await putRepository(database, repository('R_new', '2026-08-03T13:00:00Z'))
    const existing = annotation('R_existing', 'reviewed')
    await putAnnotation(database, existing)
    let badge = ''
    const service = new TriageService({
      database,
      now: () => Date.parse('2026-08-03T14:00:00Z'),
      setBadge: async (text) => {
        badge = text
      }
    })

    await service.classifyAfterSynchronization(
      githubUserId,
      syncState('stars', 'complete', '2026-08-03T12:00:00Z'),
      syncState('native-lists', 'complete', '2026-08-03T12:00:00Z')
    )
    expect((await getAnnotation(database, githubUserId, 'R_new'))?.triageState).toBe(
      'inbox'
    )
    expect(await getAnnotation(database, githubUserId, 'R_existing')).toEqual(existing)
    expect(badge).toBe('1')

    await service.classifyAfterSynchronization(
      githubUserId,
      syncState('stars', 'complete', '2026-08-03T12:00:00Z'),
      syncState('native-lists', 'complete', '2026-08-03T12:00:00Z')
    )
    expect((await getAnnotation(database, githubUserId, 'R_new'))?.triageState).toBe(
      'inbox'
    )
    database.close()
  })

  test('supports snooze, due, review, tags, notes, favorites, and badge counts', async () => {
    const database = await testDatabase('triage-transitions')
    await putRepository(database, repository('R_fixture', '2026-08-03T13:00:00Z'))
    await putAnnotation(database, annotation('R_fixture', 'inbox'))
    let now = Date.parse('2026-08-03T14:00:00Z')
    let badge = ''
    const service = new TriageService({
      database,
      now: () => now,
      setBadge: async (text) => {
        badge = text
      }
    })

    const snoozed = await service.updateAnnotation(githubUserId, 'R_fixture', {
      triageState: 'snoozed',
      revisitAt: '2026-08-04T14:00:00Z',
      tags: [' Research ', 'research', 'Browser'],
      note: 'Review the implementation.',
      favorite: true
    })
    expect(snoozed).toMatchObject({
      triageState: 'snoozed',
      tags: ['Research', 'Browser'],
      note: 'Review the implementation.',
      favorite: true
    })
    expect((await service.counts(githubUserId)).due).toBe(0)
    expect(badge).toBe('')

    now = Date.parse('2026-08-05T14:00:00Z')
    expect((await service.refreshBadge(githubUserId)).due).toBe(1)
    expect(badge).toBe('1')

    const reviewed = await service.updateAnnotation(githubUserId, 'R_fixture', {
      triageState: 'reviewed',
      revisitAt: null
    })
    expect(reviewed.reviewedAt).toBe('2026-08-05T14:00:00.000Z')
    expect(await service.counts(githubUserId)).toEqual({
      inbox: 0,
      backlog: 0,
      due: 0,
      organized: 1
    })
    expect(badge).toBe('')
    database.close()
  })

  test('retains annotations across rename, unstar, re-star, List changes, and restart', async () => {
    const factory = new IDBFactory()
    const database = await openLibraryDatabase({name: 'triage-resilience', factory})
    const original = annotation('R_fixture', 'backlog')
    await putRepository(database, repository('R_fixture', '2026-08-03T11:00:00Z'))
    await putAnnotation(database, original)

    await reconcileStarredRepositories(
      database,
      githubUserId,
      [
        {
          ...repository('R_fixture', '2026-08-03T11:00:00Z'),
          ownerLogin: 'new-owner',
          name: 'renamed',
          fullName: 'new-owner/renamed'
        }
      ],
      '2026-08-04T12:00:00Z'
    )
    await reconcileStarredRepositories(
      database,
      githubUserId,
      [],
      '2026-08-05T12:00:00Z'
    )
    await reconcileStarredRepositories(
      database,
      githubUserId,
      [repository('R_fixture', '2026-08-03T11:00:00Z')],
      '2026-08-06T12:00:00Z'
    )
    await reconcileNativeLists(database, githubUserId, [], [])
    database.close()

    const reopened = await openLibraryDatabase({name: 'triage-resilience', factory})
    expect(await getAnnotation(reopened, githubUserId, 'R_fixture')).toEqual(original)
    reopened.close()
  })
})

function repository(
  repositoryNodeId: string,
  firstObservedAt: string
): RepositoryRecord {
  return {
    githubUserId,
    repositoryNodeId,
    ownerLogin: 'jolo-dev',
    name: repositoryNodeId,
    fullName: `jolo-dev/${repositoryNodeId}`,
    htmlUrl: `https://github.com/jolo-dev/${repositoryNodeId}`,
    description: null,
    topics: [],
    primaryLanguage: null,
    starredAt: firstObservedAt,
    pushedAt: null,
    archived: false,
    disabled: false,
    isStarred: true,
    firstObservedAt,
    lastObservedAt: firstObservedAt,
    unstarredAt: null
  }
}

function annotation(
  repositoryNodeId: string,
  triageState: AnnotationRecord['triageState']
): AnnotationRecord {
  return {
    githubUserId,
    repositoryNodeId,
    triageState,
    tags: ['Keep'],
    note: 'Persistent note',
    favorite: true,
    revisitAt: null,
    reviewedAt: triageState === 'reviewed' ? '2026-08-03T10:00:00Z' : null,
    localModifiedAt: '2026-08-03T10:00:00Z'
  }
}

function membership(
  listNodeId: string,
  repositoryNodeId: string
): NativeMembershipRecord {
  return {githubUserId, listNodeId, repositoryNodeId, lastObservedAt: '2026-08-03T12:00:00Z'}
}

function syncState(
  kind: SyncStateRecord['kind'],
  phase: SyncStateRecord['phase'],
  baselineCompletedAt: string
): SyncStateRecord {
  return {
    githubUserId,
    kind,
    phase,
    attempt: 1,
    pagesProcessed: 1,
    itemsObserved: 2,
    skippedItems: phase === 'partial' ? 1 : 0,
    convergenceAttempt: kind === 'stars' ? 2 : 0,
    baselineCompletedAt,
    lastStartedAt: baselineCompletedAt,
    lastCompletedAt: baselineCompletedAt,
    lastSuccessfulAt: baselineCompletedAt,
    rateLimit: {limit: 5000, remaining: 4999, resetAt: baselineCompletedAt},
    lastError: null
  }
}

function testDatabase(name: string): Promise<IDBDatabase> {
  return openLibraryDatabase({name, factory: new IDBFactory()})
}
