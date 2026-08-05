import {describe, expect, test} from 'bun:test'
import {IDBFactory} from 'fake-indexeddb'
import type {
  AnnotationRecord,
  RepositoryRecord,
  SanitizedMutationError
} from '../../src/domain/types'
import {openLibraryDatabase} from '../../src/storage/database'
import {
  clearAllLibraryData,
  getAnnotation,
  getRepository,
  putAnnotation,
  putRepository
} from '../../src/storage/library'
import {
  cancelQueuedMutationJob,
  claimNextEligibleMutationJob,
  enqueueMutationBatch,
  finalizeMutationJob,
  getMutationBatch,
  getMutationJob,
  listMutationAttempts,
  listMutationBatches,
  listMutationJobs,
  listOperationHistory,
  recordMutationAttempt,
  setMutationJobRecoveryStatus,
  transitionMutationJob
} from '../../src/storage/mutations'

const accountA = 'account-a'
const accountB = 'account-b'
const timeOne = '2026-08-04T10:00:00.000Z'
const timeTwo = '2026-08-04T10:01:00.000Z'
const timeThree = '2026-08-04T10:02:00.000Z'
const timeFour = '2026-08-04T10:03:00.000Z'

describe('mutation storage', () => {
  test('isolates accounts, reuses active duplicates, and claims deterministically', async () => {
    const database = await openTestDatabase('mutation-claim-test')
    const later = await enqueue(database, accountA, 'batch-later', timeTwo, [
      mutationRepository('job-z', 'repo-z')
    ])
    const earlier = await enqueue(database, accountA, 'batch-earlier', timeOne, [
      mutationRepository('job-b', 'repo-b'),
      mutationRepository('job-a', 'repo-a')
    ])
    const duplicate = await enqueue(database, accountA, 'batch-duplicate', timeThree, [
      mutationRepository('job-unused', 'repo-a')
    ])
    const otherAccount = await enqueue(database, accountB, 'batch-other', timeOne, [
      mutationRepository('job-other', 'repo-a')
    ])

    expect(later.reusedJobIds).toEqual([])
    expect(earlier.reusedJobIds).toEqual([])
    expect(duplicate.reusedJobIds).toEqual(['job-a'])
    expect(duplicate.batch.jobIds).toEqual(['job-a'])
    expect(otherAccount.reusedJobIds).toEqual([])
    expect(await listMutationJobs(database, accountA)).toHaveLength(3)
    expect(await listMutationJobs(database, accountB)).toHaveLength(1)
    expect(await listMutationBatches(database, accountA)).toHaveLength(3)
    expect(await listMutationBatches(database, accountB)).toHaveLength(1)
    expect(
      (await listMutationBatches(database, accountA)).every(
        (batch) => batch.githubUserId === accountA
      )
    ).toBe(true)

    const firstClaim = await claimNextEligibleMutationJob(database, accountA, timeThree)
    expect(firstClaim?.jobId).toBe('job-a')
    expect(await claimNextEligibleMutationJob(database, accountA, timeThree)).toBeNull()
    expect(await claimNextEligibleMutationJob(database, accountB, timeThree)).toBeNull()

    await setMutationJobRecoveryStatus(
      database,
      accountA,
      'job-a',
      'account-suspended',
      timeFour
    )
    expect((await claimNextEligibleMutationJob(database, accountB, timeFour))?.jobId).toBe(
      'job-other'
    )
    expect(await getMutationJob(database, accountB, 'job-a')).toBeNull()
    database.close()
  })

  test('rejects invalid transitions and permits cancellation only while queued', async () => {
    const database = await openTestDatabase('mutation-transition-test')
    await enqueue(database, accountA, 'batch-transition', timeOne, [
      mutationRepository('job-transition', 'repo-transition'),
      mutationRepository('job-cancel', 'repo-cancel')
    ])

    await expect(
      transitionMutationJob(
        database,
        accountA,
        'job-transition',
        'verifying',
        timeTwo
      )
    ).rejects.toThrow('Invalid mutation status transition')
    expect((await getMutationJob(database, accountA, 'job-transition'))?.status).toBe(
      'queued'
    )

    const cancellation = await cancelQueuedMutationJob(
      database,
      accountA,
      'job-cancel',
      'history-cancel',
      timeTwo
    )
    expect(cancellation.finalStatus).toBe('cancelled')
    expect(cancellation.verificationResult).toBe('cancelled-before-execution')
    expect((await getMutationJob(database, accountA, 'job-cancel'))?.status).toBe(
      'cancelled'
    )

    await claimNextEligibleMutationJob(database, accountA, timeThree)
    await expect(
      cancelQueuedMutationJob(
        database,
        accountA,
        'job-transition',
        'history-too-late',
        timeFour
      )
    ).rejects.toThrow('Only queued mutation jobs')
    database.close()
  })

  test('records immutable sanitized attempts and retry timing', async () => {
    const database = await openTestDatabase('mutation-attempt-test')
    await enqueue(database, accountA, 'batch-attempt', timeOne, [
      mutationRepository('job-attempt', 'repo-attempt')
    ])
    await claimNextEligibleMutationJob(database, accountA, timeOne)
    const unsafeInput: SanitizedMutationError & {
      readonly rawResponse: string
      readonly authorizationHeader: string
    } = {
      category: 'network',
      message: 'GitHub could not be reached.',
      statusCode: null,
      occurredAt: timeTwo,
      rawResponse: 'sensitive response',
      authorizationHeader: 'sensitive header'
    }

    const attempt = await recordMutationAttempt(database, {
      githubUserId: accountA,
      jobId: 'job-attempt',
      attemptId: 'attempt-1',
      outcome: 'retry-scheduled',
      startedAt: timeOne,
      completedAt: timeTwo,
      error: unsafeInput,
      retryEligibility: 'automatic',
      nextEligibleExecutionAt: timeFour
    })
    expect(attempt.attemptNumber).toBe(1)
    expect(attempt.error).toEqual({
      category: 'network',
      message: 'GitHub could not be reached.',
      statusCode: null,
      occurredAt: timeTwo
    })
    expect(JSON.stringify(attempt)).not.toContain('sensitive response')
    expect(JSON.stringify(attempt)).not.toContain('sensitive header')
    expect((await getMutationJob(database, accountA, 'job-attempt'))?.attemptCount).toBe(1)

    await expect(
      recordMutationAttempt(database, {
        githubUserId: accountA,
        jobId: 'job-attempt',
        attemptId: 'attempt-1',
        outcome: 'continued',
        startedAt: timeTwo,
        completedAt: timeThree,
        error: null,
        retryEligibility: 'automatic',
        nextEligibleExecutionAt: null
      })
    ).rejects.toThrow()
    expect((await getMutationJob(database, accountA, 'job-attempt'))?.attemptCount).toBe(1)

    await transitionMutationJob(
      database,
      accountA,
      'job-attempt',
      'retry-waiting',
      timeTwo,
      {nextEligibleExecutionAt: timeFour}
    )
    expect(await claimNextEligibleMutationJob(database, accountA, timeThree)).toBeNull()
    expect((await claimNextEligibleMutationJob(database, accountA, timeFour))?.jobId).toBe(
      'job-attempt'
    )
    database.close()
  })

  test('finalizes success with repository state, immutable history, and batch summary', async () => {
    const database = await openTestDatabase('mutation-finalization-test')
    await putRepository(database, repositoryFixture(accountA, 'repo-success'))
    await putAnnotation(database, {
      githubUserId: accountA,
      repositoryNodeId: 'repo-success',
      triageState: 'reviewed',
      tags: ['retained'],
      note: 'Keep this context',
      favorite: true,
      revisitAt: null,
      reviewedAt: timeOne,
      localModifiedAt: timeOne
    })
    await enqueue(database, accountA, 'batch-success', timeOne, [
      mutationRepository('job-success', 'repo-success')
    ])
    await claimNextEligibleMutationJob(database, accountA, timeOne)
    await transitionMutationJob(
      database,
      accountA,
      'job-success',
      'deleting',
      timeTwo
    )
    await transitionMutationJob(
      database,
      accountA,
      'job-success',
      'verifying',
      timeThree
    )
    await recordMutationAttempt(database, {
      githubUserId: accountA,
      jobId: 'job-success',
      attemptId: 'attempt-success',
      outcome: 'terminal',
      startedAt: timeOne,
      completedAt: timeThree,
      error: null,
      retryEligibility: 'not-retryable',
      nextEligibleExecutionAt: null
    })

    const history = await finalizeMutationJob(database, {
      githubUserId: accountA,
      jobId: 'job-success',
      historyId: 'history-success',
      finalStatus: 'succeeded',
      verificationResult: 'verified-absent',
      occurredAt: timeFour,
      error: null,
      retryEligibility: 'not-retryable'
    })
    expect(history.attemptCount).toBe(1)
    expect((await getRepository(database, accountA, 'repo-success'))?.isStarred).toBe(
      false
    )
    expect((await getRepository(database, accountA, 'repo-success'))?.unstarredAt).toBe(
      timeFour
    )
    expect(await getAnnotation(database, accountA, 'repo-success')).toMatchObject({
      tags: ['retained'],
      note: 'Keep this context',
      favorite: true
    })
    expect(await listOperationHistory(database, accountA)).toEqual([history])
    expect((await getMutationBatch(database, accountA, 'batch-success'))?.summary).toEqual({
      total: 1,
      succeeded: 1,
      failed: 0,
      blockedUnknown: 0,
      queued: 0,
      cancelled: 0,
      pending: 0,
      retryEligible: 0
    })
    expect((await getMutationBatch(database, accountA, 'batch-success'))?.status).toBe(
      'completed'
    )
    await expect(
      finalizeMutationJob(database, {
        githubUserId: accountA,
        jobId: 'job-success',
        historyId: 'history-replacement',
        finalStatus: 'succeeded',
        verificationResult: 'verified-absent',
        occurredAt: timeFour,
        error: null,
        retryEligibility: 'not-retryable'
      })
    ).rejects.toThrow('Invalid mutation status transition')
    expect(await listOperationHistory(database, accountA)).toEqual([history])
    database.close()
  })

  test('stores blocked-unknown separately and excludes automatic retry', async () => {
    const database = await openTestDatabase('mutation-blocked-summary-test')
    await putRepository(database, repositoryFixture(accountA, 'repo-external'))
    await putRepository(database, repositoryFixture(accountA, 'repo-blocked'))
    await enqueue(database, accountA, 'batch-mixed', timeOne, [
      mutationRepository('job-external', 'repo-external'),
      mutationRepository('job-blocked', 'repo-blocked')
    ])

    await claimNextEligibleMutationJob(database, accountA, timeOne)
    await finalizeMutationJob(database, {
      githubUserId: accountA,
      jobId: 'job-blocked',
      historyId: 'history-blocked-wrong-order',
      finalStatus: 'blocked-unknown',
      verificationResult: 'not-verified',
      occurredAt: timeTwo,
      error: verificationError(timeTwo),
      retryEligibility: 'after-refresh'
    })
    const next = await claimNextEligibleMutationJob(database, accountA, timeTwo)
    expect(next?.jobId).toBe('job-external')
    await finalizeMutationJob(database, {
      githubUserId: accountA,
      jobId: 'job-external',
      historyId: 'history-external',
      finalStatus: 'succeeded-external',
      verificationResult: 'already-absent',
      occurredAt: timeThree,
      error: null,
      retryEligibility: 'not-retryable'
    })

    const batch = await getMutationBatch(database, accountA, 'batch-mixed')
    expect(batch?.summary).toEqual({
      total: 2,
      succeeded: 1,
      failed: 0,
      blockedUnknown: 1,
      queued: 0,
      cancelled: 0,
      pending: 0,
      retryEligible: 1
    })
    expect(batch?.status).toBe('partially-completed')
    expect((await getRepository(database, accountA, 'repo-blocked'))?.isStarred).toBe(true)
    expect(
      (await listOperationHistory(database, accountA)).map((record) => record.finalStatus)
    ).toEqual(['blocked-unknown', 'succeeded-external'])
    database.close()
  })

  test('preserves annotations, triage history, and operation history for every terminal outcome', async () => {
    const database = await openTestDatabase('mutation-context-preservation-test')
    const outcomes = [
      ['job-1-succeeded', 'repo-succeeded'],
      ['job-2-external', 'repo-external'],
      ['job-3-failed', 'repo-failed'],
      ['job-4-blocked', 'repo-blocked'],
      ['job-5-cancelled', 'repo-cancelled']
    ] as const
    const annotations = new Map<string, AnnotationRecord>()
    for (const [, repositoryNodeId] of outcomes) {
      await putRepository(database, repositoryFixture(accountA, repositoryNodeId))
      const annotation = contextAnnotation(repositoryNodeId)
      annotations.set(repositoryNodeId, annotation)
      await putAnnotation(database, annotation)
    }
    await enqueue(
      database,
      accountA,
      'batch-context',
      timeOne,
      outcomes.map(([jobId, repositoryNodeId]) =>
        mutationRepository(jobId, repositoryNodeId)
      )
    )
    await cancelQueuedMutationJob(
      database,
      accountA,
      'job-5-cancelled',
      'history-cancelled',
      timeTwo
    )

    await claimNextEligibleMutationJob(database, accountA, timeTwo)
    await transitionMutationJob(
      database,
      accountA,
      'job-1-succeeded',
      'verifying',
      timeTwo
    )
    await finalizeMutationJob(database, {
      githubUserId: accountA,
      jobId: 'job-1-succeeded',
      historyId: 'history-succeeded',
      finalStatus: 'succeeded',
      verificationResult: 'verified-absent',
      occurredAt: timeThree,
      error: null,
      retryEligibility: 'not-retryable'
    })

    await claimNextEligibleMutationJob(database, accountA, timeThree)
    await finalizeMutationJob(database, {
      githubUserId: accountA,
      jobId: 'job-2-external',
      historyId: 'history-external',
      finalStatus: 'succeeded-external',
      verificationResult: 'already-absent',
      occurredAt: timeThree,
      error: null,
      retryEligibility: 'not-retryable'
    })

    await claimNextEligibleMutationJob(database, accountA, timeThree)
    await finalizeMutationJob(database, {
      githubUserId: accountA,
      jobId: 'job-3-failed',
      historyId: 'history-failed',
      finalStatus: 'failed',
      verificationResult: 'not-verified',
      occurredAt: timeThree,
      error: {
        category: 'authentication',
        message: 'GitHub authentication must be renewed.',
        statusCode: 401,
        occurredAt: timeThree
      },
      retryEligibility: 'after-reauthentication'
    })

    await claimNextEligibleMutationJob(database, accountA, timeThree)
    await finalizeMutationJob(database, {
      githubUserId: accountA,
      jobId: 'job-4-blocked',
      historyId: 'history-blocked',
      finalStatus: 'blocked-unknown',
      verificationResult: 'not-verified',
      occurredAt: timeFour,
      error: verificationError(timeFour),
      retryEligibility: 'after-refresh'
    })

    for (const [, repositoryNodeId] of outcomes) {
      expect(await getAnnotation(database, accountA, repositoryNodeId)).toEqual(
        annotations.get(repositoryNodeId) ?? null
      )
    }
    expect(
      await Promise.all(
        outcomes.map(([, repositoryNodeId]) =>
          getRepository(database, accountA, repositoryNodeId).then(
            (repository) => repository?.isStarred
          )
        )
      )
    ).toEqual([false, false, true, true, true])
    expect(
      (await listOperationHistory(database, accountA))
        .map((history) => history.finalStatus)
        .sort()
    ).toEqual([
      'blocked-unknown',
      'cancelled',
      'failed',
      'succeeded',
      'succeeded-external'
    ])
    database.close()
  })

  test('rolls back enqueue and finalization failures atomically', async () => {
    const database = await openTestDatabase('mutation-rollback-test')
    await expect(
      enqueue(database, accountA, 'batch-rollback', timeOne, [
        mutationRepository('duplicate-job-id', 'repo-one'),
        mutationRepository('duplicate-job-id', 'repo-two')
      ])
    ).rejects.toThrow()
    expect(await getMutationBatch(database, accountA, 'batch-rollback')).toBeNull()
    expect(await listMutationJobs(database, accountA)).toEqual([])

    await putRepository(database, repositoryFixture(accountA, 'repo-one'))
    await putRepository(database, repositoryFixture(accountA, 'repo-two'))
    await enqueue(database, accountA, 'batch-history-rollback', timeOne, [
      mutationRepository('job-one', 'repo-one'),
      mutationRepository('job-two', 'repo-two')
    ])
    await claimNextEligibleMutationJob(database, accountA, timeOne)
    await transitionMutationJob(database, accountA, 'job-one', 'verifying', timeTwo)
    await finalizeMutationJob(database, {
      githubUserId: accountA,
      jobId: 'job-one',
      historyId: 'shared-history-id',
      finalStatus: 'succeeded',
      verificationResult: 'verified-absent',
      occurredAt: timeThree,
      error: null,
      retryEligibility: 'not-retryable'
    })
    await claimNextEligibleMutationJob(database, accountA, timeThree)
    await transitionMutationJob(database, accountA, 'job-two', 'verifying', timeThree)

    await expect(
      finalizeMutationJob(database, {
        githubUserId: accountA,
        jobId: 'job-two',
        historyId: 'shared-history-id',
        finalStatus: 'succeeded',
        verificationResult: 'verified-absent',
        occurredAt: timeFour,
        error: null,
        retryEligibility: 'not-retryable'
      })
    ).rejects.toThrow()
    expect((await getMutationJob(database, accountA, 'job-two'))?.status).toBe(
      'verifying'
    )
    expect((await getRepository(database, accountA, 'repo-two'))?.isStarred).toBe(true)
    expect(await listOperationHistory(database, accountA)).toHaveLength(1)
    expect((await getMutationBatch(database, accountA, 'batch-history-rollback'))?.summary)
      .toMatchObject({succeeded: 1, pending: 1})
    database.close()
  })

  test('completely clears mutation intent, attempts, and history', async () => {
    const database = await openTestDatabase('mutation-complete-deletion-test')
    await enqueue(database, accountA, 'batch-delete', timeOne, [
      mutationRepository('job-delete', 'repo-delete')
    ])
    await recordMutationAttempt(database, {
      githubUserId: accountA,
      jobId: 'job-delete',
      attemptId: 'attempt-delete',
      outcome: 'continued',
      startedAt: timeOne,
      completedAt: timeTwo,
      error: null,
      retryEligibility: 'automatic',
      nextEligibleExecutionAt: timeThree
    })
    await cancelQueuedMutationJob(
      database,
      accountA,
      'job-delete',
      'history-delete',
      timeThree
    )

    await clearAllLibraryData(database)

    expect(await getMutationBatch(database, accountA, 'batch-delete')).toBeNull()
    expect(await listMutationJobs(database, accountA)).toEqual([])
    expect(await listMutationAttempts(database, accountA)).toEqual([])
    expect(await listOperationHistory(database, accountA)).toEqual([])
    database.close()
  })
})

