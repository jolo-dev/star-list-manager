import {describe, expect, test} from 'bun:test'
import {IDBFactory} from 'fake-indexeddb'
import {
  canonicalMembershipSet,
  planMembershipIntent,
  relevantListCatalogFingerprint,
  type CanonicalListCatalogFingerprint
} from '../../src/domain/native-list-membership'
import type {
  AnnotationRecord,
  AuthStateRecord,
  GitHubUserId,
  RepositoryRecord
} from '../../src/domain/types'
import {
  ListMembershipMutationFailure,
  type ListMembershipMutationRequest,
  type ListMembershipMutationResult
} from '../../src/github/list-membership-write-session'
import type {
  SafeUnstarTarget,
  StableUnstarObservationOutcome,
  UnstarDeleteRequestOutcome,
  UnstarPreparationOutcome
} from '../../src/github/safe-unstar-service'
import {MutationQueueRunner} from '../../src/mutations/runner'
import type {
  CompleteMembershipObservation,
  MembershipObservationOutcome
} from '../../src/sync/native-list-membership-observation'
import {openLibraryDatabase} from '../../src/storage/database'
import {
  getAnnotation,
  getRepository,
  listMembershipsForRepository,
  putAnnotation,
  putNativeMembership,
  putRepository
} from '../../src/storage/library'
import {
  claimNextMutationWork,
  enqueueMembershipMutationBatch,
  enqueueMutationBatch,
  getMutationBatch,
  getMutationJob,
  listMutationAttempts,
  listOperationHistory,
  transitionMutationJob
} from '../../src/storage/mutations'

const accountA = 'account-a'
const accountB = 'account-b'
const repositoryNodeId = 'R_repo'
const initialTime = Date.parse('2026-08-08T12:00:00.000Z')

