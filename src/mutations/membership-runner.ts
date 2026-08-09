import type {AuthStore} from '../auth/store'
import {
  canonicalMembershipSet,
  type CanonicalMembershipSet
} from '../domain/native-list-membership'
import type {
  IsoDateTime,
  MembershipMutationDetails,
  MutationAttemptOutcome,
  MutationJobRecord,
  MutationRetryEligibility,
  MutationTerminalStatus,
  MutationVerificationResult,
  SanitizedMutationError
} from '../domain/types'
import type {
  BlockedUnknownOutcome,
  RemoteFailureOutcome,
  SafeUnstarService,
  SafeUnstarTarget
} from '../github/safe-unstar-service'
import {
  ListMembershipMutationFailure,
  type ListMembershipWriteSession
} from '../github/list-membership-write-session'
import {sanitizeError, type AppError} from '../shared/errors'
import type {
  MembershipObservationOutcome,
  NativeListMembershipObservationService,
  ObservedRepositoryMembership
} from '../sync/native-list-membership-observation'
import {
  finalizeMutationJob,
  recordMutationAttempt,
  setMutationJobRecoveryStatus,
  transitionMutationJob,
  type ClaimedMutationWork
} from '../storage/mutations'

type MembershipObserver = Pick<
  NativeListMembershipObservationService,
  'observeSelected'
>
type MembershipWriter = Pick<ListMembershipWriteSession, 'updateMemberships'>
type RepositoryGuard = Pick<SafeUnstarService, 'prepare'>
type RecoveryPhase = NonNullable<MembershipMutationDetails['recoveryPhase']>

export interface MembershipMutationServices {
  readonly observer: MembershipObserver
  readonly writer: MembershipWriter
  readonly repositoryGuard: RepositoryGuard
}

export interface MembershipMutationExecutorOptions {
  readonly database: IDBDatabase
  readonly authStore: Pick<AuthStore, 'loadActive'>
  readonly services: MembershipMutationServices
  readonly now: () => number
  readonly createId: (kind: 'attempt' | 'history') => string
  readonly maximumAutomaticAttempts: number
  readonly retryDelayMs: number
  readonly paused: () => boolean
}

export class MembershipMutationExecutor {
  readonly #database: IDBDatabase
  readonly #authStore: Pick<AuthStore, 'loadActive'>
  readonly #services: MembershipMutationServices
  readonly #now: () => number
  readonly #createId: (kind: 'attempt' | 'history') => string
  readonly #maximumAutomaticAttempts: number
  readonly #retryDelayMs: number
  readonly #paused: () => boolean

  constructor(options: MembershipMutationExecutorOptions) {
    this.#database = options.database
    this.#authStore = options.authStore
    this.#services = options.services
    this.#now = options.now
    this.#createId = options.createId
    this.#maximumAutomaticAttempts = options.maximumAutomaticAttempts
    this.#retryDelayMs = options.retryDelayMs
    this.#paused = options.paused
  }

