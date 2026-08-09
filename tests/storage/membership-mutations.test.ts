import {describe, expect, test} from 'bun:test'
import {IDBFactory} from 'fake-indexeddb'
import {
  planMembershipIntent,
  referencedListNodeIds,
  relevantListCatalogFingerprint,
  type NativeListMembershipIntent
} from '../../src/domain/native-list-membership'
import type {AnnotationRecord, RepositoryRecord} from '../../src/domain/types'
import {openLibraryDatabase} from '../../src/storage/database'
import {
  getAnnotation,
  listMembershipsForRepository,
  putAnnotation,
  putNativeMembership,
  putRepository
} from '../../src/storage/library'
import {
  claimNextMutationWork,
  enqueueMembershipMutationBatch,
  enqueueMutationBatch,
  finalizeMutationJob,
  getMutationBatch,
  getMutationJob,
  listOperationHistory,
  transitionMutationJob
} from '../../src/storage/mutations'

const accountA = 'account-a'
const accountB = 'account-b'
const repositoryNodeId = 'R_repo'
const occurredAt = '2026-08-08T12:00:00.000Z'

describe('native List membership mutation storage', () => {
  test('persists account-bound intent and fingerprints and blocks active cross-kind overlap', async () => {
    const database = await testDatabase('membership-storage-account-overlap')
    const queued = await enqueueMembership(
      database,
      accountA,
      'membership-a',
      ['L_existing'],
      addIntent(accountA, 'L_added')
    )
    const expectedCatalog = catalogFor(['L_added'])

    expect(queued.jobs[0]?.membershipDetails).toEqual({
      intent: addIntent(accountA, 'L_added'),
      confirmedBefore: {listNodeIds: ['L_existing'], fingerprint: '["L_existing"]'},
      desired: {
        listNodeIds: ['L_added', 'L_existing'],
        fingerprint: '["L_added","L_existing"]'
      },
      confirmedCatalog: expectedCatalog,
      latestObserved: null,
      latestObservedCatalog: null,
      membershipFingerprint: '["L_existing"]',
      listCatalogFingerprint: expectedCatalog.fingerprint,
      mutationPayload: null,
      recoveryPhase: null,
      needsConfirmation: null,
      unstableObservation: null,
      verificationConflict: null
    })

    await expect(
      enqueueMutationBatch(database, {
        githubUserId: accountA,
        batchId: 'blocked-unstar',
        origin: 'single',
        createdAt: occurredAt,
        repositories: [queueRepository('blocked-unstar-job')]
      })
    ).rejects.toThrow('active mutation')
    expect(await getMutationBatch(database, accountA, 'blocked-unstar')).toBeNull()

    const otherAccount = await enqueueMembership(
      database,
      accountB,
      'membership-b',
      [],
      addIntent(accountB, 'L_added')
    )
    expect(otherAccount.jobs[0]?.githubUserId).toBe(accountB)
    expect((await getMutationJob(database, accountA, 'job-membership-a'))?.githubUserId).toBe(
      accountA
    )
    database.close()
  })

  test('blocks membership work when an active unstar exists without changing unstar deduplication', async () => {
    const database = await testDatabase('membership-storage-unstar-overlap')
    const unstar = await enqueueMutationBatch(database, {
      githubUserId: accountA,
      batchId: 'unstar-a',
      origin: 'single',
      createdAt: occurredAt,
      repositories: [queueRepository('unstar-job')]
    })
    const reused = await enqueueMutationBatch(database, {
      githubUserId: accountA,
      batchId: 'unstar-b',
      origin: 'single',
      createdAt: occurredAt,
      repositories: [queueRepository('different-job-id')]
    })
    expect(unstar.jobs[0]?.jobId).toBe('unstar-job')
    expect(reused.reusedJobIds).toEqual(['unstar-job'])

    await expect(
      enqueueMembership(
        database,
        accountA,
        'blocked-membership',
        [],
        addIntent(accountA, 'L_added')
      )
    ).rejects.toThrow('active mutation')
    database.close()
  })

  test('transactionally replaces memberships and appends verified history without annotations', async () => {
    const database = await testDatabase('membership-storage-success')
    await putRepository(database, repository(accountA))
    await putNativeMembership(database, {
      githubUserId: accountA,
      repositoryNodeId,
      listNodeId: 'L_old',
      lastObservedAt: occurredAt
    })
    const annotation = annotationRecord()
    await putAnnotation(database, annotation)
    const queued = await enqueueMembership(
      database,
      accountA,
      'success',
      ['L_old'],
      addIntent(accountA, 'L_new')
    )
    const claimed = await claimNextMutationWork(database, accountA, occurredAt)
    expect(claimed?.job.jobId).toBe(queued.jobs[0]?.jobId)
    await transitionMutationJob(
      database,
      accountA,
      'job-success',
      'observing-membership',
      occurredAt
    )
    const details = queued.jobs[0]?.membershipDetails
    if (!details) throw new Error('Missing membership details')
    const verified = {
      ...details,
      latestObserved: details.desired,
      latestObservedCatalog: details.confirmedCatalog,
      membershipFingerprint: details.desired.fingerprint,
      recoveryPhase: null
    }

    const history = await finalizeMutationJob(database, {
      githubUserId: accountA,
      jobId: 'job-success',
      historyId: 'history-success',
      finalStatus: 'succeeded',
      verificationResult: 'verified-membership',
      occurredAt,
      error: null,
      retryEligibility: 'not-retryable',
      membershipDetails: verified,
      updateLocalMemberships: true
    })

    expect(
      (await listMembershipsForRepository(database, accountA, repositoryNodeId)).map(
        (membership) => membership.listNodeId
      ).sort()
    ).toEqual(['L_new', 'L_old'])
    expect(await getAnnotation(database, accountA, repositoryNodeId)).toEqual(annotation)
    expect(history.membershipDetails).toEqual(verified)
    expect((await listOperationHistory(database, accountA)).map((item) => item.historyId)).toEqual([
      'history-success'
    ])
    expect((await getMutationJob(database, accountA, 'job-success'))?.status).toBe(
      'succeeded'
    )
    database.close()
  })

  test('stores authoritative observed memberships and desired-versus-observed conflict', async () => {
    const database = await testDatabase('membership-storage-conflict')
    await putRepository(database, repository(accountA))
    const queued = await enqueueMembership(
      database,
      accountA,
      'conflict',
      ['L_before'],
      addIntent(accountA, 'L_desired')
    )
    await claimNextMutationWork(database, accountA, occurredAt)
    await transitionMutationJob(
      database,
      accountA,
      'job-conflict',
      'observing-membership',
      occurredAt
    )
    const details = queued.jobs[0]?.membershipDetails
    if (!details) throw new Error('Missing membership details')
    const observed = {listNodeIds: ['L_remote'], fingerprint: '["L_remote"]'}
    const conflict = {
      ...details,
      latestObserved: observed,
      latestObservedCatalog: details.confirmedCatalog,
      membershipFingerprint: observed.fingerprint,
      verificationConflict: {desired: details.desired, observed}
    }

    await finalizeMutationJob(database, {
      githubUserId: accountA,
      jobId: 'job-conflict',
      historyId: 'history-conflict',
      finalStatus: 'verification-conflict',
      verificationResult: 'membership-conflict',
      occurredAt,
      error: {
        category: 'verification-mismatch',
        message: 'Membership verification did not match.',
        statusCode: null,
        occurredAt
      },
      retryEligibility: 'after-refresh',
      membershipDetails: conflict,
      updateLocalMemberships: true
    })

    expect(
      (await listMembershipsForRepository(database, accountA, repositoryNodeId)).map(
        (membership) => membership.listNodeId
      )
    ).toEqual(['L_remote'])
    const finalized = await getMutationJob(database, accountA, 'job-conflict')
    expect(finalized?.status).toBe('verification-conflict')
    expect(finalized?.membershipDetails?.verificationConflict).toEqual({
      desired: details.desired,
      observed
    })
    database.close()
  })
})