describe('native List membership queue runner', () => {
  test('submits the complete static set and independently verifies before local commit', async () => {
    const harness = await createHarness('membership-runner-success')
    const annotation = annotationRecord()
    await putAnnotation(harness.database, annotation)
    await putNativeMembership(harness.database, membership('L_existing'))
    await enqueueMembership(harness.database, ['L_existing'], ['L_added'])
    harness.membership.observations.push(
      stable(['L_existing']),
      stable(['L_added', 'L_existing'])
    )
    harness.membership.writeResults.push({updatedListIds: ['L_payload_mismatch']})

    await harness.runner.check()

    expect(harness.membership.writeRequests).toEqual([
      {
        expectedGitHubUserId: accountA,
        repositoryNodeId,
        completeListIds: ['L_added', 'L_existing']
      }
    ])
    expect(harness.membership.observationCalls).toBe(2)
    expect((await getMutationJob(harness.database, accountA, 'membership-job'))?.status).toBe(
      'succeeded'
    )
    expect(
      (await getMutationJob(harness.database, accountA, 'membership-job'))
        ?.membershipDetails?.mutationPayload?.listNodeIds
    ).toEqual(['L_payload_mismatch'])
    expect(
      (await listMembershipsForRepository(harness.database, accountA, repositoryNodeId))
        .map((item) => item.listNodeId)
        .sort()
    ).toEqual(['L_added', 'L_existing'])
    expect(await getAnnotation(harness.database, accountA, repositoryNodeId)).toEqual(annotation)
    expect((await getRepository(harness.database, accountA, repositoryNodeId))?.isStarred).toBe(
      true
    )
    expect((await listOperationHistory(harness.database, accountA))[0]).toMatchObject({
      finalStatus: 'succeeded',
      verificationResult: 'verified-membership'
    })
    harness.database.close()
  })

  test('requires confirmation when either membership or relevant catalog is stale', async () => {
    for (const [name, observation] of [
      ['membership', stable(['L_external'])],
      ['catalog', stable([], renamedCatalog())]
    ] as const) {
      const harness = await createHarness(`membership-runner-stale-${name}`)
      await enqueueMembership(harness.database, [], ['L_added'])
      harness.membership.observations.push(observation)

      await harness.runner.check()

      const job = await getMutationJob(harness.database, accountA, 'membership-job')
      expect(job?.status).toBe('needs-confirmation')
      expect(job?.membershipDetails?.needsConfirmation?.observed.listNodeIds).toEqual(
        observation.repositories[0]?.observed.listNodeIds
      )
      expect(harness.membership.writeRequests).toEqual([])
      expect(harness.unstar.prepareCalls).toBe(0)
      harness.database.close()
    }
  })

  test('detects every stale preview change from membership and catalog fingerprints', async () => {
    const cases: ReadonlyArray<{
      readonly name: string
      readonly before: readonly string[]
      readonly observation: Extract<MembershipObservationOutcome, {readonly status: 'stable'}>
    }> = [
      {name: 'external-add', before: [], observation: stable(['L_external'])},
      {name: 'external-remove', before: ['L_existing'], observation: stable([])},
      {name: 'list-deletion', before: [], observation: stable([], deletedCatalog())},
      {name: 'list-rename', before: [], observation: stable([], renamedCatalog())},
      {name: 'visibility-change', before: [], observation: stable([], privateCatalog())}
    ]

    for (const item of cases) {
      const harness = await createHarness(`membership-runner-stale-${item.name}`)
      await enqueueMembership(harness.database, item.before, ['L_added'])
      harness.membership.observations.push(item.observation)

      await harness.runner.check()

      const job = await getMutationJob(harness.database, accountA, 'membership-job')
      const stale = job?.membershipDetails?.needsConfirmation
      expect(job?.status, item.name).toBe('needs-confirmation')
      expect(stale?.confirmedBefore.fingerprint, item.name).toBe(
        canonicalMembershipSet(item.before).fingerprint
      )
      expect(stale?.observed.fingerprint, item.name).toBe(
        item.observation.repositories[0]?.observed.fingerprint
      )
      expect(stale?.confirmedCatalog.fingerprint, item.name).toBe(catalog().fingerprint)
      expect(stale?.observedCatalog.fingerprint, item.name).toBe(
        item.observation.repositories[0]?.relevantCatalog.fingerprint
      )
      expect(harness.membership.writeRequests, item.name).toEqual([])
      harness.database.close()
    }
  })

  test('bounds unstable observation retries and never writes from partial knowledge', async () => {
    const harness = await createHarness('membership-runner-unstable', {
      maximumAutomaticAttempts: 2
    })
    await enqueueMembership(harness.database, [], ['L_added'])
    harness.membership.observations.push(changing(), changing())

    await harness.runner.check()
    expect((await getMutationJob(harness.database, accountA, 'membership-job'))?.status).toBe(
      'retry-waiting'
    )
    harness.clock.value += 1_000
    await harness.runner.check()

    const job = await getMutationJob(harness.database, accountA, 'membership-job')
    expect(job?.status).toBe('unstable-observation')
    expect(job?.membershipDetails?.unstableObservation).toMatchObject({
      status: 'changing',
      attempts: 3
    })
    expect(await listMutationAttempts(harness.database, accountA)).toHaveLength(2)
    expect(harness.membership.writeRequests).toEqual([])
    harness.database.close()
  })

  test('recovers an ambiguous mutation by observation before considering another write', async () => {
    const harness = await createHarness('membership-runner-network-ambiguous')
    await enqueueMembership(harness.database, [], ['L_added'])
    harness.membership.observations.push(stable([]), stable(['L_added']))
    harness.membership.writeResults.push(
      new ListMembershipMutationFailure('network-ambiguous', {
        category: 'network',
        message: 'authorization=ghp_secret may have been sent',
        retryable: true
      })
    )

    await harness.runner.check()
    expect((await getMutationJob(harness.database, accountA, 'membership-job'))?.status).toBe(
      'retry-waiting'
    )
    harness.clock.value += 1_000
    await harness.runner.check()

    expect(harness.membership.writeRequests).toHaveLength(1)
    expect(harness.membership.observationCalls).toBe(2)
    expect((await getMutationJob(harness.database, accountA, 'membership-job'))?.status).toBe(
      'succeeded'
    )
    expect(JSON.stringify(await listOperationHistory(harness.database, accountA))).not.toContain(
      'ghp_secret'
    )
    harness.database.close()
  })

  test('suspends after mutation on account switch and recovers only when the owner returns', async () => {
    const harness = await createHarness('membership-runner-account-switch')
    await enqueueMembership(harness.database, [], ['L_added'])
    harness.membership.observations.push(stable([]), stable(['L_added']))
    harness.membership.afterWrite = () => harness.auth.setActive(accountB)

    await harness.runner.check()
    expect(await getMutationJob(harness.database, accountA, 'membership-job')).toMatchObject({
      status: 'mutating-membership',
      recoveryStatus: 'account-suspended'
    })
    expect(harness.membership.observationCalls).toBe(1)

    await harness.runner.check()
    expect(harness.membership.observationCalls).toBe(1)
    harness.auth.setActive(accountA)
    await harness.runner.check()

    expect(harness.membership.writeRequests).toHaveLength(1)
    expect(harness.membership.observationCalls).toBe(2)
    expect((await getMutationJob(harness.database, accountA, 'membership-job'))?.status).toBe(
      'succeeded'
    )
    harness.database.close()
  })

  test('recovers by fresh observation when the account switches during pre-write observation', async () => {
    const harness = await createHarness('membership-runner-switch-during-observation')
    await enqueueMembership(harness.database, [], ['L_added'])
    harness.membership.observations.push(stable([]), stable([]), stable(['L_added']))
    harness.membership.afterObservation = (call) => {
      if (call === 1) harness.auth.setActive(accountB)
    }

    await harness.runner.check()
    expect(await getMutationJob(harness.database, accountA, 'membership-job')).toMatchObject({
      status: 'observing-membership',
      recoveryStatus: 'account-suspended'
    })
    expect(harness.membership.writeRequests).toEqual([])

    harness.auth.setActive(accountA)
    harness.membership.afterObservation = null
    await harness.runner.check()

    expect(harness.membership.observationCalls).toBe(3)
    expect(harness.membership.writeRequests).toHaveLength(1)
    expect((await getMutationJob(harness.database, accountA, 'membership-job'))?.status).toBe(
      'succeeded'
    )
    harness.database.close()
  })

  test('discards read-back captured after an account switch and observes again for the owner', async () => {
    const harness = await createHarness('membership-runner-switch-before-readback')
    await enqueueMembership(harness.database, [], ['L_added'])
    harness.membership.observations.push(
      stable([]),
      stable(['L_added']),
      stable(['L_added'])
    )
    harness.membership.afterObservation = (call) => {
      if (call === 2) harness.auth.setActive(accountB)
    }

    await harness.runner.check()
    expect(await getMutationJob(harness.database, accountA, 'membership-job')).toMatchObject({
      status: 'verifying-membership',
      recoveryStatus: 'account-suspended'
    })

    harness.auth.setActive(accountA)
    harness.membership.afterObservation = null
    await harness.runner.check()

    expect(harness.membership.writeRequests).toHaveLength(1)
    expect(harness.membership.observationCalls).toBe(3)
    expect((await getMutationJob(harness.database, accountA, 'membership-job'))?.status).toBe(
      'succeeded'
    )
    harness.database.close()
  })

  test('suspends before read-back and performs only owner-scoped recovery on return', async () => {
    const harness = await createHarness('membership-runner-switch-before-readback-request')
    await enqueueMembership(harness.database, [], ['L_added'])
    harness.membership.observations.push(stable([]), stable(['L_added']))
    harness.membership.afterWrite = () => harness.auth.switchOnFutureLoad(2, accountB)

    await harness.runner.check()

    expect(await getMutationJob(harness.database, accountA, 'membership-job')).toMatchObject({
      status: 'verifying-membership',
      recoveryStatus: 'account-suspended'
    })
    expect(harness.membership.observationCalls).toBe(1)
    expect(harness.membership.writeRequests).toHaveLength(1)

    harness.auth.setActive(accountA)
    await harness.runner.check()

    expect(harness.membership.observationCalls).toBe(2)
    expect(harness.membership.writeRequests).toHaveLength(1)
    expect((await getMutationJob(harness.database, accountA, 'membership-job'))?.status).toBe(
      'succeeded'
    )
    harness.database.close()
  })

  test('pauses for a GraphQL rate limit and resumes with observation first', async () => {
    const harness = await createHarness('membership-runner-rate-limit')
    await enqueueMembership(harness.database, [], ['L_added'])
    const resetAt = new Date(initialTime + 5_000).toISOString()
    harness.membership.observations.push(
      rateLimited(resetAt),
      stable([]),
      stable(['L_added'])
    )

    await harness.runner.check()
    expect(await getMutationJob(harness.database, accountA, 'membership-job')).toMatchObject({
      status: 'retry-waiting',
      nextEligibleExecutionAt: resetAt
    })
    expect(harness.membership.writeRequests).toEqual([])

    harness.clock.value += 5_000
    await harness.runner.check()
    expect(harness.membership.observationCalls).toBe(3)
    expect(harness.membership.writeRequests).toHaveLength(1)
    expect((await getMutationJob(harness.database, accountA, 'membership-job'))?.status).toBe(
      'succeeded'
    )
    harness.database.close()
  })

  test('recovers a rate-limited mutation by read-back without issuing a duplicate write', async () => {
    const harness = await createHarness('membership-runner-mutation-rate-limit')
    await enqueueMembership(harness.database, [], ['L_added'])
    const resetAt = new Date(initialTime + 5_000).toISOString()
    harness.membership.observations.push(stable([]), stable(['L_added']))
    harness.membership.writeResults.push(
      mutationFailure('rate-limit', 'rate-limit', 'GitHub rate limit reached.', true, resetAt)
    )

    await harness.runner.check()

    expect(await getMutationJob(harness.database, accountA, 'membership-job')).toMatchObject({
      status: 'retry-waiting',
      nextEligibleExecutionAt: resetAt,
      membershipDetails: {recoveryPhase: 'mutation'}
    })
    harness.clock.value += 5_000
    await harness.runner.check()

    expect(harness.membership.writeRequests).toHaveLength(1)
    expect(harness.membership.observationCalls).toBe(2)
    expect((await getMutationJob(harness.database, accountA, 'membership-job'))?.status).toBe(
      'succeeded'
    )
    harness.database.close()
  })

  test('fails safely when write authorization expires or the mutation schema disappears', async () => {
    const cases = [
      {
        name: 'authorization-expiry',
        failure: mutationFailure(
          'credential-rejected',
          'authentication',
          'GitHub rejected the write credential.',
          false
        ),
        retryEligibility: 'after-reauthentication'
      },
      {
        name: 'schema-unavailable',
        failure: mutationFailure(
          'schema-unavailable',
          'unsupported',
          'GitHub does not expose the required native List mutation.',
          false
        ),
        retryEligibility: 'not-retryable'
      }
    ] as const

    for (const item of cases) {
      const harness = await createHarness(`membership-runner-${item.name}`)
      await enqueueMembership(harness.database, [], ['L_added'])
      harness.membership.observations.push(stable([]))
      harness.membership.writeResults.push(item.failure)

      await harness.runner.check()

      const job = await getMutationJob(harness.database, accountA, 'membership-job')
      expect(job?.status, item.name).toBe('failed')
      expect(job?.retryEligibility, item.name).toBe(item.retryEligibility)
      expect(harness.membership.writeRequests, item.name).toHaveLength(1)
      expect(harness.membership.observationCalls, item.name).toBe(1)
      harness.database.close()
    }
  })

  test('recovers persisted mutating state after service-worker termination by observing first', async () => {
    const harness = await createHarness('membership-runner-worker-termination')
    await enqueueMembership(harness.database, [], ['L_added'])
    const work = await claimNextMutationWork(harness.database, accountA, timestamp())
    const details = work?.job.membershipDetails
    if (!work || !details) throw new Error('Missing claimed membership fixture')
    await transitionMutationJob(
      harness.database,
      accountA,
      work.job.jobId,
      'observing-membership',
      timestamp(),
      {membershipDetails: details}
    )
    await transitionMutationJob(
      harness.database,
      accountA,
      work.job.jobId,
      'mutating-membership',
      timestamp(),
      {membershipDetails: {...details, recoveryPhase: 'mutation'}}
    )
    harness.membership.observations.push(stable(['L_added']))

    await harness.runner.check()

    expect(harness.membership.writeRequests).toEqual([])
    expect(harness.membership.observationCalls).toBe(1)
    expect((await getMutationJob(harness.database, accountA, work.job.jobId))?.status).toBe(
      'succeeded'
    )
    harness.database.close()
  })

  test('commits authoritative read-back and requires a new preview on mismatch', async () => {
    const harness = await createHarness('membership-runner-conflict')
    const annotation = annotationRecord()
    await putAnnotation(harness.database, annotation)
    await enqueueMembership(harness.database, [], ['L_added'])
    harness.membership.observations.push(stable([]), stable(['L_remote']))

    await harness.runner.check()

    const job = await getMutationJob(harness.database, accountA, 'membership-job')
    expect(job?.status).toBe('verification-conflict')
    expect(job?.retryEligibility).toBe('after-refresh')
    expect(job?.membershipDetails?.verificationConflict).toEqual({
      desired: canonicalMembershipSet(['L_added']),
      observed: canonicalMembershipSet(['L_remote'])
    })
    expect(
      (await listMembershipsForRepository(harness.database, accountA, repositoryNodeId)).map(
        (item) => item.listNodeId
      )
    ).toEqual(['L_remote'])
    expect(await getAnnotation(harness.database, accountA, repositoryNodeId)).toEqual(annotation)
    harness.database.close()
  })

  test('requires the repository to remain publicly accessible and starred before mutation', async () => {
    const harness = await createHarness('membership-runner-no-longer-starred')
    await enqueueMembership(harness.database, [], ['L_added'])
    harness.membership.observations.push(stable([]))
    harness.unstar.prepareResults.push({
      kind: 'confirmed-already-absent',
      observationAttempts: 2
    })

    await harness.runner.check()

    expect(harness.membership.writeRequests).toEqual([])
    expect((await getMutationJob(harness.database, accountA, 'membership-job'))?.status).toBe(
      'failed'
    )
    expect((await listOperationHistory(harness.database, accountA))[0]?.error?.message).toBe(
      'Repository is no longer publicly accessible and starred.'
    )
    harness.database.close()
  })

  test('shares one sequential drain with unstar work', async () => {
    const events: string[] = []
    const harness = await createHarness('membership-runner-shared-sequence')
    await enqueueMembership(harness.database, [], ['L_added'], 'a-membership-job')
    await putRepository(harness.database, repository('R_unstar'))
    await enqueueMutationBatch(harness.database, {
      githubUserId: accountA,
      batchId: 'unstar-batch',
      origin: 'single',
      createdAt: timestamp(),
      repositories: [
        {
          jobId: 'b-unstar-job',
          repositoryNodeId: 'R_unstar',
          ownerLogin: 'octocat',
          repositoryName: 'unstar-repo'
        }
      ]
    })
    harness.membership.observations.push(stable([]), stable(['L_added']))
    harness.membership.afterWrite = () => events.push('membership-write')
    harness.unstar.onPrepare = (target) =>
      events.push(target.repositoryName === 'repo' ? 'membership-guard' : 'unstar-prepare')

    await harness.runner.check()

    expect(events).toEqual(['membership-guard', 'membership-write', 'unstar-prepare'])
    expect((await getMutationJob(harness.database, accountA, 'a-membership-job'))?.status).toBe(
      'succeeded'
    )
    expect((await getMutationJob(harness.database, accountA, 'b-unstar-job'))?.status).toBe(
      'succeeded'
    )
    harness.database.close()
  })

  test('keeps successful bulk jobs when delayed peers need confirmation or conflict', async () => {
    const harness = await createHarness('membership-runner-partial-bulk')
    await enqueueMembershipBatch(harness.database, [
      {jobId: 'a-success', repositoryNodeId: 'R_success', before: [], additions: ['L_added']},
      {jobId: 'b-stale', repositoryNodeId: 'R_stale', before: [], additions: ['L_added']},
      {jobId: 'c-conflict', repositoryNodeId: 'R_conflict', before: [], additions: ['L_added']}
    ])
    harness.membership.observations.push(
      stable([], catalog(), 'R_success'),
      stable(['L_added'], catalog(), 'R_success'),
      stable(['L_external'], renamedCatalog(), 'R_stale'),
      stable([], catalog(), 'R_conflict'),
      stable(['L_remote'], catalog(), 'R_conflict')
    )
    harness.membership.afterWrite = () => {
      harness.clock.value += 60_000
    }

    await harness.runner.check()

    expect((await getMutationJob(harness.database, accountA, 'a-success'))?.status).toBe(
      'succeeded'
    )
    expect((await getMutationJob(harness.database, accountA, 'b-stale'))?.status).toBe(
      'needs-confirmation'
    )
    expect((await getMutationJob(harness.database, accountA, 'c-conflict'))?.status).toBe(
      'verification-conflict'
    )
    expect(await getMutationBatch(harness.database, accountA, 'membership-bulk')).toMatchObject({
      status: 'partially-completed',
      summary: {total: 3, succeeded: 1, blockedUnknown: 2}
    })
    expect(
      (await listMembershipsForRepository(harness.database, accountA, 'R_success')).map(
        (item) => item.listNodeId
      )
    ).toEqual(['L_added'])
    expect(
      (await listMembershipsForRepository(harness.database, accountA, 'R_conflict')).map(
        (item) => item.listNodeId
      )
    ).toEqual(['L_remote'])
    expect(harness.membership.writeRequests.map((request) => request.repositoryNodeId)).toEqual([
      'R_success',
      'R_conflict'
    ])
    harness.database.close()
  })

  test('rejects membership mutation after a completed unstar of the same repository', async () => {
    const harness = await createHarness('membership-runner-completed-unstar')
    await putRepository(harness.database, repository(repositoryNodeId))
    await enqueueMutationBatch(harness.database, {
      githubUserId: accountA,
      batchId: 'completed-unstar-batch',
      origin: 'single',
      createdAt: timestamp(),
      repositories: [
        {
          jobId: 'completed-unstar-job',
          repositoryNodeId,
          ownerLogin: 'octocat',
          repositoryName: 'repo'
        }
      ]
    })
    await harness.runner.check()
    expect((await getRepository(harness.database, accountA, repositoryNodeId))?.isStarred).toBe(
      false
    )

    await enqueueMembershipBatch(
      harness.database,
      [{jobId: 'membership-after-unstar', repositoryNodeId, before: [], additions: ['L_added']}],
      false
    )
    harness.membership.observations.push(stable([]))
    harness.unstar.prepareResults.push({kind: 'confirmed-already-absent', observationAttempts: 2})
    await harness.runner.check()

    expect(harness.membership.writeRequests).toEqual([])
    expect(
      (await getMutationJob(harness.database, accountA, 'membership-after-unstar'))?.status
    ).toBe('failed')
    expect((await getRepository(harness.database, accountA, repositoryNodeId))?.isStarred).toBe(
      false
    )
    harness.database.close()
  })

  test('leaves tags, notes, favorite, triage, revisit date, and review history untouched', async () => {
    const harness = await createHarness('membership-runner-local-annotations')
    const annotation = annotationRecord()
    await putAnnotation(harness.database, annotation)
    await enqueueMembership(harness.database, [], ['L_added'])
    harness.membership.observations.push(stable([]), stable(['L_added']))

    await harness.runner.check()

    expect(await getAnnotation(harness.database, accountA, repositoryNodeId)).toEqual(annotation)
    expect(await getAnnotation(harness.database, accountA, repositoryNodeId)).toMatchObject({
      tags: ['local'],
      note: 'Local note',
      favorite: true,
      triageState: 'backlog',
      revisitAt: '2026-09-01T00:00:00.000Z',
      reviewedAt: timestamp()
    })
    harness.database.close()
  })
})

