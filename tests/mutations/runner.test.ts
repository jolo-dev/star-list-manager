import {describe, expect, test} from 'bun:test'
import {IDBFactory} from 'fake-indexeddb'
import type {
  AuthStateRecord,
  GitHubUserId,
  RepositoryRecord
} from '../../src/domain/types'
import type {
  SafeUnstarTarget,
  StableUnstarObservationOutcome,
  UnstarDeleteRequestOutcome,
  UnstarPreparationOutcome
} from '../../src/github/safe-unstar-service'
import {MutationQueueRunner} from '../../src/mutations/runner'
import {
  mutationQueueAlarmName,
  registerMutationQueueWakeEvents
} from '../../src/mutations/wake'
import {openLibraryDatabase} from '../../src/storage/database'
import {clearAllLibraryData, putRepository} from '../../src/storage/library'
import {
  cancelQueuedMutationJob,
  enqueueMutationBatch,
  getMutationBatch,
  getMutationJob,
  listMutationAttempts,
  listMutationJobs,
  listOperationHistory
} from '../../src/storage/mutations'

const accountA = 'account-a'
const accountB = 'account-b'
const initialTime = Date.parse('2026-08-04T10:00:00.000Z')

describe('mutation queue runner', () => {
  test('runs once, processes deterministically and sequentially, and finalizes success or external completion', async () => {
    const harness = await createHarness('queue-sequential-test')
    await enqueue(harness.database, [
      repositoryInput('job-b', 'repo-b'),
      repositoryInput('job-a', 'repo-a')
    ])
    harness.service.prepareResults.push(
      ready('repo-a'),
      {kind: 'confirmed-already-absent', observationAttempts: 2}
    )
    harness.service.observeResults.push(absent('repo-a'))
    harness.service.onObserve = async (target) => {
      expect(
        (await getMutationJob(harness.database, accountA, jobIdFor(target)))?.status
      ).toBe('verifying')
    }

    const run = harness.runner.check()
    expect(harness.runner.check()).toBe(run)
    await run

    expect(harness.service.calls).toEqual([
      'prepare:repo-a',
      'delete:repo-a',
      'observe:repo-a',
      'prepare:repo-b'
    ])
    expect((await getMutationJob(harness.database, accountA, 'job-a'))?.status).toBe(
      'succeeded'
    )
    expect((await getMutationJob(harness.database, accountA, 'job-b'))?.status).toBe(
      'succeeded-external'
    )
    expect(
      (await listOperationHistory(harness.database, accountA)).map(
        (record) => record.verificationResult
      )
    ).toEqual(['verified-absent', 'already-absent'])
    expect(await listMutationAttempts(harness.database, accountA)).toHaveLength(2)
    harness.database.close()
  })

  test('recovers an ambiguous DELETE by observation without sending a duplicate DELETE', async () => {
    const harness = await createHarness('queue-ambiguous-delete-test')
    await enqueue(harness.database, [repositoryInput('job-a', 'repo-a')])
    harness.service.deleteResults.push({
      kind: 'network',
      statusCode: null,
      retryAt: null
    })

    await harness.runner.check()
    const retryAt = harness.scheduled.at(-1)
    expect(retryAt).not.toBeNull()
    expect((await getMutationJob(harness.database, accountA, 'job-a'))?.status).toBe(
      'retry-waiting'
    )

    harness.clock.value = Date.parse(retryAt ?? '')
    harness.service.observeResults.push(absent('repo-a'))
    await harness.runner.check()

    expect(harness.service.calls.filter((call) => call === 'delete:repo-a')).toHaveLength(1)
    expect(harness.service.calls.at(-1)).toBe('observe:repo-a')
    expect((await getMutationJob(harness.database, accountA, 'job-a'))?.status).toBe(
      'succeeded'
    )
    harness.database.close()
  })

  test('suspends before any request and resumes queued work when the owner returns', async () => {
    const harness = await createHarness('queue-account-before-request-test')
    await enqueue(harness.database, [repositoryInput('job-a', 'repo-a')])
    harness.auth.setActive(accountB)

    await harness.runner.check()
    expect(harness.service.calls).toEqual([])
    expect(
      (await getMutationJob(harness.database, accountA, 'job-a'))?.recoveryStatus
    ).toBe('account-suspended')

    harness.auth.setActive(accountA)
    harness.service.observeResults.push(absent('repo-a'))
    await harness.runner.check()
    expect(harness.service.calls).toEqual([
      'prepare:repo-a',
      'delete:repo-a',
      'observe:repo-a'
    ])
    harness.database.close()
  })

  test('suspends after pre-check and observes before DELETE when the owner returns', async () => {
    const harness = await createHarness('queue-account-after-precheck-test')
    await enqueue(harness.database, [repositoryInput('job-a', 'repo-a')])
    harness.service.onPrepare = () => harness.auth.setActive(accountB)

    await harness.runner.check()
    expect(harness.service.calls).toEqual(['prepare:repo-a'])
    expect(
      (await getMutationJob(harness.database, accountA, 'job-a'))?.recoveryStatus
    ).toBe('account-suspended')

    harness.service.onPrepare = null
    harness.auth.setActive(accountA)
    harness.service.observeResults.push(present('repo-a'), absent('repo-a'))
    await harness.runner.check()
    expect(harness.service.calls).toEqual([
      'prepare:repo-a',
      'observe:repo-a',
      'delete:repo-a',
      'observe:repo-a'
    ])
    harness.database.close()
  })

  test('suspends after DELETE and finalizes from owner observation without another DELETE', async () => {
    const harness = await createHarness('queue-account-after-delete-test')
    await enqueue(harness.database, [repositoryInput('job-a', 'repo-a')])
    harness.service.onDelete = () => harness.auth.setActive(accountB)

    await harness.runner.check()
    expect(harness.service.calls).toEqual(['prepare:repo-a', 'delete:repo-a'])
    expect((await getMutationJob(harness.database, accountA, 'job-a'))?.status).toBe(
      'deleting'
    )

    harness.service.onDelete = null
    harness.auth.setActive(accountA)
    harness.service.observeResults.push(absent('repo-a'))
    await harness.runner.check()
    expect(harness.service.calls.filter((call) => call === 'delete:repo-a')).toHaveLength(1)
    expect((await getMutationJob(harness.database, accountA, 'job-a'))?.status).toBe(
      'succeeded'
    )
    harness.database.close()
  })

  test('suspends during read-back and repeats only owner-scoped observation', async () => {
    const harness = await createHarness('queue-account-readback-test')
    await enqueue(harness.database, [repositoryInput('job-a', 'repo-a')])
    harness.service.onObserve = () => harness.auth.setActive(accountB)

    await harness.runner.check()
    expect(harness.service.calls).toEqual([
      'prepare:repo-a',
      'delete:repo-a',
      'observe:repo-a'
    ])
    expect((await getMutationJob(harness.database, accountA, 'job-a'))?.status).toBe(
      'verifying'
    )

    harness.service.onObserve = null
    harness.auth.setActive(accountA)
    harness.service.observeResults.push(absent('repo-a'))
    await harness.runner.check()
    expect(harness.service.calls.filter((call) => call === 'delete:repo-a')).toHaveLength(1)
    expect(harness.service.calls.filter((call) => call === 'observe:repo-a')).toHaveLength(
      2
    )
    harness.database.close()
  })

  test('does not terminalize route or observation failures while the owner is inactive', async () => {
    const routeHarness = await createHarness('queue-owner-route-block-test')
    await enqueue(routeHarness.database, [repositoryInput('job-a', 'repo-a')])
    routeHarness.service.prepareResults.push({
      kind: 'blocked-unknown',
      reason: 'route',
      statusCode: 404
    })
    routeHarness.service.onPrepare = () => routeHarness.auth.setActive(accountB)

    await routeHarness.runner.check()
    expect(await listOperationHistory(routeHarness.database, accountA)).toEqual([])
    expect(await getMutationJob(routeHarness.database, accountA, 'job-a')).toMatchObject({
      status: 'checking',
      recoveryStatus: 'account-suspended'
    })

    routeHarness.service.onPrepare = null
    routeHarness.auth.setActive(accountA)
    routeHarness.service.observeResults.push({
      kind: 'blocked-unknown',
      reason: 'route',
      statusCode: 404
    })
    await routeHarness.createRunner().check()
    expect((await getMutationJob(routeHarness.database, accountA, 'job-a'))?.status).toBe(
      'blocked-unknown'
    )
    routeHarness.database.close()

    const observationHarness = await createHarness('queue-owner-observation-block-test')
    await enqueue(observationHarness.database, [repositoryInput('job-a', 'repo-a')])
    observationHarness.service.observeResults.push({
      kind: 'blocked-unknown',
      reason: 'unstable',
      statusCode: null
    })
    observationHarness.service.onObserve = () =>
      observationHarness.auth.setActive(accountB)

    await observationHarness.runner.check()
    expect(await listOperationHistory(observationHarness.database, accountA)).toEqual([])
    expect(
      await getMutationJob(observationHarness.database, accountA, 'job-a')
    ).toMatchObject({status: 'verifying', recoveryStatus: 'account-suspended'})

    observationHarness.service.onObserve = null
    observationHarness.auth.setActive(accountA)
    observationHarness.service.observeResults.push({
      kind: 'blocked-unknown',
      reason: 'unstable',
      statusCode: null
    })
    await observationHarness.createRunner().check()
    expect(
      (await getMutationJob(observationHarness.database, accountA, 'job-a'))?.status
    ).toBe('blocked-unknown')
    observationHarness.database.close()
  })

  test('recovers persisted work with new runners after termination at every execution boundary', async () => {
    const stages = [
      'before-claim',
      'route-pre-check',
      'after-delete',
      'during-verification',
      'before-finalization'
    ] as const

    for (const stage of stages) {
      const harness = await createHarness(`queue-termination-${stage}`)
      await enqueue(harness.database, [repositoryInput('job-a', 'repo-a')])

      if (stage !== 'before-claim') {
        if (stage === 'route-pre-check') {
          harness.service.onPrepare = () => {
            throw new Error('simulated browser termination')
          }
        } else if (stage === 'after-delete') {
          harness.service.onDelete = () => {
            throw new Error('simulated browser termination')
          }
        } else if (stage === 'during-verification') {
          harness.service.onObserve = () => {
            throw new Error('simulated browser termination')
          }
        } else {
          harness.service.onObserve = () => harness.auth.failNextLoad()
        }
        await expect(harness.runner.check()).rejects.toThrow('simulated browser termination')
      }

      harness.service.onPrepare = null
      harness.service.onDelete = null
      harness.service.onObserve = null
      const interrupted = await getMutationJob(harness.database, accountA, 'job-a')
      if (stage === 'route-pre-check') expect(interrupted?.status).toBe('checking')
      if (stage === 'after-delete') expect(interrupted?.status).toBe('deleting')
      if (stage === 'during-verification' || stage === 'before-finalization') {
        expect(interrupted?.status).toBe('verifying')
      }

      if (stage === 'route-pre-check') {
        harness.service.observeResults.push(present('repo-a'), absent('repo-a'))
      } else if (stage !== 'before-claim') {
        harness.service.observeResults.push(absent('repo-a'))
      }
      await harness.createRunner().check()

      expect((await getMutationJob(harness.database, accountA, 'job-a'))?.status).toBe(
        'succeeded'
      )
      expect(
        harness.service.calls.filter((call) => call === 'delete:repo-a')
      ).toHaveLength(1)
      expect(await listOperationHistory(harness.database, accountA)).toHaveLength(1)
      harness.database.close()
    }
  })

  test('continues persisted work after the dashboard connection closes', async () => {
    const harness = await createHarness('queue-dashboard-closure-test')
    await enqueue(harness.database, [repositoryInput('job-a', 'repo-a')])
    harness.database.close()

    const backgroundDatabase = await openLibraryDatabase({
      name: harness.name,
      factory: harness.factory
    })
    await harness.createRunner(backgroundDatabase).check()

    expect((await getMutationJob(backgroundDatabase, accountA, 'job-a'))?.status).toBe(
      'succeeded'
    )
    expect(harness.service.calls).toEqual([
      'prepare:repo-a',
      'delete:repo-a',
      'observe:repo-a'
    ])
    backgroundDatabase.close()
  })

  test('bounds network and server retries and records each sanitized attempt', async () => {
    const harness = await createHarness('queue-retry-limit-test', {
      maximumAutomaticAttempts: 2
    })
    await enqueue(harness.database, [repositoryInput('job-a', 'repo-a')])
    harness.service.prepareResults.push({
      kind: 'network',
      statusCode: null,
      retryAt: null
    })

    await harness.runner.check()
    harness.clock.value = Date.parse(harness.scheduled.at(-1) ?? '')
    harness.service.observeResults.push({kind: 'server', statusCode: 503, retryAt: null})
    await harness.runner.check()

    const job = await getMutationJob(harness.database, accountA, 'job-a')
    expect(job?.status).toBe('failed')
    expect(job?.retryEligibility).toBe('not-retryable')
    expect(await listMutationAttempts(harness.database, accountA)).toHaveLength(2)
    expect(JSON.stringify(await listMutationAttempts(harness.database, accountA))).not.toContain(
      'authorization'
    )
    harness.database.close()
  })

  test('schedules rate limits at reset and stops authentication and permission failures', async () => {
    const resetAt = '2026-08-04T11:00:00.000Z'
    const rateHarness = await createHarness('queue-rate-reset-test')
    await enqueue(rateHarness.database, [repositoryInput('job-a', 'repo-a')])
    rateHarness.service.prepareResults.push({
      kind: 'rate-limit',
      statusCode: 403,
      retryAt: resetAt
    })
    await rateHarness.runner.check()
    expect(rateHarness.scheduled.at(-1)).toBe(resetAt)
    rateHarness.clock.value = Date.parse(resetAt) - 1
    await rateHarness.runner.check()
    expect(rateHarness.service.calls).toEqual(['prepare:repo-a'])
    rateHarness.clock.value = Date.parse(resetAt)
    rateHarness.service.observeResults.push(present('repo-a'), absent('repo-a'))
    await rateHarness.createRunner().check()
    expect((await getMutationJob(rateHarness.database, accountA, 'job-a'))?.status).toBe(
      'succeeded'
    )
    rateHarness.database.close()

    const stopped = await createHarness('queue-authorization-stop-test')
    await enqueue(stopped.database, [
      repositoryInput('job-a', 'repo-a'),
      repositoryInput('job-b', 'repo-b')
    ])
    stopped.service.prepareResults.push(
      {kind: 'authentication', statusCode: 401, retryAt: null},
      {kind: 'permission', statusCode: 403, retryAt: null}
    )
    await stopped.runner.check()
    expect((await getMutationJob(stopped.database, accountA, 'job-a'))?.status).toBe(
      'failed'
    )
    expect((await getMutationJob(stopped.database, accountA, 'job-b'))?.status).toBe(
      'failed'
    )
    expect((await getMutationJob(stopped.database, accountA, 'job-a'))?.retryEligibility).toBe(
      'after-reauthentication'
    )
    expect((await getMutationJob(stopped.database, accountA, 'job-b'))?.retryEligibility).toBe(
      'after-reauthentication'
    )
    await stopped.createRunner().check()
    expect(stopped.service.calls).toEqual(['prepare:repo-a', 'prepare:repo-b'])
    expect(stopped.scheduled.at(-1)).toBeNull()
    stopped.database.close()
  })

  test('reports independent partial bulk outcomes without rolling back successes', async () => {
    const harness = await createHarness('queue-partial-bulk-test')
    await enqueue(harness.database, [
      repositoryInput('job-a', 'repo-a'),
      repositoryInput('job-b', 'repo-b'),
      repositoryInput('job-c', 'repo-c'),
      repositoryInput('job-d', 'repo-d'),
      repositoryInput('job-e', 'repo-e')
    ])
    await cancelQueuedMutationJob(
      harness.database,
      accountA,
      'job-e',
      'history-cancelled',
      new Date(initialTime).toISOString()
    )
    harness.service.prepareResults.push(
      {kind: 'confirmed-already-absent', observationAttempts: 2},
      {kind: 'blocked-unknown', reason: 'route', statusCode: 404},
      {kind: 'permission', statusCode: 403, retryAt: null},
      ready('repo-d')
    )
    harness.service.observeResults.push(absent('repo-d'))

    await harness.runner.check()

    const batch = await getMutationBatch(
      harness.database,
      accountA,
      'batch-job-a-job-b-job-c-job-d-job-e'
    )
    expect(batch?.status).toBe('partially-completed')
    expect(batch?.summary).toEqual({
      total: 5,
      succeeded: 2,
      failed: 1,
      blockedUnknown: 1,
      queued: 0,
      cancelled: 1,
      pending: 0,
      retryEligible: 2
    })
    expect(
      (await listOperationHistory(harness.database, accountA))
        .map((history) => history.finalStatus)
        .sort()
    ).toEqual([
      'blocked-unknown',
      'cancelled',
      'failed',
      'succeeded',
      'succeeded-external'
    ])
    harness.database.close()
  })

  test('terminalizes unresolved owner-active state as blocked-unknown without retry', async () => {
    const harness = await createHarness('queue-blocked-test')
    await enqueue(harness.database, [repositoryInput('job-a', 'repo-a')])
    harness.service.prepareResults.push({
      kind: 'blocked-unknown',
      reason: 'route',
      statusCode: 404
    })

    await harness.runner.check()
    const job = await getMutationJob(harness.database, accountA, 'job-a')
    expect(job?.status).toBe('blocked-unknown')
    expect(job?.retryEligibility).toBe('after-refresh')
    expect(harness.service.calls).toEqual(['prepare:repo-a'])
    harness.database.close()
  })

  test('quiesces an active runner before complete deletion and can resume empty', async () => {
    const harness = await createHarness('queue-complete-deletion-race-test')
    await enqueue(harness.database, [repositoryInput('job-a', 'repo-a')])
    let releasePreparation: () => void = () => {}
    let preparationStarted: () => void = () => {}
    const preparationGate = new Promise<void>((resolve) => {
      releasePreparation = resolve
    })
    const started = new Promise<void>((resolve) => {
      preparationStarted = resolve
    })
    harness.service.onPrepare = () => {
      preparationStarted()
      return preparationGate
    }

    const running = harness.runner.check()
    await started
    const paused = harness.runner.pause()
    releasePreparation()
    await paused
    await running
    await clearAllLibraryData(harness.database)
    harness.runner.resume()
    await harness.runner.check()

    expect(harness.service.calls).toEqual(['prepare:repo-a'])
    expect(await listMutationJobs(harness.database, accountA)).toEqual([])
    expect(await listOperationHistory(harness.database, accountA)).toEqual([])
    harness.database.close()
  })
})

