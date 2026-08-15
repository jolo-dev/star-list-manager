import {describe, expect, test} from 'bun:test'
import {AppFailure} from '../../src/shared/errors'
import type {AppState, WriteAuthorizationState} from '../../src/shared/messages'
import {NativeListRenameServiceFailure} from '../../src/sync/native-list-rename-service'
import {
  handleNativeListRename,
  nativeListRenameReadiness,
  type NativeListRenameRuntimeServices
} from '../../src/background-runtime'

const request = {
  type: 'rename-native-list' as const,
  listNodeId: 'L_fixture',
  name: '  Renamed List  '
}

describe('native List rename background runtime', () => {
  test('keeps rename independently capability-gated and never calls the service while unproven', async () => {
    let calls = 0
    let authLoads = 0
    const services = runtimeServices({
      loadActive: async () => {
        authLoads += 1
        return {githubUserId: '42', identity: {githubUserId: '42'}}
      },
      rename: async () => {
        calls += 1
      }
    })

    expect(nativeListRenameReadiness(false, readyWriteAuthorization())).toBe(
      'capability-unproven'
    )
    expect(nativeListRenameReadiness(true, readyWriteAuthorization())).toBe('ready')

    const response = await handleNativeListRename(services, request, {
      capabilityProven: false,
      getDashboardState: async () => dashboardState('Original List')
    })

    expect(response).toEqual({
      ok: false,
      error: {
        category: 'unsupported',
        message:
          'Native List rename has not passed the disposable capability probe in this build.',
        retryable: false
      }
    })
    expect(calls).toBe(0)
    expect(authLoads).toBe(0)
  })

  test('rejects a signed-out account before calling rename', async () => {
    let calls = 0
    const services = runtimeServices({
      active: null,
      rename: async () => {
        calls += 1
      }
    })

    const response = await handleNativeListRename(services, request, {
      capabilityProven: true,
      getDashboardState: async () => dashboardState('Original List')
    })

    expect(response).toEqual({
      ok: false,
      error: {
        category: 'authentication',
        message: 'Connect GitHub before renaming a native List.',
        retryable: false
      }
    })
    expect(calls).toBe(0)
  })

  test('rejects an identity-mismatched account before calling rename', async () => {
    let calls = 0
    const services = runtimeServices({
      active: {githubUserId: '42', identity: {githubUserId: 'different'}},
      rename: async () => {
        calls += 1
      }
    })

    const response = await handleNativeListRename(services, request, {
      capabilityProven: true,
      getDashboardState: async () => dashboardState('Original List')
    })

    expect(response).toEqual({
      ok: false,
      error: {
        category: 'authentication',
        message: 'The active GitHub account changed. Retry the native List rename.',
        retryable: true
      }
    })
    expect(calls).toBe(0)
  })

  test('rejects a write-unready account before calling rename', async () => {
    let calls = 0
    const services = runtimeServices({
      writeAuthorization: authorizationRequired(),
      rename: async () => {
        calls += 1
      }
    })

    expect(nativeListRenameReadiness(true, authorizationRequired())).toBe(
      'write-authorization-required'
    )

    const response = await handleNativeListRename(services, request, {
      capabilityProven: true,
      getDashboardState: async () => dashboardState('Original List')
    })

    expect(response).toEqual({
      ok: false,
      error: {
        category: 'authentication',
        message: 'Authorize GitHub native List rename before continuing.',
        retryable: true
      }
    })
    expect(calls).toBe(0)
  })

  test('calls the verified owner-bound rename exactly once and returns freshly assembled state', async () => {
    const requests: unknown[] = []
    let persistedName = 'Original List'
    const services = runtimeServices({
      rename: async (renameRequest) => {
        requests.push(renameRequest)
        persistedName = 'Renamed List'
      }
    })

    const response = await handleNativeListRename(services, request, {
      capabilityProven: true,
      getDashboardState: async () => dashboardState(persistedName)
    })

    expect(requests).toEqual([
      {
        expectedGitHubUserId: '42',
        listNodeId: 'L_fixture',
        name: '  Renamed List  '
      }
    ])
    expect(response).toEqual({ok: true, data: dashboardState('Renamed List')})
  })

  test('surfaces a reconciling service error without overwriting authoritative local state', async () => {
    let persistedName = 'Original List'
    const services = runtimeServices({
      rename: async () => {
        persistedName = 'Observed externally renamed List'
        throw new AppFailure({
          category: 'validation',
          message: 'GitHub did not verify the requested native List name.',
          retryable: true
        })
      }
    })

    const response = await handleNativeListRename(services, request, {
      capabilityProven: true,
      getDashboardState: async () => dashboardState(persistedName)
    })

    expect(response).toEqual({
      ok: false,
      error: {
        category: 'validation',
        message: 'GitHub did not verify the requested native List name.',
        retryable: true
      }
    })
    expect(persistedName).toBe('Observed externally renamed List')
  })

  test('returns refreshed dashboard state with a typed reconciled rename failure', async () => {
    let dashboardReads = 0
    const services = runtimeServices({
      rename: async () => {
        throw new NativeListRenameServiceFailure('read-back-name-mismatch', {
          category: 'validation',
          message: 'GitHub did not verify the requested native List name.',
          retryable: true
        })
      }
    })

    const response = await handleNativeListRename(services, request, {
      capabilityProven: true,
      getDashboardState: async () => {
        dashboardReads += 1
        return dashboardState('Observed externally renamed List')
      }
    })

    expect(response).toEqual({
      ok: false,
      data: dashboardState('Observed externally renamed List'),
      error: {
        category: 'validation',
        message: 'GitHub did not verify the requested native List name.',
        retryable: true
      }
    })
    expect(dashboardReads).toBe(1)
  })

  test('keeps a typed reconciled rename failure error-only when dashboard refresh fails', async () => {
    const services = runtimeServices({
      rename: async () => {
        throw new NativeListRenameServiceFailure('read-back-target-missing', {
          category: 'validation',
          message: 'GitHub no longer reports the renamed native List.',
          retryable: true
        })
      }
    })

    const response = await handleNativeListRename(services, request, {
      capabilityProven: true,
      getDashboardState: async () => {
        throw new Error('secret dashboard refresh failure')
      }
    })

    expect(response).toEqual({
      ok: false,
      error: {
        category: 'validation',
        message: 'GitHub no longer reports the renamed native List.',
        retryable: true
      }
    })
  })

  test('reports verified completion without retry when dashboard refresh fails', async () => {
    let calls = 0
    let persistedName = 'Original List'
    const services = runtimeServices({
      rename: async () => {
        calls += 1
        persistedName = 'Renamed List'
      }
    })

    const response = await handleNativeListRename(services, request, {
      capabilityProven: true,
      getDashboardState: async () => {
        throw new Error('secret dashboard refresh failure')
      }
    })

    expect(response).toEqual({
      ok: false,
      error: {
        category: 'network',
        message:
          'Native List rename succeeded, but the dashboard state could not be refreshed. Reload to view the verified result.',
        retryable: false
      }
    })
    expect(calls).toBe(1)
    expect(persistedName).toBe('Renamed List')
  })

  test('sanitizes pre-dispatch dependency failures without calling rename', async () => {
    for (const services of [
      runtimeServices({
        loadActive: async () => {
          throw new Error('secret auth failure')
        }
      }),
      runtimeServices({
        getWriteAuthorization: async () => {
          throw new Error('secret write authorization failure')
        }
      }),
      runtimeServices({
        loadActive: (() => {
          let loads = 0
          return async () => {
            loads += 1
            if (loads === 2) throw new Error('secret account revalidation failure')
            return {githubUserId: '42', identity: {githubUserId: '42'}}
          }
        })()
      })
    ]) {
      let calls = 0
      const response = await handleNativeListRename(
        {
          ...services,
          nativeListRename: {
            rename: async () => {
              calls += 1
            }
          }
        },
        request,
        {
          capabilityProven: true,
          getDashboardState: async () => dashboardState('Original List')
        }
      )

      expect(response).toEqual({
        ok: false,
        error: {
          category: 'network',
          message: 'An unexpected error occurred.',
          retryable: true
        }
      })
      expect(calls).toBe(0)
    }
  })
})