interface HarnessOptions {
  readonly maximumAutomaticAttempts?: number
}

async function createHarness(name: string, options: HarnessOptions = {}) {
  const database = await openLibraryDatabase({name, factory: new IDBFactory()})
  const auth = new MutableAuthStore(accountA)
  const unstar = new ScriptedUnstarService()
  const membership = new ScriptedMembershipService()
  const clock = {value: initialTime}
  let id = 0
  const runner = new MutationQueueRunner({
    database,
    authStore: auth,
    service: unstar,
    membershipService: {observer: membership, writer: membership},
    now: () => clock.value,
    createId: (kind) => `${kind}-${++id}`,
    scheduleWake: () => Promise.resolve(),
    retryDelayMs: 1_000,
    ...(options.maximumAutomaticAttempts === undefined
      ? {}
      : {maximumAutomaticAttempts: options.maximumAutomaticAttempts})
  })
  return {database, auth, unstar, membership, clock, runner}
}

class MutableAuthStore {
  #active: GitHubUserId | null
  #scheduledSwitch: {remainingLoads: number; active: GitHubUserId | null} | null = null

  constructor(active: GitHubUserId | null) {
    this.#active = active
  }

  setActive(active: GitHubUserId | null): void {
    this.#active = active
    this.#scheduledSwitch = null
  }

