import {describe, expect, test} from 'bun:test'
import type {NativeListLifecycleOperationRecord, NativeListRecord} from '../../src/domain/types'
import type {AppState, WriteAuthorizationState} from '../../src/shared/messages'
import {NativeListMutationLock} from '../../src/mutations/native-list-mutation-lock'
import {
  handleNativeListLifecycle,
  nativeListLifecycleReadiness,
  type NativeListLifecycleRuntimeServices
} from '../../src/background-lifecycle-runtime'

const now = '2026-08-12T00:00:00.000Z'

describe('native List lifecycle background runtime', () => {
  test('keeps lifecycle independently capability-gated before persisting or dispatching', async () => {
    const harness = runtimeServices()
    const response = await handleNativeListLifecycle(harness.services, {
      type: 'confirm-native-list-create', name: 'Ideas', visibility: 'public'
    }, {capabilityProven: false, getDashboardState: harness.dashboard})

    expect(response.ok).toBe(false)
    expect(harness.persisted).toEqual([])
    expect(harness.runnerCalls).toBe(0)
    expect(nativeListLifecycleReadiness(false, readyWriteAuthorization())).toBe('capability-unproven')
  })

  test('rejects signed-out, mismatched, and write-unready accounts before persist or dispatch', async () => {
    for (const overrides of [
      {active: null},
      {active: {githubUserId: '42', identity: {githubUserId: '99'}}},
      {writeAuthorization: authorizationRequired()}
    ] as const) {
      const harness = runtimeServices(overrides)
      const response = await handleNativeListLifecycle(harness.services, {
        type: 'confirm-native-list-create', name: 'Ideas', visibility: 'private'
      }, {capabilityProven: true, getDashboardState: harness.dashboard})
      expect(response.ok).toBe(false)
      expect(harness.persisted).toEqual([])
      expect(harness.runnerCalls).toBe(0)
    }
  })

  test('returns a fresh delete preview with the exact stable ID and confirmation fingerprint without dispatching', async () => {
    const harness = runtimeServices()
    const response = await handleNativeListLifecycle(harness.services, {
      type: 'preview-native-list-delete', listNodeId: 'UL_one'
    }, {capabilityProven: false, getDashboardState: harness.dashboard})

    expect(response).toEqual({
      ok: true,
      data: {
        kind: 'delete', listNodeId: 'UL_one', name: 'Ideas', visibility: 'private',
        reportedItemCount: 2, importStatus: 'partial',
        confirmationFingerprint: JSON.stringify(['UL_one', 'Ideas', 'private', 2, 'partial'])
      }
    })
    expect(harness.persisted).toEqual([])
    expect(harness.runnerCalls).toBe(0)
  })

  test('rejects delete confirmation when the active account changes during fresh revalidation', async () => {
    const harness = runtimeServices({deferCatalog: true})
    const confirmation = handleNativeListLifecycle(harness.services, {
      type: 'confirm-native-list-delete',
      listNodeId: 'UL_one',
      confirmationFingerprint: JSON.stringify(['UL_one', 'Ideas', 'private', 2, 'partial'])
    }, {capabilityProven: true, getDashboardState: harness.dashboard})

    await harness.waitForCatalog()
    harness.setActive({githubUserId: '99', identity: {githubUserId: '99'}})
    harness.resolveCatalog()

    expect(await confirmation).toEqual({
      ok: false,
      error: {
        category: 'authentication',
        message: 'The active GitHub account changed. Retry the native List action.',
        retryable: true
      }
    })
    expect(harness.persisted).toEqual([])
    expect(harness.runnerCalls).toBe(0)
  })

  test('rejects create confirmation when the active account changes during an awaited operation check', async () => {
    const harness = runtimeServices({deferActiveLookup: true})
    const confirmation = handleNativeListLifecycle(harness.services, {
      type: 'confirm-native-list-create', name: 'Ideas', visibility: 'public'
    }, {capabilityProven: true, getDashboardState: harness.dashboard})

    await harness.waitForActiveLookup()
    harness.setActive({githubUserId: '99', identity: {githubUserId: '99'}})
    harness.resolveActiveLookup()

    expect(await confirmation).toEqual({
      ok: false,
      error: {
        category: 'authentication',
        message: 'The active GitHub account changed. Retry the native List action.',
        retryable: true
      }
    })
    expect(harness.persisted).toEqual([])
    expect(harness.runnerCalls).toBe(0)
  })

  test('persists a confirmed operation before starting the composed runner and rejects active-operation conflicts', async () => {
    const harness = runtimeServices()
    const response = await handleNativeListLifecycle(harness.services, {
      type: 'confirm-native-list-delete',
      listNodeId: 'UL_one',
      confirmationFingerprint: JSON.stringify(['UL_one', 'Ideas', 'private', 2, 'partial'])
    }, {capabilityProven: true, getDashboardState: harness.dashboard})

    expect(response.ok).toBe(true)
    expect(harness.persisted).toMatchObject([{githubUserId: '42', phase: 'queued', intent: {
      kind: 'delete', listNodeId: 'UL_one', name: 'Ideas', visibility: 'private', reportedItemCount: 2, importStatus: 'partial'
    }}])
    expect(harness.events).toEqual(['persist', 'run'])

    const conflicted = runtimeServices({activeOperation: createOperation()})
    const conflict = await handleNativeListLifecycle(conflicted.services, {
      type: 'confirm-native-list-create', name: 'Other', visibility: 'public'
    }, {capabilityProven: true, getDashboardState: conflicted.dashboard})
    expect(conflict.ok).toBe(false)
    expect(conflicted.persisted).toEqual([])
    expect(conflicted.runnerCalls).toBe(0)
  })

  test('allows cancellation only before remote dispatch and lifecycle state/status reads do not dispatch', async () => {
    const operation = createOperation()
    const harness = runtimeServices({activeOperation: operation})
    const status = await handleNativeListLifecycle(harness.services, {
      type: 'get-native-list-lifecycle-status'
    }, {capabilityProven: false, getDashboardState: harness.dashboard})
    expect(status.ok).toBe(true)
    expect(harness.runnerCalls).toBe(0)

    const cancelled = await handleNativeListLifecycle(harness.services, {
      type: 'cancel-native-list-lifecycle'
    }, {capabilityProven: true, getDashboardState: harness.dashboard, now: () => now})
    expect(cancelled.ok).toBe(true)
    expect(harness.persisted.at(-1)).toMatchObject({phase: 'cancelled', completedAt: now})
    expect(harness.runnerCalls).toBe(0)

    const preflight = runtimeServices({activeOperation: {...operation, phase: 'preflight'}})
    const preflightCancelled = await handleNativeListLifecycle(preflight.services, {
      type: 'cancel-native-list-lifecycle'
    }, {capabilityProven: true, getDashboardState: preflight.dashboard, now: () => now})
    expect(preflightCancelled.ok).toBe(true)
    expect(preflight.persisted.at(-1)).toMatchObject({phase: 'cancelled'})
    expect(preflight.runnerCalls).toBe(0)
  })

  test('waits on the shared mutation lock and does not overwrite work that advanced to mutating', async () => {
    const operation = {...createOperation(), phase: 'preflight' as const}
    const harness = runtimeServices({activeOperation: operation})
    let releaseRunner!: () => void
    const runnerOwnsLock = harness.lock.run(async () => {
      await new Promise<void>((resolve) => { releaseRunner = resolve })
    })
    await Promise.resolve()

    const cancellation = handleNativeListLifecycle(harness.services, {
      type: 'cancel-native-list-lifecycle'
    }, {capabilityProven: true, getDashboardState: harness.dashboard, now: () => now})
    await Promise.resolve()
    expect(harness.persisted).toEqual([])

    harness.setActiveOperation({...operation, phase: 'mutating'})
    releaseRunner()
    const response = await cancellation
    await runnerOwnsLock

    expect(response.ok).toBe(false)
    expect(harness.persisted).toEqual([])
    expect(harness.runnerCalls).toBe(0)
  })
})