describe('mutation queue wake events', () => {
  test('wakes on the named alarm and browser startup only', () => {
    const listeners: {
      alarm: (() => void) | null
      startup: (() => void) | null
    } = {alarm: null, startup: null}
    let checks = 0
    registerMutationQueueWakeEvents(
      {
        onAlarm: (name, listener) => {
          expect(name).toBe(mutationQueueAlarmName)
          listeners.alarm = listener
        },
        onStartup: (listener) => {
          listeners.startup = listener
        }
      },
      () => {
        checks += 1
      }
    )

    listeners.alarm?.()
    listeners.startup?.()
    expect(checks).toBe(2)
  })

  test('startup and alarm listeners drain persisted eligible work', async () => {
    const harness = await createHarness('queue-wake-integration-test')
    await enqueue(harness.database, [repositoryInput('job-a', 'repo-a')])
    const listeners: {
      alarm: (() => void) | null
      startup: (() => void) | null
    } = {alarm: null, startup: null}
    let wake: Promise<void> = Promise.resolve()
    registerMutationQueueWakeEvents(
      {
        onAlarm: (_name, listener) => {
          listeners.alarm = listener
        },
        onStartup: (listener) => {
          listeners.startup = listener
        }
      },
      () => {
        wake = harness.createRunner().check()
      }
    )

    listeners.startup?.()
    await wake
    expect((await getMutationJob(harness.database, accountA, 'job-a'))?.status).toBe(
      'succeeded'
    )

    await enqueue(harness.database, [repositoryInput('job-b', 'repo-b')])
    listeners.alarm?.()
    await wake
    expect((await getMutationJob(harness.database, accountA, 'job-b'))?.status).toBe(
      'succeeded'
    )
    harness.database.close()
  })
})