  switchOnFutureLoad(remainingLoads: number, active: GitHubUserId | null): void {
    this.#scheduledSwitch = {remainingLoads, active}
  }

  loadActive(): Promise<AuthStateRecord | null> {
    if (this.#scheduledSwitch) {
      this.#scheduledSwitch.remainingLoads -= 1
      if (this.#scheduledSwitch.remainingLoads === 0) {
        this.#active = this.#scheduledSwitch.active
        this.#scheduledSwitch = null
      }
    }
    return Promise.resolve(this.#active ? authState(this.#active) : null)
  }
}

class ScriptedMembershipService {
  readonly observations: MembershipObservationOutcome[] = []
  readonly writeResults: Array<ListMembershipMutationResult | Error> = []
  readonly writeRequests: ListMembershipMutationRequest[] = []
  observationCalls = 0
  afterWrite: (() => void) | null = null
  afterObservation: ((call: number) => void) | null = null

  observeSelected(): Promise<MembershipObservationOutcome> {
    this.observationCalls += 1
    this.afterObservation?.(this.observationCalls)
    return Promise.resolve(this.observations.shift() ?? stable([]))
  }

  updateMemberships(
    request: ListMembershipMutationRequest
  ): Promise<ListMembershipMutationResult> {
    this.writeRequests.push(request)
    this.afterWrite?.()
    const result = this.writeResults.shift()
    if (result instanceof Error) return Promise.reject(result)
    return Promise.resolve(
      result ?? {updatedListIds: canonicalMembershipSet(request.completeListIds).listNodeIds}
    )
  }
}

class ScriptedUnstarService {
  readonly prepareResults: UnstarPreparationOutcome[] = []
  prepareCalls = 0
  onPrepare: ((target: SafeUnstarTarget) => void) | null = null

