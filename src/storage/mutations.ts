import type {
  GitHubUserId,
  IsoDateTime,
  MutationAttemptId,
  MutationAttemptOutcome,
  MutationAttemptRecord,
  MutationBatchId,
  MutationBatchRecord,
  MutationBatchStatus,
  MutationBatchSummary,
  MutationJobId,
  MutationJobRecord,
  MutationJobStatus,
  MembershipMutationDetails,
  MutationOrigin,
  MutationRecoveryStatus,
  MutationRetryEligibility,
  MutationTerminalStatus,
  MutationVerificationResult,
  OperationHistoryId,
  OperationHistoryRecord,
  NativeMembershipRecord,
  RepositoryNodeId,
  RepositoryRecord,
  SanitizedMutationError
} from '../domain/types'
import {
  canonicalMembershipSet,
  planMembershipIntent,
  referencedListNodeIds,
  type CanonicalListCatalogFingerprint,
  type MembershipIntentPlan
} from '../domain/native-list-membership'
import {
  libraryIndexes,
  libraryStores,
  requestResult,
  runLibraryTransaction
} from './database'

const activeJobStatuses: ReadonlySet<MutationJobStatus> = new Set([
  'queued',
  'checking',
  'deleting',
  'verifying',
  'observing-membership',
  'mutating-membership',
  'verifying-membership',
  'retry-waiting'
])

const executingJobStatuses: ReadonlySet<MutationJobStatus> = new Set([
  'checking',
  'deleting',
  'verifying',
  'observing-membership',
  'mutating-membership',
  'verifying-membership'
])

const terminalJobStatuses: ReadonlySet<MutationJobStatus> = new Set([
  'succeeded',
  'succeeded-external',
  'failed',
  'blocked-unknown',
  'needs-confirmation',
  'unstable-observation',
  'verification-conflict',
  'cancelled'
])

const allowedTransitions: Readonly<
  Record<MutationJobStatus, ReadonlySet<MutationJobStatus>>
> = {
  queued: new Set(['checking', 'cancelled']),
  checking: new Set([
    'deleting',
    'verifying',
    'observing-membership',
    'succeeded',
    'succeeded-external',
    'retry-waiting',
    'failed',
    'blocked-unknown'
  ]),
  deleting: new Set([
    'verifying',
    'succeeded',
    'retry-waiting',
    'failed',
    'blocked-unknown'
  ]),
  verifying: new Set([
    'succeeded',
    'succeeded-external',
    'retry-waiting',
    'failed',
    'blocked-unknown'
  ]),
  'observing-membership': new Set([
    'mutating-membership',
    'retry-waiting',
    'succeeded',
    'needs-confirmation',
    'unstable-observation',
    'verification-conflict',
    'failed',
    'blocked-unknown'
  ]),
  'mutating-membership': new Set([
    'observing-membership',
    'verifying-membership',
    'retry-waiting',
    'succeeded',
    'unstable-observation',
    'verification-conflict',
    'failed',
    'blocked-unknown'
  ]),
  'verifying-membership': new Set([
    'observing-membership',
    'retry-waiting',
    'succeeded',
    'unstable-observation',
    'verification-conflict',
    'failed',
    'blocked-unknown'
  ]),
  'retry-waiting': new Set([
    'checking',
    'failed',
    'blocked-unknown',
    'unstable-observation',
    'verification-conflict'
  ]),
  succeeded: new Set(),
  'succeeded-external': new Set(),
  failed: new Set(),
  'blocked-unknown': new Set(),
  'needs-confirmation': new Set(),
  'unstable-observation': new Set(),
  'verification-conflict': new Set(),
  cancelled: new Set()
}

export interface EnqueueMutationRepository {
  readonly jobId: MutationJobId
  readonly repositoryNodeId: RepositoryNodeId
  readonly ownerLogin: string
  readonly repositoryName: string
}

export interface EnqueueMutationBatchInput {
  readonly githubUserId: GitHubUserId
  readonly batchId: MutationBatchId
  readonly origin: MutationOrigin
  readonly createdAt: IsoDateTime
  readonly repositories: readonly EnqueueMutationRepository[]
}

export interface EnqueueMutationBatchResult {
  readonly batch: MutationBatchRecord
  readonly jobs: readonly MutationJobRecord[]
  readonly reusedJobIds: readonly MutationJobId[]
}