interface HarnessOptions {
  readonly maximumAutomaticAttempts?: number
}

interface Harness {
  readonly database: IDBDatabase
  readonly factory: IDBFactory
  readonly name: string
  readonly auth: MutableAuthStore
  readonly service: ScriptedUnstarService
  readonly runner: MutationQueueRunner
  readonly createRunner: (database?: IDBDatabase) => MutationQueueRunner
  readonly clock: {value: number}
  readonly scheduled: Array<string | null>
}

async function createHarness(
  name: string,
  options: HarnessOptions = {}
): Promise<Harness> {
  const factory = new IDBFactory()
  const database = await openLibraryDatabase({name, factory})
  const auth = new MutableAuthStore(accountA)
  const service = new ScriptedUnstarService()
  const clock = {value: initialTime}
  const scheduled: Array<string | null> = []
  let id = 0
  const createRunner = (runnerDatabase = database) =>
    new MutationQueueRunner({
      database: runnerDatabase,
      authStore: auth,
      service,
      now: () => clock.value,
      createId: (kind) => `${kind}-${++id}`,
      scheduleWake: (nextExecutionAt) => {
        scheduled.push(nextExecutionAt)
        return Promise.resolve()
      },
      retryDelayMs: 1_000,
      ...(options.maximumAutomaticAttempts === undefined
        ? {}
        : {maximumAutomaticAttempts: options.maximumAutomaticAttempts})
    })
  const runner = createRunner()
  return {database, factory, name, auth, service, runner, createRunner, clock, scheduled}
}

