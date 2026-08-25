import {describe, expect, test} from 'bun:test'
import type {NativeListLifecycleOperationRecord, NativeListRecord} from '../../src/domain/types'
import type {AppState, WriteAuthorizationState} from '../../src/shared/messages'
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

    const dispatched = runtimeServices({activeOperation: {...operation, phase: 'preflight'}})
    const rejected = await handleNativeListLifecycle(dispatched.services, {
      type: 'cancel-native-list-lifecycle'
    }, {capabilityProven: true, getDashboardState: dispatched.dashboard})
    expect(rejected.ok).toBe(false)
    expect(dispatched.persisted).toEqual([])
    expect(dispatched.runnerCalls).toBe(0)
  })
})

interface Overrides {
  readonly active?: {readonly githubUserId: string; readonly identity: {readonly githubUserId: string}} | null
  readonly writeAuthorization?: WriteAuthorizationState
  readonly activeOperation?: NativeListLifecycleOperationRecord | null
}

function runtimeServices(overrides: Overrides = {}) {
  const persisted: NativeListLifecycleOperationRecord[] = []
  const events: string[] = []
  let activeOperation = overrides.activeOperation ?? null
  let runnerCalls = 0
  const catalog = [list('UL_one', 'Ideas', 'private', 2, 'partial')]
  const services: NativeListLifecycleRuntimeServices = {
    authSession: {loadActive: async () => overrides.active === undefined ? {githubUserId: '42', identity: {githubUserId: '42'}} : overrides.active},
    writeAuthController: {getState: async () => overrides.writeAuthorization ?? readyWriteAuthorization()},
    nativeListSync: {
      observeCatalog: async (_userId, ids) => ({githubUserId: '42', complete: true, targets: new Map(ids.map((id) => [id, id === 'UL_one' ? {
        listNodeId: 'UL_one', name: 'Ideas', description: null, isPrivate: true, slug: null, createdAt: null, updatedAt: null, lastAddedAt: null, reportedItemCount: 2
      } : null])), fingerprint: 'catalog', rateLimit: {limit: 5000, remaining: 4999, resetAt: null}}),
      synchronize: async () => ({phase: 'complete'})
    },
    lifecycleStorage: {
      getActive: async () => activeOperation,
      put: async (operation) => { events.push('persist'); persisted.push(operation); activeOperation = operation },
      listCatalog: async () => catalog
    },
    nativeListLifecycleRunner: {
      run: async () => { events.push('run'); runnerCalls += 1 },
      operation: async () => activeOperation
    }
  }
  return {services, persisted, events, get runnerCalls() { return runnerCalls }, dashboard: async () => dashboardState()}
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