export async function enqueueMutationBatch(
  database: IDBDatabase,
  input: EnqueueMutationBatchInput
): Promise<EnqueueMutationBatchResult> {
  if (input.repositories.length === 0) {
    throw new Error('A mutation batch requires at least one repository.')
  }

  return runLibraryTransaction(
    database,
    [libraryStores.mutationBatches, libraryStores.mutationJobs],
    'readwrite',
    async (transaction) => {
      const batchStore = transaction.objectStore(libraryStores.mutationBatches)
      const jobStore = transaction.objectStore(libraryStores.mutationJobs)
      const repositoryIndex = jobStore.index(libraryIndexes.byAccountRepository)
      const repositories = uniqueRepositories(input.repositories)
      const jobs: MutationJobRecord[] = []
      const reusedJobIds: MutationJobId[] = []

      for (const repository of repositories) {
        const matchingJobs = await requestResult(
          repositoryIndex.getAll([
            input.githubUserId,
            repository.repositoryNodeId
          ]) as IDBRequest<MutationJobRecord[]>
        )
        const overlapping = matchingJobs
          .filter((job) => activeJobStatuses.has(job.status))
          .sort(compareJobs)[0]
        const existing = overlapping?.mutationKind === 'unstar' ? overlapping : null

        if (existing) {
          jobs.push(existing)
          reusedJobIds.push(existing.jobId)
          continue
        }
        if (overlapping) {
          throw new Error('An active mutation already exists for this account and repository.')
        }

        const job: MutationJobRecord = {
          githubUserId: input.githubUserId,
          jobId: repository.jobId,
          batchId: input.batchId,
          mutationKind: 'unstar',
          repositoryNodeId: repository.repositoryNodeId,
          ownerLogin: repository.ownerLogin,
          repositoryName: repository.repositoryName,
          status: 'queued',
          recoveryStatus: 'none',
          retryEligibility: 'automatic',
          attemptCount: 0,
          nextEligibleExecutionAt: input.createdAt,
          claimedAt: null,
          completedAt: null,
          lastError: null,
          membershipDetails: null,
          createdAt: input.createdAt,
          updatedAt: input.createdAt
        }
        await requestResult(jobStore.add(job))
        jobs.push(job)
      }

      const summary = deriveMutationBatchSummary(jobs)
      const batch: MutationBatchRecord = {
        githubUserId: input.githubUserId,
        batchId: input.batchId,
        mutationKind: 'unstar',
        origin: input.origin,
        repositoryNodeIds: repositories.map(
          (repository) => repository.repositoryNodeId
        ),
        jobIds: jobs.map((job) => job.jobId),
        status: deriveMutationBatchStatus(summary),
        summary,
        createdAt: input.createdAt,
        updatedAt: input.createdAt
      }
      await requestResult(batchStore.add(batch))
      return {batch, jobs, reusedJobIds}
    }
  )
}

export interface EnqueueMembershipMutationRepository
  extends EnqueueMutationRepository {
  readonly plan: MembershipIntentPlan
  readonly confirmedCatalog: CanonicalListCatalogFingerprint
}

export interface EnqueueMembershipMutationBatchInput {
  readonly githubUserId: GitHubUserId
  readonly batchId: MutationBatchId
  readonly origin: Exclude<MutationOrigin, 'manual-retry'>
  readonly createdAt: IsoDateTime
  readonly repositories: readonly EnqueueMembershipMutationRepository[]
}

export async function enqueueMembershipMutationBatch(
  database: IDBDatabase,
  input: EnqueueMembershipMutationBatchInput
): Promise<EnqueueMutationBatchResult> {
  if (input.repositories.length === 0) {
    throw new Error('A membership mutation batch requires at least one repository.')
  }

  return runLibraryTransaction(
    database,
    [libraryStores.mutationBatches, libraryStores.mutationJobs],
    'readwrite',
    async (transaction) => {
      const batchStore = transaction.objectStore(libraryStores.mutationBatches)
      const jobStore = transaction.objectStore(libraryStores.mutationJobs)
      const repositoryIndex = jobStore.index(libraryIndexes.byAccountRepository)
      const repositories = uniqueMembershipRepositories(input.repositories)
      const jobs: MutationJobRecord[] = []

      for (const repository of repositories) {
        if (
          repository.plan.githubUserId !== input.githubUserId ||
          repository.plan.repositoryNodeId !== repository.repositoryNodeId
        ) {
          throw new Error('Membership plan account or repository does not match its job.')
        }
        validateMembershipPlan(repository.plan, repository.confirmedCatalog)
        const matchingJobs = await requestResult(
          repositoryIndex.getAll([
            input.githubUserId,
            repository.repositoryNodeId
          ]) as IDBRequest<MutationJobRecord[]>
        )
        if (matchingJobs.some((job) => activeJobStatuses.has(job.status))) {
          throw new Error('An active mutation already exists for this account and repository.')
        }

        const membershipDetails: MembershipMutationDetails = {
          intent: repository.plan.intent,
          confirmedBefore: repository.plan.before,
          desired: repository.plan.desired,
          confirmedCatalog: repository.confirmedCatalog,
          latestObserved: null,
          latestObservedCatalog: null,
          membershipFingerprint: repository.plan.before.fingerprint,
          listCatalogFingerprint: repository.confirmedCatalog.fingerprint,
          mutationPayload: null,
          recoveryPhase: null,
          needsConfirmation: null,
          unstableObservation: null,
          verificationConflict: null
        }
        const job: MutationJobRecord = {
          githubUserId: input.githubUserId,
          jobId: repository.jobId,
          batchId: input.batchId,
          mutationKind: 'native-list-membership',
          repositoryNodeId: repository.repositoryNodeId,
          ownerLogin: repository.ownerLogin,
          repositoryName: repository.repositoryName,
          status: 'queued',
          recoveryStatus: 'none',
          retryEligibility: 'automatic',
          attemptCount: 0,
          nextEligibleExecutionAt: input.createdAt,
          claimedAt: null,
          completedAt: null,
          lastError: null,
          membershipDetails,
          createdAt: input.createdAt,
          updatedAt: input.createdAt
        }
        await requestResult(jobStore.add(job))
        jobs.push(job)
      }

      const summary = deriveMutationBatchSummary(jobs)
      const batch: MutationBatchRecord = {
        githubUserId: input.githubUserId,
        batchId: input.batchId,
        mutationKind: 'native-list-membership',
        origin: input.origin,
        repositoryNodeIds: repositories.map(
          (repository) => repository.repositoryNodeId
        ),
        jobIds: jobs.map((job) => job.jobId),
        status: deriveMutationBatchStatus(summary),
        summary,
        createdAt: input.createdAt,
        updatedAt: input.createdAt
      }
      await requestResult(batchStore.add(batch))
      return {batch, jobs, reusedJobIds: []}
    }
  )
}