class MutableAuthStore {
  #active: GitHubUserId | null
  #nextFailure: Error | null = null

  constructor(active: GitHubUserId | null) {
    this.#active = active
  }

  setActive(active: GitHubUserId | null): void {
    this.#active = active
  }

  failNextLoad(): void {
    this.#nextFailure = new Error('simulated browser termination')
  }

  loadActive(): Promise<AuthStateRecord | null> {
    if (this.#nextFailure) {
      const failure = this.#nextFailure
      this.#nextFailure = null
      return Promise.reject(failure)
    }
    return Promise.resolve(this.#active ? authState(this.#active) : null)
  }
}

class ScriptedUnstarService {
  readonly calls: string[] = []
  readonly prepareResults: UnstarPreparationOutcome[] = []
  readonly deleteResults: UnstarDeleteRequestOutcome[] = []
  readonly observeResults: StableUnstarObservationOutcome[] = []
  onPrepare: ((target: SafeUnstarTarget) => void | Promise<void>) | null = null
  onDelete: ((target: SafeUnstarTarget) => void | Promise<void>) | null = null
  onObserve: ((target: SafeUnstarTarget) => void | Promise<void>) | null = null

  async prepare(target: SafeUnstarTarget): Promise<UnstarPreparationOutcome> {
    this.calls.push(`prepare:${target.repositoryName}`)
    await this.onPrepare?.(target)
    return this.prepareResults.shift() ?? ready(target.repositoryName)
  }

