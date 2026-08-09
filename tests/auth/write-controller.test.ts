import {describe, expect, test} from 'bun:test'
import {WriteAuthController} from '../../src/auth/write-controller'
import type {AuthStateRecord, GitHubUserId, WriteAuthStateRecord} from '../../src/domain/types'
import type {WriteAuthStore} from '../../src/auth/write-store'
import {WriteDeviceAuthorizationFailure} from '../../src/auth/write-device-flow'

const grant = {
  deviceCode: 'device-secret',
  userCode: 'ABCD-EFGH',
  verificationUri: 'https://github.com/login/device',
  expiresAt: '2026-08-04T12:15:00.000Z',
  intervalSeconds: 5
} as const

describe('write authorization controller', () => {
  test('shows disclosure before starting and exposes no device secret', async () => {
    const store = new MemoryWriteStore()
    const read = new MemoryReadStore(readState('42'))
    const completion = deferred<WriteAuthStateRecord>()
    const controller = new WriteAuthController(
      {
        requestAuthorization: async () => grant,
        completeAuthorization: async () => completion.promise
      },
      read,
      store
    )

    expect(await controller.showPreview()).toMatchObject({
      readiness: 'authorization-required',
      previewVisible: true
    })
    const pending = await controller.startAuthorization()
    expect(pending).toMatchObject({readiness: 'pending', authorization: {userCode: 'ABCD-EFGH'}})
    expect(JSON.stringify(pending)).not.toContain('device-secret')

    completion.resolve(writeState('42'))
    expect(await waitForReadiness(controller, 'ready')).toMatchObject({
      readiness: 'ready',
      membershipReady: true
    })
    expect(await store.loadAccount('42')).toEqual(writeState('42'))
  })

  test('cancellation stores nothing and preserves read authentication', async () => {
    const store = new MemoryWriteStore()
    const read = new MemoryReadStore(readState('42'))
    const controller = new WriteAuthController(
      {
        requestAuthorization: async () => grant,
        completeAuthorization: (_grant, _expected, signal) =>
          new Promise((_resolve, reject) => {
            signal.addEventListener('abort', () => reject(new Error('aborted')), {once: true})
          })
      },
      read,
      store
    )
    await controller.startAuthorization()

    expect(await controller.cancelAuthorization()).toMatchObject({
      readiness: 'authorization-required'
    })
    expect(read.state?.githubUserId).toBe('42')
    expect(await store.loadAccount('42')).toBeNull()
  })

  test('rejects late completion after account switching', async () => {
    const store = new MemoryWriteStore()
    const read = new MemoryReadStore(readState('42'))
    const completion = deferred<WriteAuthStateRecord>()
    const controller = new WriteAuthController(
      {
        requestAuthorization: async () => grant,
        completeAuthorization: async () => completion.promise
      },
      read,
      store
    )
    await controller.startAuthorization()
    read.state = readState('84')
    completion.resolve(writeState('42'))

    expect((await waitForReadiness(controller, 'authorization-required')).error?.message).toContain(
      'active GitHub account changed'
    )
    expect(await store.loadAccount('42')).toBeNull()
    expect(await store.loadAccount('84')).toBeNull()
  })

  test('maps scope, account, and credential failures to non-secret readiness', async () => {
    for (const [reason, readiness] of [
      ['scope-denied', 'scope-denied'],
      ['account-mismatch', 'account-mismatch'],
      ['credential-rejected', 'credential-rejected']
    ] as const) {
      const controller = new WriteAuthController(
        {
          requestAuthorization: async () => grant,
          completeAuthorization: async () => {
            throw new WriteDeviceAuthorizationFailure(reason)
          }
        },
        new MemoryReadStore(readState('42')),
        new MemoryWriteStore()
      )
      await controller.startAuthorization()
      const state = await waitForReadiness(controller, readiness)
      expect(JSON.stringify(state)).not.toContain('device-secret')
    }
  })

  test('disconnect removes only the active write credential', async () => {
    const store = new MemoryWriteStore([writeState('42'), writeState('84')])
    const read = new MemoryReadStore(readState('42'))
    const controller = new WriteAuthController(
      {
        requestAuthorization: async () => grant,
        completeAuthorization: async () => writeState('42')
      },
      read,
      store
    )

    expect((await controller.getState()).readiness).toBe('ready')
    await controller.disconnectCurrent()
    expect(await store.loadAccount('42')).toBeNull()
    expect(await store.loadAccount('84')).not.toBeNull()
    expect(read.state?.githubUserId).toBe('42')
  })

  test('keeps a stored public_repo-only credential ready only for Starring', async () => {
    const controller = new WriteAuthController(
      {
        requestAuthorization: async () => grant,
        completeAuthorization: async () => writeState('42')
      },
      new MemoryReadStore(readState('42')),
      new MemoryWriteStore([writeState('42', ['public_repo'])])
    )

    expect(await controller.getState()).toMatchObject({
      readiness: 'ready',
      membershipReady: false
    })
  })

  test('does not store a newly completed authorization unless both scopes are present', async () => {
    const store = new MemoryWriteStore()
    const controller = new WriteAuthController(
      {
        requestAuthorization: async () => grant,
        completeAuthorization: async () => writeState('42', ['public_repo'])
      },
      new MemoryReadStore(readState('42')),
      store
    )

    await controller.startAuthorization()
    expect(await waitForReadiness(controller, 'scope-denied')).toMatchObject({
      membershipReady: false
    })
    expect(await store.loadAccount('42')).toBeNull()
  })
})