export async function claimNextEligibleMutationJob(
  database: IDBDatabase,
  githubUserId: GitHubUserId,
  claimedAt: IsoDateTime
): Promise<MutationJobRecord | null> {
  return runLibraryTransaction(
    database,
    [libraryStores.mutationBatches, libraryStores.mutationJobs],
    'readwrite',
    async (transaction) => {
      const store = transaction.objectStore(libraryStores.mutationJobs)
      const jobs = await requestResult(
        store.getAll() as IDBRequest<MutationJobRecord[]>
      )
      const executing = jobs.some(
        (job) =>
          executingJobStatuses.has(job.status) &&
          job.recoveryStatus !== 'account-suspended'
      )
      if (executing) return null

      const eligible = jobs
        .filter(
          (job) =>
            job.githubUserId === githubUserId &&
            (job.status === 'queued' || job.status === 'retry-waiting') &&
            job.recoveryStatus === 'none' &&
            job.nextEligibleExecutionAt !== null &&
            job.nextEligibleExecutionAt <= claimedAt
        )
        .sort(compareEligibleJobs)[0]
      if (!eligible) return null

      const claimed: MutationJobRecord = {
        ...eligible,
        status: 'checking',
        claimedAt,
        nextEligibleExecutionAt: null,
        updatedAt: claimedAt
      }
      await requestResult(store.put(claimed))
      await updateReferencingBatchSummaries(
        transaction,
        githubUserId,
        claimed.jobId,
        claimedAt
      )
      return claimed
    }
  )
}

export interface ClaimedMutationWork {
  readonly job: MutationJobRecord
  readonly recovery: boolean
  readonly interruptedStatus: MutationJobStatus | null
}

export async function prepareMutationJobsForActiveAccount(
  database: IDBDatabase,
  githubUserId: GitHubUserId | null,
  occurredAt: IsoDateTime
): Promise<void> {
  await runLibraryTransaction(
    database,
    libraryStores.mutationJobs,
    'readwrite',
    async (transaction) => {
      const store = transaction.objectStore(libraryStores.mutationJobs)
      const jobs = await requestResult(
        store.getAll() as IDBRequest<MutationJobRecord[]>
      )

      for (const job of jobs) {
        if (!activeJobStatuses.has(job.status)) continue
        let recoveryStatus = job.recoveryStatus
        if (job.githubUserId !== githubUserId) {
          recoveryStatus = 'account-suspended'
        } else if (job.recoveryStatus === 'account-suspended') {
          recoveryStatus = executingJobStatuses.has(job.status)
            ? 'owner-recovery-pending'
            : 'none'
        } else if (
          executingJobStatuses.has(job.status) &&
          job.recoveryStatus === 'none'
        ) {
          recoveryStatus = 'owner-recovery-pending'
        }

        if (recoveryStatus !== job.recoveryStatus) {
          await requestResult(
            store.put({...job, recoveryStatus, updatedAt: occurredAt})
          )
        }
      }
    }
  )
}