function openTestDatabase(name: string): Promise<IDBDatabase> {
  return openLibraryDatabase({name, factory: new IDBFactory()})
}

function mutationRepository(
  jobId: string,
  repositoryNodeId: string
): {
  readonly jobId: string
  readonly repositoryNodeId: string
  readonly ownerLogin: string
  readonly repositoryName: string
} {
  return {
    jobId,
    repositoryNodeId,
    ownerLogin: 'octocat',
    repositoryName: repositoryNodeId
  }
}

function enqueue(
  database: IDBDatabase,
  githubUserId: string,
  batchId: string,
  createdAt: string,
  repositories: readonly ReturnType<typeof mutationRepository>[]
) {
  return enqueueMutationBatch(database, {
    githubUserId,
    batchId,
    origin: repositories.length === 1 ? 'single' : 'bulk',
    createdAt,
    repositories
  })
}

function repositoryFixture(
  githubUserId: string,
  repositoryNodeId: string
): RepositoryRecord {
  return {
    githubUserId,
    repositoryNodeId,
    ownerLogin: 'octocat',
    name: repositoryNodeId,
    fullName: `octocat/${repositoryNodeId}`,
    htmlUrl: `https://github.com/octocat/${repositoryNodeId}`,
    description: null,
    topics: [],
    primaryLanguage: null,
    starredAt: timeOne,
    pushedAt: null,
    archived: false,
    disabled: false,
    isStarred: true,
    firstObservedAt: timeOne,
    lastObservedAt: timeOne,
    unstarredAt: null
  }
}

function verificationError(occurredAt: string): SanitizedMutationError {
  return {
    category: 'verification-mismatch',
    message: 'Repository state could not be verified.',
    statusCode: null,
    occurredAt
  }
}

function contextAnnotation(repositoryNodeId: string): AnnotationRecord {
  return {
    githubUserId: accountA,
    repositoryNodeId,
    triageState: 'snoozed',
    tags: ['retained', repositoryNodeId],
    note: `Context for ${repositoryNodeId}`,
    favorite: true,
    revisitAt: '2026-08-10T10:00:00.000Z',
    reviewedAt: timeOne,
    localModifiedAt: timeTwo
  }
}