class MemoryReadStore {
  state: AuthStateRecord | null

  constructor(state: AuthStateRecord | null) {
    this.state = state
  }

  loadActive(): Promise<AuthStateRecord | null> {
    return Promise.resolve(this.state)
  }
}

class MemoryWriteStore implements WriteAuthStore {
  readonly #states = new Map<GitHubUserId, WriteAuthStateRecord>()

  constructor(states: readonly WriteAuthStateRecord[] = []) {
    for (const state of states) this.#states.set(state.githubUserId, state)
  }

  save(state: WriteAuthStateRecord): Promise<void> {
    this.#states.set(state.githubUserId, state)
    return Promise.resolve()
  }

  loadCurrent(): Promise<WriteAuthStateRecord | null> {
    return Promise.resolve(null)
  }

  loadAccount(githubUserId: GitHubUserId): Promise<WriteAuthStateRecord | null> {
    return Promise.resolve(this.#states.get(githubUserId) ?? null)
  }

  deleteCurrent(): Promise<void> {
    return Promise.resolve()
  }

  deleteAccount(githubUserId: GitHubUserId): Promise<void> {
    this.#states.delete(githubUserId)
    return Promise.resolve()
  }

  clearAll(): Promise<void> {
    this.#states.clear()
    return Promise.resolve()
  }
}

function readState(githubUserId: GitHubUserId): AuthStateRecord {
  return {
    githubUserId,
    identity: {
      githubUserId,
      userNodeId: `U_${githubUserId}`,
      login: `account-${githubUserId}`,
      avatarUrl: 'https://avatars.githubusercontent.com/u/42'
    },
    credentials: {
      accessToken: 'read-access',
      refreshToken: 'read-refresh',
      accessTokenExpiresAt: '2026-08-04T20:00:00Z',
      refreshTokenExpiresAt: '2027-02-04T12:00:00Z',
      generation: 1
    },
    authenticatedAt: '2026-08-04T12:00:00Z',
    refreshedAt: '2026-08-04T12:00:00Z'
  }
}

function writeState(
  githubUserId: GitHubUserId,
  grantedScopes: readonly string[] = ['public_repo', 'user']
): WriteAuthStateRecord {
  return {
    githubUserId,
    identity: readState(githubUserId).identity,
    credential: {
      accessToken: 'write-access',
      tokenType: 'bearer',
      grantedScopes
    },
    authorizedAt: '2026-08-04T12:00:00Z',
    lastFailure: null
  }
}

async function waitForReadiness(
  controller: WriteAuthController,
  readiness: Awaited<ReturnType<WriteAuthController['getState']>>['readiness']
) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const state = await controller.getState()
    if (state.readiness === readiness) return state
    await Promise.resolve()
  }
  throw new Error(`Write authorization did not reach ${readiness}.`)
}

function deferred<T>() {
  let resolvePromise: (value: T) => void = () => undefined
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve
  })
  return {promise, resolve: resolvePromise}
}