export async function claimNextMutationWork(
  database: IDBDatabase,
  githubUserId: GitHubUserId,
  claimedAt: IsoDateTime
): Promise<ClaimedMutationWork | null> {
  return runLibraryTransaction(
    database,
    [libraryStores.mutationBatches, libraryStores.mutationJobs],
    'readwrite',
    async (transaction) => {
      const store = transaction.objectStore(libraryStores.mutationJobs)
      const jobs = await requestResult(
        store.getAll() as IDBRequest<MutationJobRecord[]>
      )
      const executing = jobs
        .filter(
          (job) =>
            executingJobStatuses.has(job.status) &&
            job.recoveryStatus !== 'account-suspended'
        )
        .sort(compareJobs)[0]

      if (executing) {
        if (
          executing.githubUserId !== githubUserId ||
          executing.recoveryStatus !== 'owner-recovery-pending'
        ) {
          return null
        }
        const claimed: MutationJobRecord = {
          ...executing,
          recoveryStatus: 'none',
          claimedAt,
          updatedAt: claimedAt
        }
        await requestResult(store.put(claimed))
        return {
          job: claimed,
          recovery: true,
          interruptedStatus: executing.status
        }
      }

      const eligible = jobs
        .filter(
          (job) =>
            job.githubUserId === githubUserId &&
            (job.status === 'queued' || job.status === 'retry-waiting') &&
            (job.recoveryStatus === 'none' ||
              job.recoveryStatus === 'owner-recovery-pending') &&
            job.nextEligibleExecutionAt !== null &&
            job.nextEligibleExecutionAt <= claimedAt
        )
        .sort(compareEligibleJobs)[0]
      if (!eligible) return null

      const recovery = eligible.recoveryStatus === 'owner-recovery-pending'
      const claimed: MutationJobRecord = {
        ...eligible,
        status: 'checking',
        recoveryStatus: 'none',
        claimedAt,
        nextEligibleExecutionAt: null,
        updatedAt: claimedAt
      }
      await requestResult(store.put(claimed))
      await updateReferencingBatchSummaries(
        transaction,
        githubUserId,
        claimed.jobId,
        claimedAt
      )
      return {
        job: claimed,
        recovery,
        interruptedStatus: recovery ? eligible.status : null
      }
    }
  )
}

export async function getNextMutationExecutionAt(
  database: IDBDatabase,
  githubUserId: GitHubUserId,
  now: IsoDateTime
): Promise<IsoDateTime | null> {
  return runLibraryTransaction(
    database,
    libraryStores.mutationJobs,
    'readonly',
    async (transaction) => {
      const jobs = await requestResult(
        transaction.objectStore(libraryStores.mutationJobs).getAll() as IDBRequest<
          MutationJobRecord[]
        >
      )
      if (
        jobs.some(
          (job) =>
            job.githubUserId === githubUserId &&
            executingJobStatuses.has(job.status) &&
            job.recoveryStatus !== 'account-suspended'
        )
      ) {
        return now
      }
      return (
        jobs
          .filter(
            (job) =>
              job.githubUserId === githubUserId &&
              (job.status === 'queued' || job.status === 'retry-waiting') &&
              job.recoveryStatus !== 'account-suspended' &&
              job.nextEligibleExecutionAt !== null
          )
          .map((job) => job.nextEligibleExecutionAt as IsoDateTime)
          .sort()[0] ?? null
      )
    }
  )
}

export interface MutationJobTransitionUpdates {
  readonly nextEligibleExecutionAt?: IsoDateTime | null
  readonly retryEligibility?: MutationRetryEligibility
  readonly error?: SanitizedMutationError | null
  readonly recoveryStatus?: MutationRecoveryStatus
  readonly membershipDetails?: MembershipMutationDetails
}

export async function transitionMutationJob(
  database: IDBDatabase,
  githubUserId: GitHubUserId,
  jobId: MutationJobId,
  nextStatus: MutationJobStatus,
  occurredAt: IsoDateTime,
  updates: MutationJobTransitionUpdates = {}
): Promise<MutationJobRecord> {
  if (terminalJobStatuses.has(nextStatus)) {
    throw new Error('Terminal mutation statuses require finalization.')
  }

  return runLibraryTransaction(
    database,
    [libraryStores.mutationBatches, libraryStores.mutationJobs],
    'readwrite',
    async (transaction) => {
      const store = transaction.objectStore(libraryStores.mutationJobs)
      const job = await requireJob(store, githubUserId, jobId)
      assertTransition(job.status, nextStatus)
      const updated = applyTransition(job, nextStatus, occurredAt, updates)
      await requestResult(store.put(updated))
      await updateReferencingBatchSummaries(
        transaction,
        githubUserId,
        jobId,
        occurredAt
      )
      return updated
    }
  )
}

export async function setMutationJobRecoveryStatus(
  database: IDBDatabase,
  githubUserId: GitHubUserId,
  jobId: MutationJobId,
  recoveryStatus: MutationRecoveryStatus,
  occurredAt: IsoDateTime
): Promise<MutationJobRecord> {
  return runLibraryTransaction(
    database,
    libraryStores.mutationJobs,
    'readwrite',
    async (transaction) => {
      const store = transaction.objectStore(libraryStores.mutationJobs)
      const job = await requireJob(store, githubUserId, jobId)
      if (terminalJobStatuses.has(job.status)) {
        throw new Error('A terminal mutation job cannot enter recovery.')
      }
      const updated: MutationJobRecord = {
        ...job,
        recoveryStatus,
        updatedAt: occurredAt
      }
      await requestResult(store.put(updated))
      return updated
    }
  )
}

export interface RecordMutationAttemptInput {
  readonly githubUserId: GitHubUserId
  readonly jobId: MutationJobId
  readonly attemptId: MutationAttemptId
  readonly outcome: MutationAttemptOutcome
  readonly startedAt: IsoDateTime
  readonly completedAt: IsoDateTime
  readonly error: SanitizedMutationError | null
  readonly retryEligibility: MutationRetryEligibility
  readonly nextEligibleExecutionAt: IsoDateTime | null
}