  async delete(target: SafeUnstarTarget): Promise<UnstarDeleteRequestOutcome> {
    this.calls.push(`delete:${target.repositoryName}`)
    await this.onDelete?.(target)
    return (
      this.deleteResults.shift() ?? {
        kind: 'delete-accepted',
        currentRoute: route(target.repositoryName)
      }
    )
  }

  async observeStableState(
    target: SafeUnstarTarget
  ): Promise<StableUnstarObservationOutcome> {
    this.calls.push(`observe:${target.repositoryName}`)
    await this.onObserve?.(target)
    return this.observeResults.shift() ?? absent(target.repositoryName)
  }
}

async function enqueue(
  database: IDBDatabase,
  repositories: readonly ReturnType<typeof repositoryInput>[]
): Promise<void> {
  for (const repository of repositories) {
    await putRepository(database, repositoryRecord(repository.repositoryNodeId))
  }
  await enqueueMutationBatch(database, {
    githubUserId: accountA,
    batchId: `batch-${repositories.map((repository) => repository.jobId).join('-')}`,
    origin: repositories.length === 1 ? 'single' : 'bulk',
    createdAt: new Date(initialTime).toISOString(),
    repositories
  })
}

function repositoryInput(jobId: string, repositoryNodeId: string) {
  return {
    jobId,
    repositoryNodeId,
    ownerLogin: 'owner',
    repositoryName: repositoryNodeId
  }
}

function ready(repositoryName: string): UnstarPreparationOutcome {
  return {kind: 'ready-to-delete', currentRoute: route(repositoryName)}
}

function absent(repositoryName: string): StableUnstarObservationOutcome {
  return {
    kind: 'confirmed-absent',
    currentRoute: route(repositoryName),
    observationAttempts: 2
  }
}

function present(repositoryName: string): StableUnstarObservationOutcome {
  return {
    kind: 'confirmed-present',
    currentRoute: route(repositoryName),
    observationAttempts: 2
  }
}

function route(repositoryName: string) {
  return {owner: 'owner', repositoryName}
}

function jobIdFor(target: SafeUnstarTarget): string {
  return `job-${target.repositoryName.slice('repo-'.length)}`
}

function repositoryRecord(repositoryNodeId: string): RepositoryRecord {
  const timestamp = new Date(initialTime).toISOString()
  return {
    githubUserId: accountA,
    repositoryNodeId,
    ownerLogin: 'owner',
    name: repositoryNodeId,
    fullName: `owner/${repositoryNodeId}`,
    htmlUrl: `https://github.com/owner/${repositoryNodeId}`,
    description: null,
    topics: [],
    primaryLanguage: null,
    starredAt: timestamp,
    pushedAt: null,
    archived: false,
    disabled: false,
    isStarred: true,
    firstObservedAt: timestamp,
    lastObservedAt: timestamp,
    unstarredAt: null
  }
}

function authState(githubUserId: GitHubUserId): AuthStateRecord {
  const timestamp = new Date(initialTime).toISOString()
  return {
    githubUserId,
    identity: {
      githubUserId,
      userNodeId: `U-${githubUserId}`,
      login: githubUserId,
      avatarUrl: `https://avatars.githubusercontent.com/${githubUserId}`
    },
    credentials: {
      accessToken: 'not-used-by-queue-test',
      refreshToken: 'not-used-by-queue-test',
      accessTokenExpiresAt: '2027-01-01T00:00:00.000Z',
      refreshTokenExpiresAt: '2027-02-01T00:00:00.000Z',
      generation: 1
    },
    authenticatedAt: timestamp,
    refreshedAt: timestamp
  }
}
