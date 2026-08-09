import type {AuthStore} from '../auth/store'
import type {
  BlockedUnknownOutcome,
  RemoteFailureOutcome,
  SafeUnstarService,
  SafeUnstarTarget
} from '../github/safe-unstar-service'
import type {
  IsoDateTime,
  MutationAttemptOutcome,
  MutationErrorCategory,
  MutationJobRecord,
  MutationRetryEligibility,
  MutationTerminalStatus,
  MutationVerificationResult,
  SanitizedMutationError
} from '../domain/types'
import {
  claimNextMutationWork,
  finalizeMutationJob,
  getNextMutationExecutionAt,
  prepareMutationJobsForActiveAccount,
  recordMutationAttempt,
  setMutationJobRecoveryStatus,
  transitionMutationJob,
  type ClaimedMutationWork
} from '../storage/mutations'
import {
  MembershipMutationExecutor,
  type MembershipMutationServices
} from './membership-runner'

const defaultMaximumAutomaticAttempts = 3
const defaultRetryDelayMs = 30_000

type UnstarQueueService = Pick<
  SafeUnstarService,
  'prepare' | 'delete' | 'observeStableState'
>

export interface MutationQueueRunnerOptions {
  readonly database: IDBDatabase
  readonly authStore: Pick<AuthStore, 'loadActive'>
  readonly service: UnstarQueueService
  readonly membershipService?: Omit<MembershipMutationServices, 'repositoryGuard'>
  readonly scheduleWake: (nextExecutionAt: IsoDateTime | null) => Promise<void>
  readonly now?: () => number
  readonly createId?: (kind: 'attempt' | 'history') => string
  readonly maximumAutomaticAttempts?: number
  readonly retryDelayMs?: number
}

export class MutationQueueRunner {
  readonly #database: IDBDatabase
  readonly #authStore: Pick<AuthStore, 'loadActive'>
  readonly #service: UnstarQueueService
  readonly #membershipExecutor: MembershipMutationExecutor | null
  readonly #scheduleWake: (nextExecutionAt: IsoDateTime | null) => Promise<void>
  readonly #now: () => number
  readonly #createId: (kind: 'attempt' | 'history') => string
  readonly #maximumAutomaticAttempts: number
  readonly #retryDelayMs: number
  #activeRun: Promise<void> | null = null
  #paused = false