export async function recordMutationAttempt(
  database: IDBDatabase,
  input: RecordMutationAttemptInput
): Promise<MutationAttemptRecord> {
  return runLibraryTransaction(
    database,
    [libraryStores.mutationJobs, libraryStores.mutationAttempts],
    'readwrite',
    async (transaction) => {
      const jobStore = transaction.objectStore(libraryStores.mutationJobs)
      const attemptStore = transaction.objectStore(libraryStores.mutationAttempts)
      const job = await requireJob(jobStore, input.githubUserId, input.jobId)
      if (terminalJobStatuses.has(job.status)) {
        throw new Error('A terminal mutation job cannot record another attempt.')
      }

      const error = copySanitizedError(input.error)
      const attempt: MutationAttemptRecord = {
        githubUserId: input.githubUserId,
        attemptId: input.attemptId,
        jobId: job.jobId,
        batchId: job.batchId,
        repositoryNodeId: job.repositoryNodeId,
        attemptNumber: job.attemptCount + 1,
        outcome: input.outcome,
        startedAt: input.startedAt,
        completedAt: input.completedAt,
        error,
        retryEligibility: input.retryEligibility,
        nextEligibleExecutionAt: input.nextEligibleExecutionAt
      }
      await requestResult(attemptStore.add(attempt))
      await requestResult(
        jobStore.put({
          ...job,
          attemptCount: attempt.attemptNumber,
          lastError: error,
          retryEligibility: input.retryEligibility,
          nextEligibleExecutionAt: input.nextEligibleExecutionAt,
          updatedAt: input.completedAt
        } satisfies MutationJobRecord)
      )
      return attempt
    }
  )
}

export interface FinalizeMutationJobInput {
  readonly githubUserId: GitHubUserId
  readonly jobId: MutationJobId
  readonly historyId: OperationHistoryId
  readonly finalStatus: Exclude<MutationTerminalStatus, 'cancelled'>
  readonly verificationResult: MutationVerificationResult
  readonly occurredAt: IsoDateTime
  readonly error: SanitizedMutationError | null
  readonly retryEligibility: MutationRetryEligibility
  readonly membershipDetails?: MembershipMutationDetails
  readonly updateLocalMemberships?: boolean
}

export async function finalizeMutationJob(
  database: IDBDatabase,
  input: FinalizeMutationJobInput
): Promise<OperationHistoryRecord> {
  return runLibraryTransaction(
    database,
    [
      libraryStores.repositories,
      libraryStores.nativeMemberships,
      libraryStores.mutationBatches,
      libraryStores.mutationJobs,
      libraryStores.operationHistory
    ],
    'readwrite',
    async (transaction) => {
      const jobStore = transaction.objectStore(libraryStores.mutationJobs)
      const job = await requireJob(jobStore, input.githubUserId, input.jobId)
      assertTransition(job.status, input.finalStatus)
      assertTerminalRetryEligibility(input.finalStatus, input.retryEligibility)
      const error = copySanitizedError(input.error)
      const batch = await requireBatch(
        transaction.objectStore(libraryStores.mutationBatches),
        input.githubUserId,
        job.batchId
      )

      if (
        job.mutationKind === 'unstar' &&
        (input.finalStatus === 'succeeded' || input.finalStatus === 'succeeded-external')
      ) {
        const repositoryStore = transaction.objectStore(libraryStores.repositories)
        const repository = await requestResult(
          repositoryStore.get([
            input.githubUserId,
            job.repositoryNodeId
          ]) as IDBRequest<RepositoryRecord | undefined>
        )
        if (!repository) {
          throw new Error('The mutation repository record does not exist.')
        }
        await requestResult(
          repositoryStore.put({
            ...repository,
            isStarred: false,
            unstarredAt: input.occurredAt,
            lastObservedAt: input.occurredAt
          } satisfies RepositoryRecord)
        )
      }

      const membershipDetails = input.membershipDetails ?? job.membershipDetails
      if (job.mutationKind === 'native-list-membership' && !membershipDetails) {
        throw new Error('A membership mutation job requires membership details.')
      }
      if (input.updateLocalMemberships) {
        if (
          input.finalStatus !== 'succeeded' &&
          input.finalStatus !== 'verification-conflict'
        ) {
          throw new Error('Only verified or conflicting membership results update the local mirror.')
        }
        if (job.mutationKind !== 'native-list-membership' || !membershipDetails?.latestObserved) {
          throw new Error('A stable membership observation is required for local reconciliation.')
        }
        await replaceRepositoryMemberships(
          transaction.objectStore(libraryStores.nativeMemberships),
          input.githubUserId,
          job.repositoryNodeId,
          membershipDetails.latestObserved.listNodeIds,
          input.occurredAt
        )
      }

      const finalized: MutationJobRecord = {
        ...job,
        status: input.finalStatus,
        recoveryStatus: 'none',
        retryEligibility: input.retryEligibility,
        nextEligibleExecutionAt: null,
        completedAt: input.occurredAt,
        lastError: error,
        membershipDetails,
        updatedAt: input.occurredAt
      }
      const history = createHistoryRecord(
        finalized,
        input.finalStatus,
        batch.origin,
        input.historyId,
        input.verificationResult,
        input.occurredAt
      )
      await requestResult(jobStore.put(finalized))
      await requestResult(
        transaction.objectStore(libraryStores.operationHistory).add(history)
      )
      await updateReferencingBatchSummaries(
        transaction,
        input.githubUserId,
        job.jobId,
        input.occurredAt
      )
      return history
    }
  )
}