interface RuntimeServiceOverrides {
  readonly active?: Awaited<ReturnType<NativeListRenameRuntimeServices['authSession']['loadActive']>>
  readonly loadActive?: NativeListRenameRuntimeServices['authSession']['loadActive']
  readonly writeAuthorization?: WriteAuthorizationState
  readonly getWriteAuthorization?: NativeListRenameRuntimeServices['writeAuthController']['getState']
  readonly rename?: NativeListRenameRuntimeServices['nativeListRename']['rename']
}

function runtimeServices(
  overrides: RuntimeServiceOverrides = {}
): NativeListRenameRuntimeServices {
  return {
    authSession: {
      loadActive:
        overrides.loadActive ??
        (async () =>
          overrides.active === undefined
            ? {githubUserId: '42', identity: {githubUserId: '42'}}
            : overrides.active)
    },
    writeAuthController: {
      getState:
        overrides.getWriteAuthorization ??
        (async () => overrides.writeAuthorization ?? readyWriteAuthorization())
    },
    nativeListRename: {
      rename: overrides.rename ?? (async () => undefined)
    }
  }
}

function readyWriteAuthorization(): WriteAuthorizationState {
  return {
    readiness: 'ready',
    membershipReady: true,
    previewVisible: false,
    authorization: null,
    error: null
  }
}

function authorizationRequired(): WriteAuthorizationState {
  return {
    ...readyWriteAuthorization(),
    readiness: 'authorization-required',
    membershipReady: false
  }
}

function dashboardState(name: string): AppState {
  return {
    phase: 'ready',
    identity: {
      githubUserId: '42',
      userNodeId: 'U_fixture',
      login: 'octocat',
      avatarUrl: 'https://example.test/avatar.png'
    },
    authorization: null,
    writeAuthorization: readyWriteAuthorization(),
    nativeListRename: {readiness: 'ready'},
    sync: null,
    nativeListSync: null,
    triageCounts: null,
    library: {
      repositories: [],
      nativeLists: [
        {
          githubUserId: '42',
          listNodeId: 'L_fixture',
          name,
          description: null,
          visibility: 'private',
          slug: 'fixture',
          createdAt: '2026-08-15T00:00:00.000Z',
          updatedAt: '2026-08-15T00:00:00.000Z',
          lastAddedAt: null,
          reportedItemCount: 0,
          importedItemCount: 0,
          importStatus: 'complete',
          lastObservedAt: '2026-08-15T00:00:00.000Z'
        }
      ],
      nativeMemberships: [],
      annotations: []
    },
    mutations: {batches: [], jobs: [], history: []},
    error: null
  }
}