interface Overrides {
  readonly active?: {readonly githubUserId: string; readonly identity: {readonly githubUserId: string}} | null
  readonly writeAuthorization?: WriteAuthorizationState
  readonly activeOperation?: NativeListLifecycleOperationRecord | null
  readonly deferCatalog?: boolean
  readonly deferActiveLookup?: boolean
}

function runtimeServices(overrides: Overrides = {}) {
  const persisted: NativeListLifecycleOperationRecord[] = []
  const events: string[] = []
  let activeOperation = overrides.activeOperation ?? null
  let active = overrides.active === undefined
    ? {githubUserId: '42', identity: {githubUserId: '42'}}
    : overrides.active
  let runnerCalls = 0
  const lock = new NativeListMutationLock()
  const catalog = [list('UL_one', 'Ideas', 'private', 2, 'partial')]
  let beginCatalog!: () => void
  const catalogStarted = new Promise<void>((resolve) => { beginCatalog = resolve })
  let releaseCatalog: (() => void) | null = null
  const catalogReleased = new Promise<void>((resolve) => { releaseCatalog = resolve })
  let beginActiveLookup!: () => void
  const activeLookupStarted = new Promise<void>((resolve) => { beginActiveLookup = resolve })
  let releaseActiveLookup: (() => void) | null = null
  const activeLookupReleased = new Promise<void>((resolve) => { releaseActiveLookup = resolve })
  const services: NativeListLifecycleRuntimeServices = {
    authSession: {loadActive: async () => active},
    writeAuthController: {getState: async () => overrides.writeAuthorization ?? readyWriteAuthorization()},
    nativeListSync: {
      observeCatalog: async (_userId, ids) => {
        beginCatalog()
        if (overrides.deferCatalog) await catalogReleased
        return {githubUserId: '42', complete: true, targets: new Map(ids.map((id) => [id, id === 'UL_one' ? {
          listNodeId: 'UL_one', name: 'Ideas', description: null, isPrivate: true, slug: null, createdAt: null, updatedAt: null, lastAddedAt: null, reportedItemCount: 2
        } : null])), fingerprint: 'catalog', rateLimit: {limit: 5000, remaining: 4999, resetAt: null}}
      },
      synchronize: async () => ({phase: 'complete'})
    },
    lifecycleStorage: {
      getActive: async () => {
        beginActiveLookup()
        if (overrides.deferActiveLookup) await activeLookupReleased
        return activeOperation
      },
      put: async (operation) => { events.push('persist'); persisted.push(operation); activeOperation = operation },
      cancelPreDispatch: async (githubUserId, operationId, cancelledAt) => {
        if (
          activeOperation?.githubUserId !== githubUserId ||
          activeOperation.operationId !== operationId ||
          (activeOperation.phase !== 'queued' && activeOperation.phase !== 'preflight')
        ) return null
        const cancelled = {...activeOperation, phase: 'cancelled' as const, updatedAt: cancelledAt, completedAt: cancelledAt}
        events.push('persist')
        persisted.push(cancelled)
        activeOperation = cancelled
        return cancelled
      },
      listCatalog: async () => catalog
    },
    nativeListLifecycleRunner: {
      run: async () => { events.push('run'); runnerCalls += 1 },
      operation: async () => activeOperation
    },
    nativeListMutationLock: lock
  }
  return {
    services,
    persisted,
    events,
    lock,
    setActive: (next: NonNullable<Overrides['active']>) => { active = next },
    setActiveOperation: (operation: NativeListLifecycleOperationRecord | null) => { activeOperation = operation },
    waitForCatalog: () => catalogStarted,
    resolveCatalog: () => releaseCatalog?.(),
    waitForActiveLookup: () => activeLookupStarted,
    resolveActiveLookup: () => releaseActiveLookup?.(),
    get runnerCalls() { return runnerCalls },
    dashboard: async () => dashboardState()
  }
}