export async function cancelQueuedMutationJob(
  database: IDBDatabase,
  githubUserId: GitHubUserId,
  jobId: MutationJobId,
  historyId: OperationHistoryId,
  cancelledAt: IsoDateTime
): Promise<OperationHistoryRecord> {
  return runLibraryTransaction(
    database,
    [
      libraryStores.mutationBatches,
      libraryStores.mutationJobs,
      libraryStores.operationHistory
    ],
    'readwrite',
    async (transaction) => {
      const jobStore = transaction.objectStore(libraryStores.mutationJobs)
      const job = await requireJob(jobStore, githubUserId, jobId)
      if (job.status !== 'queued') {
        throw new Error('Only queued mutation jobs can be cancelled.')
      }
      const batch = await requireBatch(
        transaction.objectStore(libraryStores.mutationBatches),
        githubUserId,
        job.batchId
      )
      const cancelled: MutationJobRecord = {
        ...job,
        status: 'cancelled',
        recoveryStatus: 'none',
        retryEligibility: 'not-retryable',
        nextEligibleExecutionAt: null,
        completedAt: cancelledAt,
        lastError: null,
        updatedAt: cancelledAt
      }
      const history = createHistoryRecord(
        cancelled,
        'cancelled',
        batch.origin,
        historyId,
        'cancelled-before-execution',
        cancelledAt
      )
      await requestResult(jobStore.put(cancelled))
      await requestResult(
        transaction.objectStore(libraryStores.operationHistory).add(history)
      )
      await updateReferencingBatchSummaries(
        transaction,
        githubUserId,
        jobId,
        cancelledAt
      )
      return history
    }
  )
}

export async function getMutationBatch(
  database: IDBDatabase,
  githubUserId: GitHubUserId,
  batchId: MutationBatchId
): Promise<MutationBatchRecord | null> {
  return getMutationRecord<MutationBatchRecord>(
    database,
    libraryStores.mutationBatches,
    [githubUserId, batchId]
  )
}

export async function getMutationJob(
  database: IDBDatabase,
  githubUserId: GitHubUserId,
  jobId: MutationJobId
): Promise<MutationJobRecord | null> {
  return getMutationRecord<MutationJobRecord>(database, libraryStores.mutationJobs, [
    githubUserId,
    jobId
  ])
}

export async function listMutationJobs(
  database: IDBDatabase,
  githubUserId: GitHubUserId
): Promise<readonly MutationJobRecord[]> {
  return listMutationRecords<MutationJobRecord>(
    database,
    libraryStores.mutationJobs,
    githubUserId
  )
}

export async function listMutationBatches(
  database: IDBDatabase,
  githubUserId: GitHubUserId
): Promise<readonly MutationBatchRecord[]> {
  return listMutationRecords<MutationBatchRecord>(
    database,
    libraryStores.mutationBatches,
    githubUserId
  )
}

export async function listMutationAttempts(
  database: IDBDatabase,
  githubUserId: GitHubUserId
): Promise<readonly MutationAttemptRecord[]> {
  return listMutationRecords<MutationAttemptRecord>(
    database,
    libraryStores.mutationAttempts,
    githubUserId
  )
}

export async function listOperationHistory(
  database: IDBDatabase,
  githubUserId: GitHubUserId
): Promise<readonly OperationHistoryRecord[]> {
  return listMutationRecords<OperationHistoryRecord>(
    database,
    libraryStores.operationHistory,
    githubUserId
  )
}

export function deriveMutationBatchSummary(
  jobs: readonly MutationJobRecord[]
): MutationBatchSummary {
  let succeeded = 0
  let failed = 0
  let blockedUnknown = 0
  let queued = 0
  let cancelled = 0
  let pending = 0
  let retryEligible = 0

  for (const job of jobs) {
    if (job.status === 'succeeded' || job.status === 'succeeded-external') {
      succeeded += 1
    } else if (job.status === 'failed') {
      failed += 1
    } else if (
      job.status === 'blocked-unknown' ||
      job.status === 'needs-confirmation' ||
      job.status === 'unstable-observation' ||
      job.status === 'verification-conflict'
    ) {
      blockedUnknown += 1
    } else if (job.status === 'queued') {
      queued += 1
    } else if (job.status === 'cancelled') {
      cancelled += 1
    } else {
      pending += 1
    }

    if (
      (job.status === 'failed' ||
        job.status === 'blocked-unknown' ||
        job.status === 'needs-confirmation' ||
        job.status === 'unstable-observation' ||
        job.status === 'verification-conflict') &&
      job.retryEligibility !== 'not-retryable'
    ) {
      retryEligible += 1
    }
  }

  return {
    total: jobs.length,
    succeeded,
    failed,
    blockedUnknown,
    queued,
    cancelled,
    pending,
    retryEligible
  }
}