  async process(work: ClaimedMutationWork): Promise<void> {
    const details = work.job.membershipDetails
    if (!details) throw new Error('Membership queue work is missing its durable details.')
    const startedAt = this.#timestamp()
    if (!(await this.#ownerStillActive(work.job))) return

    const recoveryPhase = work.recovery
      ? details.recoveryPhase ?? recoveryPhaseFor(work.interruptedStatus)
      : null
    if (work.job.status !== 'observing-membership') {
      await transitionMutationJob(
        this.#database,
        work.job.githubUserId,
        work.job.jobId,
        'observing-membership',
        this.#timestamp(),
        {membershipDetails: details}
      )
    }
    await this.#observeBeforeWrite(work.job, details, startedAt, recoveryPhase)
  }

  async #observeBeforeWrite(
    job: MutationJobRecord,
    details: MembershipMutationDetails,
    startedAt: IsoDateTime,
    recoveryPhase: RecoveryPhase | null
  ): Promise<void> {
    const outcome = await this.#observe(job, details)
    if (!(await this.#ownerStillActive(job))) return
    if (outcome.status !== 'stable') {
      await this.#handleUnstable(job, details, startedAt, outcome, recoveryPhase)
      return
    }

    const observed = repositoryObservation(outcome, job)
    if (!observed) {
      await this.#finishUnstable(job, details, startedAt, 'partial', outcome.attempts)
      return
    }
    const latest = withObserved(details, observed)

    if (recoveryPhase === 'mutation' || recoveryPhase === 'verification') {
      if (setsEqual(observed.observed, details.desired)) {
        await this.#finish(
          job,
          startedAt,
          'succeeded',
          'verified-membership',
          {...latest, recoveryPhase: null},
          null,
          'not-retryable',
          true
        )
        return
      }
      if (!setsEqual(observed.observed, details.confirmedBefore)) {
        await this.#finishConflict(job, latest, startedAt)
        return
      }
      if (job.attemptCount >= this.#maximumAutomaticAttempts) {
        await this.#finishFailure(
          job,
          latest,
          startedAt,
          mutationError('network', 'GitHub native List mutation could not be verified.', this.#timestamp()),
          'after-refresh'
        )
        return
      }
    }

    if (
      !setsEqual(observed.observed, details.confirmedBefore) ||
      observed.relevantCatalog.fingerprint !== details.confirmedCatalog.fingerprint
    ) {
      const stale: MembershipMutationDetails = {
        ...latest,
        recoveryPhase: null,
        needsConfirmation: {
          confirmedBefore: details.confirmedBefore,
          observed: observed.observed,
          confirmedCatalog: details.confirmedCatalog,
          observedCatalog: observed.relevantCatalog
        }
      }
      await this.#finish(
        job,
        startedAt,
        'needs-confirmation',
        'not-verified',
        stale,
        mutationError(
          'verification-mismatch',
          'GitHub native List membership changed after confirmation.',
          this.#timestamp()
        ),
        'after-refresh',
        false
      )
      return
    }

    const guard = await this.#services.repositoryGuard.prepare(targetFor(job))
    if (!(await this.#ownerStillActive(job))) return
    if (guard.kind !== 'ready-to-delete') {
      await this.#handleGuardOutcome(job, latest, startedAt, guard)
      return
    }
    await this.#mutate(job, {...latest, recoveryPhase: null}, startedAt)
  }

  async #mutate(
    job: MutationJobRecord,
    details: MembershipMutationDetails,
    startedAt: IsoDateTime
  ): Promise<void> {
    const mutating = {...details, recoveryPhase: 'mutation' as const}
    await transitionMutationJob(
      this.#database,
      job.githubUserId,
      job.jobId,
      'mutating-membership',
      this.#timestamp(),
      {membershipDetails: mutating}
    )
    if (!(await this.#ownerStillActive(job))) return

    let payload: CanonicalMembershipSet
    try {
      const result = await this.#services.writer.updateMemberships({
        expectedGitHubUserId: job.githubUserId,
        repositoryNodeId: job.repositoryNodeId,
        completeListIds: details.desired.listNodeIds
      })
      payload = canonicalMembershipSet(result.updatedListIds)
    } catch (error: unknown) {
      if (!(await this.#ownerStillActive(job))) return
      await this.#handleMutationFailure(job, mutating, startedAt, error)
      return
    }
    if (!(await this.#ownerStillActive(job))) return

    const verifying: MembershipMutationDetails = {
      ...details,
      mutationPayload: payload,
      recoveryPhase: 'verification'
    }
    await transitionMutationJob(
      this.#database,
      job.githubUserId,
      job.jobId,
      'verifying-membership',
      this.#timestamp(),
      {membershipDetails: verifying}
    )
    if (!(await this.#ownerStillActive(job))) return

    const outcome = await this.#observe(job, verifying)
    if (!(await this.#ownerStillActive(job))) return
    if (outcome.status !== 'stable') {
      await this.#handleUnstable(job, verifying, startedAt, outcome, 'verification')
      return
    }
    const observed = repositoryObservation(outcome, job)
    if (!observed) {
      await this.#finishUnstable(job, verifying, startedAt, 'partial', outcome.attempts)
      return
    }
    const readBack = {...withObserved(verifying, observed), recoveryPhase: null}
    if (setsEqual(observed.observed, details.desired)) {
      await this.#finish(
        job,
        startedAt,
        'succeeded',
        'verified-membership',
        readBack,
        null,
        'not-retryable',
        true
      )
      return
    }
    await this.#finishConflict(job, readBack, startedAt)
  }

  async #observe(
    job: MutationJobRecord,
    details: MembershipMutationDetails
  ): Promise<MembershipObservationOutcome> {
    return this.#services.observer.observeSelected(job.githubUserId, [
      {
        repositoryNodeId: job.repositoryNodeId,
        relevantListNodeIds: details.confirmedCatalog.entries.map(
          (entry) => entry.listNodeId
        )
      }
    ])
  }

  async #handleUnstable(
    job: MutationJobRecord,
    details: MembershipMutationDetails,
    startedAt: IsoDateTime,
    outcome: Exclude<MembershipObservationOutcome, {readonly status: 'stable'}>,
    recoveryPhase: RecoveryPhase | null
  ): Promise<void> {
    const occurredAt = this.#timestamp()
    const unstable: MembershipMutationDetails = {
      ...details,
      recoveryPhase: recoveryPhase ?? 'observation',
      unstableObservation: {
        status: outcome.status,
        attempts: outcome.attempts,
        rateLimitResetAt: outcome.status === 'rate-limited' ? outcome.rateLimit.resetAt : null,
        occurredAt
      }
    }
    const error = mutationError(
      outcome.status === 'rate-limited' ? 'rate-limit' : 'verification-mismatch',
      outcome.status === 'rate-limited'
        ? 'GitHub native List observation is paused until the rate limit resets.'
        : 'GitHub native List membership did not stabilize.',
      occurredAt
    )
    if (job.attemptCount + 1 < this.#maximumAutomaticAttempts) {
      const resetAt =
        outcome.status === 'rate-limited' && validFutureTime(outcome.rateLimit.resetAt, this.#now())
          ? outcome.rateLimit.resetAt
          : new Date(this.#now() + this.#retryDelayMs).toISOString()
      await this.#scheduleRecovery(job, unstable, startedAt, error, resetAt)
      return
    }
    await this.#finish(
      job,
      startedAt,
      'unstable-observation',
      'not-verified',
      {...unstable, recoveryPhase: null},
      error,
      'after-refresh',
      false
    )
  }

  async #finishUnstable(
    job: MutationJobRecord,
    details: MembershipMutationDetails,
    startedAt: IsoDateTime,
    status: 'partial',
    attempts: number
  ): Promise<void> {
    const occurredAt = this.#timestamp()
    await this.#finish(
      job,
      startedAt,
      'unstable-observation',
      'not-verified',
      {
        ...details,
        recoveryPhase: null,
        unstableObservation: {
          status,
          attempts,
          rateLimitResetAt: null,
          occurredAt
        }
      },
      mutationError(
        'verification-mismatch',
        'GitHub native List observation was incomplete.',
        occurredAt
      ),
      'after-refresh',
      false
    )
  }

  async #finishConflict(
    job: MutationJobRecord,
    details: MembershipMutationDetails,
    startedAt: IsoDateTime
  ): Promise<void> {
    const observed = details.latestObserved
    if (!observed) throw new Error('A verification conflict requires an observed set.')
    const conflict: MembershipMutationDetails = {
      ...details,
      recoveryPhase: null,
      verificationConflict: {desired: details.desired, observed}
    }
    await this.#finish(
      job,
      startedAt,
      'verification-conflict',
      'membership-conflict',
      conflict,
      mutationError(
        'verification-mismatch',
        'GitHub native List membership differs from the confirmed desired set.',
        this.#timestamp()
      ),
      'after-refresh',
      true
    )
  }

  async #handleGuardOutcome(
    job: MutationJobRecord,
    details: MembershipMutationDetails,
    startedAt: IsoDateTime,
    outcome: Exclude<
      Awaited<ReturnType<RepositoryGuard['prepare']>>,
      {readonly kind: 'ready-to-delete'}
    >
  ): Promise<void> {
    if (outcome.kind === 'confirmed-already-absent') {
      await this.#finishFailure(
        job,
        details,
        startedAt,
        mutationError(
          'verification-mismatch',
          'Repository is no longer publicly accessible and starred.',
          this.#timestamp()
        ),
        'not-retryable'
      )
      return
    }
    if (outcome.kind === 'blocked-unknown') {
      await this.#finish(
        job,
        startedAt,
        'blocked-unknown',
        'not-verified',
        details,
        blockedError(outcome, this.#timestamp()),
        'after-refresh',
        false
      )
      return
    }

    const error = guardRemoteError(outcome, this.#timestamp())
    if (
      (outcome.kind === 'rate-limit' || outcome.kind === 'network' || outcome.kind === 'server') &&
      job.attemptCount + 1 < this.#maximumAutomaticAttempts
    ) {
      const nextExecutionAt = validFutureTime(outcome.retryAt, this.#now())
        ? outcome.retryAt
        : new Date(this.#now() + this.#retryDelayMs).toISOString()
      await this.#scheduleRecovery(
        job,
        {...details, recoveryPhase: 'observation'},
        startedAt,
        error,
        nextExecutionAt
      )
      return
    }
    await this.#finishFailure(
      job,
      details,
      startedAt,
      error,
      outcome.kind === 'authentication' || outcome.kind === 'permission'
        ? 'after-reauthentication'
        : 'not-retryable'
    )
  }

  async #handleMutationFailure(
    job: MutationJobRecord,
    details: MembershipMutationDetails,
    startedAt: IsoDateTime,
    failure: unknown
  ): Promise<void> {
    if (failure instanceof ListMembershipMutationFailure && failure.reason === 'account-changed') {
      await setMutationJobRecoveryStatus(
        this.#database,
        job.githubUserId,
        job.jobId,
        'account-suspended',
        this.#timestamp()
      )
      return
    }
    const safe = sanitizeError(failure)
    const error = appMutationError(safe, this.#timestamp())
    const ambiguous =
      failure instanceof ListMembershipMutationFailure &&
      (failure.reason === 'network-ambiguous' ||
        failure.reason === 'server' ||
        failure.reason === 'malformed-response')
    if (
      (ambiguous || safe.category === 'rate-limit') &&
      job.attemptCount < this.#maximumAutomaticAttempts
    ) {
      const retryAt = safe.retryAt ?? null
      const nextExecutionAt = validFutureTime(retryAt, this.#now())
        ? retryAt
        : new Date(this.#now() + this.#retryDelayMs).toISOString()
      await this.#scheduleRecovery(job, details, startedAt, error, nextExecutionAt)
      return
    }
    await this.#finishFailure(
      job,
      details,
      startedAt,
      error,
      safe.category === 'authentication' || safe.category === 'permission'
        ? 'after-reauthentication'
        : 'not-retryable'
    )
  }

  async #scheduleRecovery(
    job: MutationJobRecord,
    details: MembershipMutationDetails,
    startedAt: IsoDateTime,
    error: SanitizedMutationError,
    nextExecutionAt: IsoDateTime
  ): Promise<void> {
    const occurredAt = this.#timestamp()
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
        recoveryStatus: 'owner-recovery-pending',
        membershipDetails: details
      }
    )
  }

  #finishFailure(
    job: MutationJobRecord,
    details: MembershipMutationDetails,
    startedAt: IsoDateTime,
    error: SanitizedMutationError,
    retryEligibility: MutationRetryEligibility
  ): Promise<void> {
    return this.#finish(
      job,
      startedAt,
      'failed',
      'not-verified',
      {...details, recoveryPhase: null},
      error,
      retryEligibility,
      false
    )
  }

  async #finish(
    job: MutationJobRecord,
    startedAt: IsoDateTime,
    finalStatus: Exclude<MutationTerminalStatus, 'cancelled' | 'succeeded-external'>,
    verificationResult: MutationVerificationResult,
    details: MembershipMutationDetails,
    error: SanitizedMutationError | null,
    retryEligibility: MutationRetryEligibility,
    updateLocalMemberships: boolean
  ): Promise<void> {
    const occurredAt = this.#timestamp()
    await this.#recordAttempt(
      job,
      startedAt,
      occurredAt,
      'terminal',
      error,
      retryEligibility,
      null
    )
    await finalizeMutationJob(this.#database, {
      githubUserId: job.githubUserId,
      jobId: job.jobId,
      historyId: this.#createId('history'),
      finalStatus,
      verificationResult,
      occurredAt,
      error,
      retryEligibility,
      membershipDetails: details,
      updateLocalMemberships
    })
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

  async #ownerStillActive(job: MutationJobRecord): Promise<boolean> {
    if (this.#paused()) return false
    const active = await this.#authStore.loadActive()
    if (this.#paused()) return false
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

function recoveryPhaseFor(status: ClaimedMutationWork['interruptedStatus']): RecoveryPhase {
  if (status === 'mutating-membership') return 'mutation'
  if (status === 'verifying-membership') return 'verification'
  return 'observation'
}

function repositoryObservation(
  outcome: Extract<MembershipObservationOutcome, {readonly status: 'stable'}>,
  job: MutationJobRecord
): ObservedRepositoryMembership | null {
  return (
    outcome.repositories.find(
      (repository) => repository.repositoryNodeId === job.repositoryNodeId
    ) ?? null
  )
}

function withObserved(
  details: MembershipMutationDetails,
  observed: ObservedRepositoryMembership
): MembershipMutationDetails {
  return {
    ...details,
    latestObserved: observed.observed,
    latestObservedCatalog: observed.relevantCatalog,
    membershipFingerprint: observed.observed.fingerprint,
    listCatalogFingerprint: observed.relevantCatalog.fingerprint,
    unstableObservation: null
  }
}

function setsEqual(left: CanonicalMembershipSet, right: CanonicalMembershipSet): boolean {
  return left.fingerprint === right.fingerprint
}

function targetFor(job: MutationJobRecord): SafeUnstarTarget {
  return {
    expectedGitHubUserId: job.githubUserId,
    repositoryNodeId: job.repositoryNodeId,
    owner: job.ownerLogin,
    repositoryName: job.repositoryName
  }
}

function appMutationError(error: AppError, occurredAt: IsoDateTime): SanitizedMutationError {
  const category =
    error.category === 'unsupported'
      ? 'validation'
      : error.category === 'storage'
        ? 'unknown'
        : error.category
  return {
    category,
    message: error.message,
    statusCode: error.status ?? null,
    occurredAt
  }
}

function guardRemoteError(
  outcome: RemoteFailureOutcome,
  occurredAt: IsoDateTime
): SanitizedMutationError {
  return mutationError(
    outcome.kind === 'server' ? 'github-server' : outcome.kind,
    outcome.kind === 'authentication'
      ? 'GitHub authentication must be renewed.'
      : outcome.kind === 'permission'
        ? 'GitHub denied repository state verification.'
        : outcome.kind === 'rate-limit'
          ? 'GitHub repository verification is paused until the rate limit resets.'
          : outcome.kind === 'server'
            ? 'GitHub returned a temporary server error.'
            : 'GitHub could not be reached.',
    occurredAt,
    outcome.statusCode
  )
}

function blockedError(
  outcome: BlockedUnknownOutcome,
  occurredAt: IsoDateTime
): SanitizedMutationError {
  return mutationError(
    outcome.reason === 'malformed' ? 'validation' : 'verification-mismatch',
    'Repository public accessibility and star state could not be verified.',
    occurredAt,
    outcome.statusCode
  )
}

function mutationError(
  category: SanitizedMutationError['category'],
  message: string,
  occurredAt: IsoDateTime,
  statusCode: number | null = null
): SanitizedMutationError {
  return {category, message, statusCode, occurredAt}
}

function validFutureTime(value: string | null, now: number): value is string {
  return value !== null && Number.isFinite(Date.parse(value)) && Date.parse(value) > now
}