  constructor(options: MutationQueueRunnerOptions) {
    this.#database = options.database
    this.#authStore = options.authStore
    this.#service = options.service
    this.#scheduleWake = options.scheduleWake
    this.#now = options.now ?? Date.now
    this.#createId = options.createId ?? defaultId
    this.#maximumAutomaticAttempts =
      options.maximumAutomaticAttempts ?? defaultMaximumAutomaticAttempts
    this.#retryDelayMs = options.retryDelayMs ?? defaultRetryDelayMs
    if (
      !Number.isSafeInteger(this.#maximumAutomaticAttempts) ||
      this.#maximumAutomaticAttempts < 1
    ) {
      throw new TypeError('The mutation retry limit must be a positive integer.')
    }
    if (!Number.isFinite(this.#retryDelayMs) || this.#retryDelayMs < 1) {
      throw new TypeError('The mutation retry delay must be positive.')
    }
    this.#membershipExecutor = options.membershipService
      ? new MembershipMutationExecutor({
          database: this.#database,
          authStore: this.#authStore,
          services: {
            ...options.membershipService,
            repositoryGuard: this.#service
          },
          now: this.#now,
          createId: this.#createId,
          maximumAutomaticAttempts: this.#maximumAutomaticAttempts,
          retryDelayMs: this.#retryDelayMs,
          paused: () => this.#paused
        })
      : null
  }

  check(): Promise<void> {
    if (this.#paused) return Promise.resolve()
    if (this.#activeRun) return this.#activeRun
    const run = this.#drain().finally(() => {
      if (this.#activeRun === run) this.#activeRun = null
    })
    this.#activeRun = run
    return run
  }

  async pause(): Promise<void> {
    this.#paused = true
    await this.#activeRun
  }

  resume(): void {
    this.#paused = false
  }

  async #drain(): Promise<void> {
    while (true) {
      if (this.#paused) return
      const active = await this.#authStore.loadActive()
      if (this.#paused) return
      const now = this.#timestamp()
      await prepareMutationJobsForActiveAccount(
        this.#database,
        active?.githubUserId ?? null,
        now
      )
      if (!active) {
        await this.#scheduleWake(null)
        return
      }

      const work = await claimNextMutationWork(
        this.#database,
        active.githubUserId,
        now
      )
      if (!work) {
        await this.#scheduleWake(
          await getNextMutationExecutionAt(
            this.#database,
            active.githubUserId,
            now
          )
        )
        return
      }
      await this.#process(work)
    }
  }

  async #process(work: ClaimedMutationWork): Promise<void> {
    if (work.job.mutationKind === 'native-list-membership') {
      if (!this.#membershipExecutor) {
        throw new Error('Native List membership mutation service is unavailable.')
      }
      await this.#membershipExecutor.process(work)
      return
    }
    const startedAt = this.#timestamp()
    if (!(await this.#ownerStillActive(work.job))) return
    if (work.recovery) {
      await this.#recover(work, startedAt)
      return
    }

    const preparation = await this.#service.prepare(targetFor(work.job))
    if (!(await this.#ownerStillActive(work.job))) return
    if (preparation.kind === 'ready-to-delete') {
      await this.#deleteAndObserve(work.job, startedAt)
    } else if (preparation.kind === 'confirmed-already-absent') {
      await this.#finish(
        work.job,
        startedAt,
        'succeeded-external',
        'already-absent'
      )
    } else {
      await this.#handleOutcome(work.job, preparation, startedAt)
    }
  }

  async #recover(work: ClaimedMutationWork, startedAt: IsoDateTime): Promise<void> {
    const observation = await this.#service.observeStableState(targetFor(work.job))
    if (!(await this.#ownerStillActive(work.job))) return
    if (observation.kind === 'confirmed-absent') {
      const external = work.interruptedStatus === 'checking'
      await this.#finish(
        work.job,
        startedAt,
        external ? 'succeeded-external' : 'succeeded',
        external ? 'already-absent' : 'verified-absent'
      )
      return
    }
    if (observation.kind === 'confirmed-present') {
      const normalized = await this.#normalizeRecoveredJob(work.job)
      await this.#deleteAndObserve(normalized, startedAt)
      return
    }
    await this.#handleOutcome(work.job, observation, startedAt)
  }

  async #normalizeRecoveredJob(
    job: MutationJobRecord
  ): Promise<MutationJobRecord> {
    if (job.status !== 'verifying') return job
    const now = this.#timestamp()
    await transitionMutationJob(
      this.#database,
      job.githubUserId,
      job.jobId,
      'retry-waiting',
      now,
      {nextEligibleExecutionAt: now, recoveryStatus: 'none'}
    )
    return transitionMutationJob(
      this.#database,
      job.githubUserId,
      job.jobId,
      'checking',
      now,
      {nextEligibleExecutionAt: null, recoveryStatus: 'none'}
    )
  }

  async #deleteAndObserve(
    job: MutationJobRecord,
    startedAt: IsoDateTime
  ): Promise<void> {
    if (!(await this.#ownerStillActive(job))) return
    if (job.status !== 'deleting') {
      await transitionMutationJob(
        this.#database,
        job.githubUserId,
        job.jobId,
        'deleting',
        this.#timestamp()
      )
    }

    const deletion = await this.#service.delete(targetFor(job))
    if (!(await this.#ownerStillActive(job))) return
    if (
      deletion.kind !== 'delete-accepted' &&
      deletion.kind !== 'delete-observation-required'
    ) {
      await this.#handleOutcome(job, deletion, startedAt)
      return
    }

    await transitionMutationJob(
      this.#database,
      job.githubUserId,
      job.jobId,
      'verifying',
      this.#timestamp()
    )
    if (!(await this.#ownerStillActive(job))) return
    const observation = await this.#service.observeStableState(targetFor(job))
    if (!(await this.#ownerStillActive(job))) return
    if (observation.kind === 'confirmed-absent') {
      await this.#finish(job, startedAt, 'succeeded', 'verified-absent')
    } else if (observation.kind === 'confirmed-present') {
      await this.#finishBlocked(job, startedAt, {
        kind: 'blocked-unknown',
        reason: 'unstable',
        statusCode: null
      })
    } else {
      await this.#handleOutcome(job, observation, startedAt)
    }
  }

  async #handleOutcome(
    job: MutationJobRecord,
    outcome: BlockedUnknownOutcome | RemoteFailureOutcome,
    startedAt: IsoDateTime
  ): Promise<void> {
    if (outcome.kind === 'blocked-unknown') {
      await this.#finishBlocked(job, startedAt, outcome)
      return
    }
    await this.#handleRemoteFailure(job, startedAt, outcome)
  }

  async #handleRemoteFailure(
    job: MutationJobRecord,
    startedAt: IsoDateTime,
    outcome: RemoteFailureOutcome
  ): Promise<void> {
    const occurredAt = this.#timestamp()
    const error = remoteError(outcome, occurredAt)
    if (outcome.kind === 'rate-limit') {
      const nextExecutionAt = validFutureTime(outcome.retryAt, this.#now())
        ? outcome.retryAt
        : new Date(this.#now() + this.#retryDelayMs).toISOString()
      await this.#recordAttempt(
        job,
        startedAt,
        occurredAt,
        'retry-scheduled',
        error,
        'automatic',
        nextExecutionAt
      )
      await transitionMutationJob(
        this.#database,
        job.githubUserId,
        job.jobId,
        'retry-waiting',
        occurredAt,
        {
          error,
          retryEligibility: 'automatic',
          nextEligibleExecutionAt: nextExecutionAt,
          recoveryStatus: 'owner-recovery-pending'
        }
      )
      return
    }

    if (outcome.kind === 'network' || outcome.kind === 'server') {
      const attemptNumber = job.attemptCount + 1
      if (attemptNumber < this.#maximumAutomaticAttempts) {
        const delay = this.#retryDelayMs * 2 ** (attemptNumber - 1)
        const nextExecutionAt = new Date(this.#now() + delay).toISOString()
        await this.#recordAttempt(
          job,
          startedAt,
          occurredAt,
          'retry-scheduled',
          error,
          'automatic',
          nextExecutionAt
        )
        await transitionMutationJob(
          this.#database,
          job.githubUserId,
          job.jobId,
          'retry-waiting',
          occurredAt,
          {
            error,
            retryEligibility: 'automatic',
            nextEligibleExecutionAt: nextExecutionAt,
            recoveryStatus: 'owner-recovery-pending'
          }
        )
        return
      }
    }

    const retryEligibility: MutationRetryEligibility =
      outcome.kind === 'authentication' || outcome.kind === 'permission'
        ? 'after-reauthentication'
        : 'not-retryable'
    await this.#recordAttempt(
      job,
      startedAt,
      occurredAt,
      'terminal',
      error,
      retryEligibility,
      null
    )
    await this.#finalize(
      job,
      'failed',
      'not-verified',
      occurredAt,
      error,
      retryEligibility
    )
  }

  async #finishBlocked(
    job: MutationJobRecord,
    startedAt: IsoDateTime,
    outcome: BlockedUnknownOutcome
  ): Promise<void> {
    const occurredAt = this.#timestamp()
    const error = blockedError(outcome, occurredAt)
    await this.#recordAttempt(
      job,
      startedAt,
      occurredAt,
      'terminal',
      error,
      'after-refresh',
      null
    )
    await this.#finalize(
      job,
      'blocked-unknown',
      'not-verified',
      occurredAt,
      error,
      'after-refresh'
    )
  }

  async #finish(
    job: MutationJobRecord,
    startedAt: IsoDateTime,
    finalStatus: Extract<MutationTerminalStatus, 'succeeded' | 'succeeded-external'>,
    verificationResult: MutationVerificationResult
  ): Promise<void> {
    const occurredAt = this.#timestamp()
    await this.#recordAttempt(
      job,
      startedAt,
      occurredAt,
      'terminal',
      null,
      'not-retryable',
      null
    )
    await this.#finalize(
      job,
      finalStatus,
      verificationResult,
      occurredAt,
      null,
      'not-retryable'
    )
  }