function readyWriteAuthorization(): WriteAuthorizationState {
  return {readiness: 'ready', membershipReady: true, previewVisible: false, authorization: null, error: null}
}
function authorizationRequired(): WriteAuthorizationState { return {...readyWriteAuthorization(), readiness: 'authorization-required', membershipReady: false} }
function list(listNodeId: string, name: string, visibility: 'public' | 'private', reportedItemCount: number, importStatus: 'complete' | 'partial'): NativeListRecord {
  return {githubUserId: '42', listNodeId, name, description: null, visibility, slug: null, createdAt: null, updatedAt: null, lastAddedAt: null, reportedItemCount, importedItemCount: 0, importStatus, lastObservedAt: now}
}
function createOperation(): NativeListLifecycleOperationRecord {
  return {githubUserId: '42', operationId: 'op-one', intent: {kind: 'create', name: 'Ideas', visibility: 'public'}, phase: 'queued', attemptCount: 0, candidateListNodeId: null, confirmationFingerprint: null, lastError: null, createdAt: now, updatedAt: now, completedAt: null}
}
function dashboardState(): AppState {
  return {phase: 'ready', identity: {githubUserId: '42', userNodeId: 'U_one', login: 'octocat', avatarUrl: 'https://example.test/avatar'}, authorization: null, writeAuthorization: readyWriteAuthorization(), sync: null, nativeListSync: null, triageCounts: null, library: {repositories: [], nativeLists: [], nativeMemberships: [], annotations: []}, mutations: {batches: [], jobs: [], history: []}, error: null}
}
