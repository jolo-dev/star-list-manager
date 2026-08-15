import {describe, expect, test} from 'bun:test'
import {AppFailure} from '../../src/shared/errors'
import type {AppState, WriteAuthorizationState} from '../../src/shared/messages'
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
    const services = runtimeServices({
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
  })

  test('rejects signed-out, mismatched, and write-unready accounts before calling rename', async () => {
    for (const scenario of [
      runtimeServices({active: null}),
      runtimeServices({
        active: {githubUserId: '42', identity: {githubUserId: 'different'}}
      }),
      runtimeServices({writeAuthorization: authorizationRequired()})
    ]) {
      let calls = 0
      const services = {
        ...scenario,
        nativeListRename: {
          rename: async () => {
            calls += 1
          }
        }
      }

      const response = await handleNativeListRename(services, request, {
        capabilityProven: true,
        getDashboardState: async () => dashboardState('Original List')
      })

      expect(response.ok).toBe(false)
      expect(calls).toBe(0)
    }
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
})

interface RuntimeServiceOverrides {
  readonly active?: Awaited<ReturnType<NativeListRenameRuntimeServices['authSession']['loadActive']>>
  readonly writeAuthorization?: WriteAuthorizationState
  readonly rename?: NativeListRenameRuntimeServices['nativeListRename']['rename']
}

function runtimeServices(
  overrides: RuntimeServiceOverrides = {}
): NativeListRenameRuntimeServices {
  return {
    authSession: {
      loadActive: async () =>
        overrides.active === undefined
          ? {githubUserId: '42', identity: {githubUserId: '42'}}
          : overrides.active
    },
    writeAuthController: {
      getState: async () => overrides.writeAuthorization ?? readyWriteAuthorization()
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