  #recordAttempt(
    job: MutationJobRecord,
    startedAt: IsoDateTime,
    completedAt: IsoDateTime,
    outcome: MutationAttemptOutcome,
    error: SanitizedMutationError | null,
    retryEligibility: MutationRetryEligibility,
    nextEligibleExecutionAt: IsoDateTime | null
  ): Promise<unknown> {
    return recordMutationAttempt(this.#database, {
      githubUserId: job.githubUserId,
      jobId: job.jobId,
      attemptId: this.#createId('attempt'),
      outcome,
      startedAt,
      completedAt,
      error,
      retryEligibility,
      nextEligibleExecutionAt
    })
  }

  #finalize(
    job: MutationJobRecord,
    finalStatus: Exclude<MutationTerminalStatus, 'cancelled'>,
    verificationResult: MutationVerificationResult,
    occurredAt: IsoDateTime,
    error: SanitizedMutationError | null,
    retryEligibility: MutationRetryEligibility
  ): Promise<unknown> {
    return finalizeMutationJob(this.#database, {
      githubUserId: job.githubUserId,
      jobId: job.jobId,
      historyId: this.#createId('history'),
      finalStatus,
      verificationResult,
      occurredAt,
      error,
      retryEligibility
    })
  }

  async #ownerStillActive(job: MutationJobRecord): Promise<boolean> {
    if (this.#paused) return false
    const active = await this.#authStore.loadActive()
    if (this.#paused) return false
    if (
      active?.githubUserId === job.githubUserId &&
      active.identity.githubUserId === job.githubUserId
    ) {
      return true
    }
    await setMutationJobRecoveryStatus(
      this.#database,
      job.githubUserId,
      job.jobId,
      'account-suspended',
      this.#timestamp()
    )
    return false
  }

  #timestamp(): IsoDateTime {
    return new Date(this.#now()).toISOString()
  }
}