  prepare(target: SafeUnstarTarget): Promise<UnstarPreparationOutcome> {
    this.prepareCalls += 1
    this.onPrepare?.(target)
    return Promise.resolve(
      this.prepareResults.shift() ?? {
        kind: 'ready-to-delete',
        currentRoute: route(target.repositoryName),
        observationAttempts: 2
      }
    )
  }

  delete(target: SafeUnstarTarget): Promise<UnstarDeleteRequestOutcome> {
    return Promise.resolve({kind: 'delete-accepted', currentRoute: route(target.repositoryName)})
  }

  observeStableState(target: SafeUnstarTarget): Promise<StableUnstarObservationOutcome> {
    return Promise.resolve({
      kind: 'confirmed-absent',
      currentRoute: route(target.repositoryName),
      observationAttempts: 2
    })
  }
}

async function enqueueMembership(
  database: IDBDatabase,
  before: readonly string[],
  additions: readonly string[],
  jobId = 'membership-job'
): Promise<void> {
  await putRepository(database, repository(repositoryNodeId))
  const plan = planMembershipIntent(before, {
    kind: 'add',
    githubUserId: accountA,
    repositoryNodeId,
    additions
  })
  if (!plan.ok) throw new Error('Invalid membership fixture')
  await enqueueMembershipMutationBatch(database, {
    githubUserId: accountA,
    batchId: `batch-${jobId}`,
    origin: 'single',
    createdAt: timestamp(),
    repositories: [
      {
        jobId,
        repositoryNodeId,
        ownerLogin: 'octocat',
        repositoryName: 'repo',
        plan: plan.value,
        confirmedCatalog: catalog()
      }
    ]
  })
}

interface MembershipBatchFixture {
  readonly jobId: string
  readonly repositoryNodeId: string
  readonly before: readonly string[]
  readonly additions: readonly string[]
}

async function enqueueMembershipBatch(
  database: IDBDatabase,
  fixtures: readonly MembershipBatchFixture[],
  putRepositories = true
): Promise<void> {
  if (putRepositories) {
    for (const fixture of fixtures) await putRepository(database, repository(fixture.repositoryNodeId))
  }
  await enqueueMembershipMutationBatch(database, {
    githubUserId: accountA,
    batchId: 'membership-bulk',
    origin: fixtures.length > 1 ? 'bulk' : 'single',
    createdAt: timestamp(),
    repositories: fixtures.map((fixture) => {
      const plan = planMembershipIntent(fixture.before, {
        kind: 'add',
        githubUserId: accountA,
        repositoryNodeId: fixture.repositoryNodeId,
        additions: fixture.additions
      })
      if (!plan.ok) throw new Error('Invalid membership batch fixture')
      return {
        jobId: fixture.jobId,
        repositoryNodeId: fixture.repositoryNodeId,
        ownerLogin: 'octocat',
        repositoryName: fixture.repositoryNodeId,
        plan: plan.value,
        confirmedCatalog: catalog()
      }
    })
  })
}

function stable(
  listNodeIds: readonly string[],
  relevantCatalog: CanonicalListCatalogFingerprint = catalog(),
  observedRepositoryNodeId = repositoryNodeId
): Extract<MembershipObservationOutcome, {readonly status: 'stable'}> {
  const observed = canonicalMembershipSet(listNodeIds)
  const repositories = [
    {repositoryNodeId: observedRepositoryNodeId, observed, relevantCatalog}
  ]
  const complete: CompleteMembershipObservation = {
    githubUserId: accountA,
    completeness: 'complete',
    nonAtomic: true,
    captureInterval: {startedAt: timestamp(), completedAt: timestamp()},
    repositories,
    fingerprint: JSON.stringify([observed.fingerprint, relevantCatalog.fingerprint])
  }
  return {
    status: 'stable',
    githubUserId: accountA,
    attempts: 2,
    captureInterval: complete.captureInterval,
    observations: [complete, complete],
    repositories,
    fingerprint: complete.fingerprint
  }
}

function changing(): Extract<MembershipObservationOutcome, {readonly status: 'changing'}> {
  return {status: 'changing', githubUserId: accountA, attempts: 3, observations: []}
}

function rateLimited(
  resetAt: string
): Extract<MembershipObservationOutcome, {readonly status: 'rate-limited'}> {
  return {
    status: 'rate-limited',
    githubUserId: accountA,
    attempts: 1,
    error: null,
    rateLimit: {limit: 5_000, remaining: 0, resetAt}
  }
}

function catalog(): CanonicalListCatalogFingerprint {
  return relevantListCatalogFingerprint(
    ['L_added'],
    [{listNodeId: 'L_added', name: 'Added', visibility: 'public'}]
  )
}

function renamedCatalog(): CanonicalListCatalogFingerprint {
  return relevantListCatalogFingerprint(
    ['L_added'],
    [{listNodeId: 'L_added', name: 'Renamed', visibility: 'public'}]
  )
}

function privateCatalog(): CanonicalListCatalogFingerprint {
  return relevantListCatalogFingerprint(
    ['L_added'],
    [{listNodeId: 'L_added', name: 'Added', visibility: 'private'}]
  )
}

function deletedCatalog(): CanonicalListCatalogFingerprint {
  return relevantListCatalogFingerprint(['L_added'], [])
}

function mutationFailure(
  reason: ConstructorParameters<typeof ListMembershipMutationFailure>[0],
  category: ConstructorParameters<typeof ListMembershipMutationFailure>[1]['category'],
  message: string,
  retryable: boolean,
  retryAt?: string
): ListMembershipMutationFailure {
  return new ListMembershipMutationFailure(reason, {
    category,
    message,
    retryable,
    ...(retryAt === undefined ? {} : {retryAt})
  })
}

function repository(nodeId: string): RepositoryRecord {
  return {
    githubUserId: accountA,
    repositoryNodeId: nodeId,
    ownerLogin: 'octocat',
    name: nodeId === repositoryNodeId ? 'repo' : 'unstar-repo',
    fullName: `octocat/${nodeId}`,
    htmlUrl: `https://github.com/octocat/${nodeId}`,
    description: null,
    topics: [],
    primaryLanguage: null,
    starredAt: timestamp(),
    pushedAt: null,
    archived: false,
    disabled: false,
    isStarred: true,
    firstObservedAt: timestamp(),
    lastObservedAt: timestamp(),
    unstarredAt: null
  }
}

function membership(listNodeId: string) {
  return {
    githubUserId: accountA,
    repositoryNodeId,
    listNodeId,
    lastObservedAt: timestamp()
  }
}

function annotationRecord(): AnnotationRecord {
  return {
    githubUserId: accountA,
    repositoryNodeId,
    triageState: 'backlog',
    tags: ['local'],
    note: 'Local note',
    favorite: true,
    revisitAt: '2026-09-01T00:00:00.000Z',
    reviewedAt: timestamp(),
    localModifiedAt: timestamp()
  }
}

function authState(githubUserId: GitHubUserId): AuthStateRecord {
  return {
    githubUserId,
    identity: {
      githubUserId,
      userNodeId: `U_${githubUserId}`,
      login: githubUserId,
      avatarUrl: `https://avatars.githubusercontent.com/u/${githubUserId}`
    },
    credentials: {
      accessToken: 'read-access',
      refreshToken: 'read-refresh',
      accessTokenExpiresAt: '2026-08-08T20:00:00.000Z',
      refreshTokenExpiresAt: '2027-02-08T12:00:00.000Z',
      generation: 1
    },
    authenticatedAt: timestamp(),
    refreshedAt: timestamp()
  }
}

function route(repositoryName: string) {
  return {owner: 'octocat', repositoryName}
}

function timestamp(): string {
  return new Date(initialTime).toISOString()
}