function deriveMutationBatchStatus(
  summary: MutationBatchSummary
): MutationBatchStatus {
  if (summary.cancelled === summary.total) return 'cancelled'
  if (summary.queued === summary.total) return 'queued'
  const terminal =
    summary.succeeded + summary.failed + summary.blockedUnknown + summary.cancelled
  if (terminal < summary.total) return 'in-progress'
  const distinctOutcomes = [
    summary.succeeded,
    summary.failed,
    summary.blockedUnknown,
    summary.cancelled
  ].filter((count) => count > 0).length
  return distinctOutcomes > 1 ? 'partially-completed' : 'completed'
}

function uniqueRepositories(
  repositories: readonly EnqueueMutationRepository[]
): readonly EnqueueMutationRepository[] {
  const unique = new Map<RepositoryNodeId, EnqueueMutationRepository>()
  for (const repository of repositories) {
    if (!unique.has(repository.repositoryNodeId)) {
      unique.set(repository.repositoryNodeId, repository)
    }
  }
  return [...unique.values()]
}

function uniqueMembershipRepositories(
  repositories: readonly EnqueueMembershipMutationRepository[]
): readonly EnqueueMembershipMutationRepository[] {
  const unique = new Map<RepositoryNodeId, EnqueueMembershipMutationRepository>()
  for (const repository of repositories) {
    if (!unique.has(repository.repositoryNodeId)) {
      unique.set(repository.repositoryNodeId, repository)
    }
  }
  return [...unique.values()]
}

function validateMembershipPlan(
  plan: MembershipIntentPlan,
  catalog: CanonicalListCatalogFingerprint
): void {
  const replanned = planMembershipIntent(plan.before.listNodeIds, plan.intent)
  if (
    !replanned.ok ||
    canonicalMembershipSet(plan.before.listNodeIds).fingerprint !== plan.before.fingerprint ||
    canonicalMembershipSet(plan.desired.listNodeIds).fingerprint !== plan.desired.fingerprint ||
    replanned.value.desired.fingerprint !== plan.desired.fingerprint
  ) {
    throw new Error('Membership plan sets must be canonical.')
  }
  const referenced = referencedListNodeIds(plan.intent)
  if (
    JSON.stringify(catalog.entries.map((entry) => entry.listNodeId)) !==
      JSON.stringify(referenced) ||
    catalog.fingerprint !==
      JSON.stringify(
        catalog.entries.map((entry) => [
          entry.listNodeId,
          entry.exists,
          entry.name,
          entry.visibility
        ])
      )
  ) {
    throw new Error('Membership plan catalog must cover the canonical referenced Lists.')
  }
}

async function replaceRepositoryMemberships(
  store: IDBObjectStore,
  githubUserId: GitHubUserId,
  repositoryNodeId: RepositoryNodeId,
  listNodeIds: readonly string[],
  observedAt: IsoDateTime
): Promise<void> {
  const keys = await requestResult(
    store.index(libraryIndexes.byRepository).getAllKeys([
      githubUserId,
      repositoryNodeId
    ])
  )
  for (const key of keys) await requestResult(store.delete(key))
  for (const listNodeId of listNodeIds) {
    await requestResult(
      store.put({
        githubUserId,
        listNodeId,
        repositoryNodeId,
        lastObservedAt: observedAt
      } satisfies NativeMembershipRecord)
    )
  }
}

function compareJobs(left: MutationJobRecord, right: MutationJobRecord): number {
  return left.createdAt.localeCompare(right.createdAt) || left.jobId.localeCompare(right.jobId)
}

function compareEligibleJobs(
  left: MutationJobRecord,
  right: MutationJobRecord
): number {
  return (
    (left.nextEligibleExecutionAt ?? '').localeCompare(
      right.nextEligibleExecutionAt ?? ''
    ) || compareJobs(left, right)
  )
}

function assertTransition(
  currentStatus: MutationJobStatus,
  nextStatus: MutationJobStatus
): void {
  if (!allowedTransitions[currentStatus].has(nextStatus)) {
    throw new Error(
      `Invalid mutation status transition from ${currentStatus} to ${nextStatus}.`
    )
  }
}

function assertTerminalRetryEligibility(
  status: Exclude<MutationTerminalStatus, 'cancelled'>,
  retryEligibility: MutationRetryEligibility
): void {
  if (
    (status === 'succeeded' || status === 'succeeded-external') &&
    retryEligibility !== 'not-retryable'
  ) {
    throw new Error('Successful mutation jobs cannot be retryable.')
  }
  if (status === 'blocked-unknown' && retryEligibility === 'automatic') {
    throw new Error('Blocked-unknown mutation jobs cannot retry automatically.')
  }
}