function targetFor(job: MutationJobRecord): SafeUnstarTarget {
  return {
    expectedGitHubUserId: job.githubUserId,
    repositoryNodeId: job.repositoryNodeId,
    owner: job.ownerLogin,
    repositoryName: job.repositoryName
  }
}

function remoteError(
  outcome: RemoteFailureOutcome,
  occurredAt: IsoDateTime
): SanitizedMutationError {
  const category: MutationErrorCategory =
    outcome.kind === 'server' ? 'github-server' : outcome.kind
  const messages: Readonly<Record<RemoteFailureOutcome['kind'], string>> = {
    authentication: 'GitHub authentication must be renewed.',
    permission: 'GitHub denied Starring write permission.',
    'rate-limit': 'GitHub Starring is paused until the rate limit resets.',
    server: 'GitHub returned a temporary server error.',
    network: 'GitHub could not be reached.'
  }
  return {
    category,
    message: messages[outcome.kind],
    statusCode: outcome.statusCode,
    occurredAt
  }
}

function blockedError(
  outcome: BlockedUnknownOutcome,
  occurredAt: IsoDateTime
): SanitizedMutationError {
  return {
    category: outcome.reason === 'malformed' ? 'validation' : 'verification-mismatch',
    message: 'Repository identity and star state could not be verified.',
    statusCode: outcome.statusCode,
    occurredAt
  }
}

function validFutureTime(value: string | null, now: number): value is string {
  return value !== null && Number.isFinite(Date.parse(value)) && Date.parse(value) > now
}

function defaultId(kind: 'attempt' | 'history'): string {
  return `${kind}-${crypto.randomUUID()}`
}
