import {describe, expect, test} from 'bun:test'
import {AuthController} from '../../src/auth/controller'
import type {AuthStore} from '../../src/auth/store'
import {
  DeviceAuthorizationFailure
} from '../../src/auth/device-flow'
import type {
  AuthStateRecord,
  GitHubUserId
} from '../../src/domain/types'

const grant = {
  deviceCode: 'device-secret',
  userCode: 'ABCD-EFGH',
  verificationUri: 'https://github.com/login/device',
  expiresAt: '2026-08-03T12:15:00.000Z',
  intervalSeconds: 5
} as const

describe('authentication controller', () => {
  test('exposes only public device and identity state', async () => {
    const completion = deferred<ReturnType<typeof completedAuthorization>>()
    const store = new ControllerAuthStore(null, false)
    const controller = new AuthController(
      {
        requestAuthorization: async () => grant,
        completeAuthorization: async () => completion.promise
      },
      store,
      () => Date.parse('2026-08-03T12:00:00Z')
    )

    expect((await controller.getState()).phase).toBe('first-run')
    const pending = await controller.startAuthorization()
    expect(pending).toMatchObject({
      phase: 'authorization-pending',
      authorization: {userCode: 'ABCD-EFGH'}
    })
    expect(JSON.stringify(pending)).not.toContain('device-secret')

    completion.resolve(completedAuthorization())
    await waitForState(controller, 'ready')
    const ready = await controller.getState()
    expect(ready.identity?.login).toBe('jolo-dev')
    expect(JSON.stringify(ready)).not.toContain('access-secret')
    expect(JSON.stringify(ready)).not.toContain('refresh-secret')
  })

  test('presents denied and cancelled authorization states', async () => {
    const denied = new AuthController(
      {
        requestAuthorization: async () => grant,
        completeAuthorization: async () => {
          throw new DeviceAuthorizationFailure(
            'denied',
            'GitHub authorization was denied.',
            true
          )
        }
      },
      new ControllerAuthStore(null, false)
    )
    await denied.startAuthorization()
    expect((await waitForState(denied, 'authorization-denied')).error?.message).toBe(
      'GitHub authorization was denied.'
    )

    const cancelled = new AuthController(
      {
        requestAuthorization: async () => grant,
        completeAuthorization: (_grant, signal) =>
          new Promise((_resolve, reject) => {
            signal.addEventListener('abort', () => reject(new Error('aborted')), {
              once: true
            })
          })
      },
      new ControllerAuthStore(null, false)
    )
    await cancelled.startAuthorization()
    expect((await cancelled.cancelAuthorization()).phase).toBe('first-run')
  })

  test('restores retained namespaces as signed out after disconnect', async () => {
    const store = new ControllerAuthStore(authState(), true)
    const controller = new AuthController(
      {
        requestAuthorization: async () => grant,
        completeAuthorization: async () => completedAuthorization()
      },
      store
    )
    expect((await controller.getState()).phase).toBe('ready')
    expect((await controller.disconnect()).phase).toBe('signed-out')
    expect(store.state).toBeNull()
  })
})

class ControllerAuthStore implements AuthStore {
  state: AuthStateRecord | null
  readonly #retained: boolean

  constructor(state: AuthStateRecord | null, retained: boolean) {
    this.state = state
    this.#retained = retained
  }

  loadActive(): Promise<AuthStateRecord | null> {
    return Promise.resolve(this.state)
  }

  hasRetainedData(): Promise<boolean> {
    return Promise.resolve(this.#retained)
  }

  saveActive(state: AuthStateRecord): Promise<void> {
    this.state = state
    return Promise.resolve()
  }

  replaceIfGeneration(
    expectedGeneration: number,
    state: AuthStateRecord
  ): Promise<boolean> {
    if (this.state?.credentials.generation !== expectedGeneration) {
      return Promise.resolve(false)
    }
    this.state = state
    return Promise.resolve(true)
  }

  clearIfGeneration(
    githubUserId: GitHubUserId,
    expectedGeneration: number
  ): Promise<boolean> {
    if (
      this.state?.githubUserId !== githubUserId ||
      this.state.credentials.generation !== expectedGeneration
    ) {
      return Promise.resolve(false)
    }
    this.state = null
    return Promise.resolve(true)
  }

  disconnect(): Promise<void> {
    this.state = null
    return Promise.resolve()
  }
}

function completedAuthorization() {
  return {
    identity: authState().identity,
    credentials: authState().credentials
  }
}

function authState(): AuthStateRecord {
  return {
    githubUserId: '42',
    identity: {
      githubUserId: '42',
      userNodeId: 'U_fixture',
      login: 'jolo-dev',
      avatarUrl: 'https://avatars.githubusercontent.com/u/42'
    },
    credentials: {
      accessToken: 'access-secret',
      refreshToken: 'refresh-secret',
      accessTokenExpiresAt: '2026-08-03T20:00:00Z',
      refreshTokenExpiresAt: '2027-02-03T12:00:00Z',
      generation: 1
    },
    authenticatedAt: '2026-08-03T12:00:00Z',
    refreshedAt: '2026-08-03T12:00:00Z'
  }
}

async function waitForState(
  controller: AuthController,
  phase: Awaited<ReturnType<AuthController['getState']>>['phase']
) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const state = await controller.getState()
    if (state.phase === phase) return state
    await Promise.resolve()
  }
  throw new Error(`Authentication state did not reach ${phase}.`)
}

function deferred<T>() {
  let resolvePromise: (value: T) => void = () => undefined
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve
  })
  return {promise, resolve: resolvePromise}
}