function applyTransition(
  job: MutationJobRecord,
  nextStatus: MutationJobStatus,
  occurredAt: IsoDateTime,
  updates: MutationJobTransitionUpdates
): MutationJobRecord {
  const error =
    updates.error === undefined ? job.lastError : copySanitizedError(updates.error)
  return {
    ...job,
    status: nextStatus,
    recoveryStatus: updates.recoveryStatus ?? job.recoveryStatus,
    retryEligibility: updates.retryEligibility ?? job.retryEligibility,
    nextEligibleExecutionAt:
      updates.nextEligibleExecutionAt === undefined
        ? job.nextEligibleExecutionAt
        : updates.nextEligibleExecutionAt,
    lastError: error,
    membershipDetails: updates.membershipDetails ?? job.membershipDetails,
    updatedAt: occurredAt
  }
}

function copySanitizedError(
  error: SanitizedMutationError | null
): SanitizedMutationError | null {
  if (!error) return null
  return {
    category: error.category,
    message: error.message,
    statusCode: error.statusCode,
    occurredAt: error.occurredAt
  }
}

function createHistoryRecord(
  job: MutationJobRecord,
  finalStatus: MutationTerminalStatus,
  origin: MutationOrigin,
  historyId: OperationHistoryId,
  verificationResult: MutationVerificationResult,
  occurredAt: IsoDateTime
): OperationHistoryRecord {
  return {
    githubUserId: job.githubUserId,
    historyId,
    jobId: job.jobId,
    batchId: job.batchId,
    mutationKind: job.mutationKind,
    origin,
    repositoryNodeId: job.repositoryNodeId,
    ownerLogin: job.ownerLogin,
    repositoryName: job.repositoryName,
    finalStatus,
    verificationResult,
    attemptCount: job.attemptCount,
    error: job.lastError,
    retryEligibility: job.retryEligibility,
    membershipDetails: job.membershipDetails,
    occurredAt
  }
}

async function updateReferencingBatchSummaries(
  transaction: IDBTransaction,
  githubUserId: GitHubUserId,
  jobId: MutationJobId,
  updatedAt: IsoDateTime
): Promise<void> {
  const batchStore = transaction.objectStore(libraryStores.mutationBatches)
  const jobStore = transaction.objectStore(libraryStores.mutationJobs)
  const batches = await requestResult(
    batchStore.index(libraryIndexes.byAccount).getAll(githubUserId) as IDBRequest<
      MutationBatchRecord[]
    >
  )
  const referenced = batches.filter((batch) => batch.jobIds.includes(jobId))

  for (const batch of referenced) {
    const jobs = await Promise.all(
      batch.jobIds.map((batchJobId) =>
        requestResult(
          jobStore.get([githubUserId, batchJobId]) as IDBRequest<
            MutationJobRecord | undefined
          >
        )
      )
    )
    if (jobs.some((job) => !job)) {
      throw new Error('A mutation batch references a missing job.')
    }
    const completeJobs = jobs.filter(
      (job): job is MutationJobRecord => job !== undefined
    )
    const summary = deriveMutationBatchSummary(completeJobs)
    await requestResult(
      batchStore.put({
        ...batch,
        summary,
        status: deriveMutationBatchStatus(summary),
        updatedAt
      } satisfies MutationBatchRecord)
    )
  }
}

async function requireJob(
  store: IDBObjectStore,
  githubUserId: GitHubUserId,
  jobId: MutationJobId
): Promise<MutationJobRecord> {
  const job = await requestResult(
    store.get([githubUserId, jobId]) as IDBRequest<MutationJobRecord | undefined>
  )
  if (!job) throw new Error('The mutation job does not exist for this account.')
  return job
}

async function requireBatch(
  store: IDBObjectStore,
  githubUserId: GitHubUserId,
  batchId: MutationBatchId
): Promise<MutationBatchRecord> {
  const batch = await requestResult(
    store.get([githubUserId, batchId]) as IDBRequest<MutationBatchRecord | undefined>
  )
  if (!batch) throw new Error('The mutation batch does not exist for this account.')
  return batch
}

async function getMutationRecord<T>(
  database: IDBDatabase,
  storeName: typeof libraryStores.mutationBatches | typeof libraryStores.mutationJobs,
  key: IDBValidKey
): Promise<T | null> {
  return runLibraryTransaction(database, storeName, 'readonly', async (transaction) => {
    const record = await requestResult(
      transaction.objectStore(storeName).get(key) as IDBRequest<T | undefined>
    )
    return record ?? null
  })
}

async function listMutationRecords<T>(
  database: IDBDatabase,
  storeName:
    | typeof libraryStores.mutationBatches
    | typeof libraryStores.mutationJobs
    | typeof libraryStores.mutationAttempts
    | typeof libraryStores.operationHistory,
  githubUserId: GitHubUserId
): Promise<readonly T[]> {
  return runLibraryTransaction(database, storeName, 'readonly', (transaction) =>
    requestResult(
      transaction
        .objectStore(storeName)
        .index(libraryIndexes.byAccount)
        .getAll(githubUserId) as IDBRequest<T[]>
    )
  )
}