async function enqueueMembership(
  database: IDBDatabase,
  githubUserId: string,
  suffix: string,
  before: readonly string[],
  intent: NativeListMembershipIntent
) {
  const plan = planMembershipIntent(before, intent)
  if (!plan.ok) throw new Error('Invalid test intent')
  return enqueueMembershipMutationBatch(database, {
    githubUserId,
    batchId: `batch-${suffix}`,
    origin: 'single',
    createdAt: occurredAt,
    repositories: [
      {
        ...queueRepository(`job-${suffix}`),
        plan: plan.value,
        confirmedCatalog: catalogFor(referencedListNodeIds(intent))
      }
    ]
  })
}

function addIntent(githubUserId: string, listNodeId: string): NativeListMembershipIntent {
  return {kind: 'add', githubUserId, repositoryNodeId, additions: [listNodeId]}
}

function catalog(listNodeId: string) {
  return relevantListCatalogFingerprint(
    [listNodeId],
    [{listNodeId, name: 'Added', visibility: 'public'}]
  )
}

function catalogFor(listNodeIds: readonly string[]) {
  return relevantListCatalogFingerprint(
    listNodeIds,
    listNodeIds.map((listNodeId) => ({
      listNodeId,
      name: listNodeId,
      visibility: 'public' as const
    }))
  )
}

function queueRepository(jobId: string) {
  return {jobId, repositoryNodeId, ownerLogin: 'octocat', repositoryName: 'repo'}
}

function repository(githubUserId: string): RepositoryRecord {
  return {
    githubUserId,
    repositoryNodeId,
    ownerLogin: 'octocat',
    name: 'repo',
    fullName: 'octocat/repo',
    htmlUrl: 'https://github.com/octocat/repo',
    description: null,
    topics: [],
    primaryLanguage: null,
    starredAt: occurredAt,
    pushedAt: null,
    archived: false,
    disabled: false,
    isStarred: true,
    firstObservedAt: occurredAt,
    lastObservedAt: occurredAt,
    unstarredAt: null
  }
}

function annotationRecord(): AnnotationRecord {
  return {
    githubUserId: accountA,
    repositoryNodeId,
    triageState: 'backlog',
    tags: ['local'],
    note: 'Keep this note',
    favorite: true,
    revisitAt: '2026-09-01T00:00:00.000Z',
    reviewedAt: occurredAt,
    localModifiedAt: occurredAt
  }
}

function testDatabase(name: string): Promise<IDBDatabase> {
  return openLibraryDatabase({name, factory: new IDBFactory()})
}
