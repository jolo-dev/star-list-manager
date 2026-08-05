import {describe, expect, test} from 'bun:test'
import {AuthSession} from '../../src/auth/session'
import type {AuthStore} from '../../src/auth/store'
import {
  RefreshTokenRejectedFailure
} from '../../src/auth/device-flow'
import type {
  AuthStateRecord,
  GitHubUserId,
  TokenPair
} from '../../src/domain/types'
import {AppFailure} from '../../src/shared/errors'

const now = Date.parse('2026-08-03T12:00:00Z')

describe('authenticated session', () => {
  test('invokes authenticated fetch without a session-object receiver', async () => {
    let receiver: unknown = 'not-called'
    const store = new MemoryAuthStore(authStateFixture(1, '2026-08-03T20:00:00Z'))
    const session = new AuthSession({
      store,
      now: () => now,
      refresher: {
        refreshCredentials: async (_refreshToken, generation) =>
          tokenPairFixture(generation + 1)
      },
      fetch: async function (this: unknown): Promise<Response> {
        receiver = this
        return new Response(null, {status: 200})
      }
    })

    await session.authenticatedFetch('https://api.github.com/user')
    expect(receiver).toBeUndefined()
  })

  test('coalesces concurrent refreshes and rotates the token pair once', async () => {
    const store = new MemoryAuthStore(authStateFixture(1, '2026-08-03T11:59:00Z'))
    let refreshCount = 0
    const authorizationHeaders: string[] = []
    const session = new AuthSession({
      store,
      now: () => now,
      refresher: {
        refreshCredentials: async (_refreshToken, generation) => {
          refreshCount += 1
          await Promise.resolve()
          return tokenPairFixture(generation + 1)
        }
      },
      fetch: async (_input, init) => {
        authorizationHeaders.push(new Headers(init?.headers).get('authorization') ?? '')
        return new Response(null, {status: 200})
      }
    })

    await Promise.all([
      session.authenticatedFetch('https://api.github.com/user'),
      session.authenticatedFetch('https://api.github.com/user')
    ])

    expect(refreshCount).toBe(1)
    expect(store.state?.credentials.generation).toBe(2)
    expect(authorizationHeaders).toEqual(['Bearer access-2', 'Bearer access-2'])
  })

  test('does not clear a newer pair when an older refresh is rejected', async () => {
    const store = new MemoryAuthStore(authStateFixture(1, '2026-08-03T11:59:00Z'))
    const session = new AuthSession({
      store,
      now: () => now,
      refresher: {
        refreshCredentials: async () => {
          store.state = authStateFixture(2, '2026-08-03T20:00:00Z')
          throw new RefreshTokenRejectedFailure()
        }
      }
    })

    await expect(
      session.authenticatedFetch('https://api.github.com/user')
    ).rejects.toBeInstanceOf(RefreshTokenRejectedFailure)
    expect(store.state?.credentials.generation).toBe(2)
  })

  test('retries one unauthorized request and clears only the rejected current pair', async () => {
    const store = new MemoryAuthStore(authStateFixture(1, '2026-08-03T20:00:00Z'))
    let requestCount = 0
    const session = new AuthSession({
      store,
      now: () => now,
      refresher: {
        refreshCredentials: async (_refreshToken, generation) =>
          tokenPairFixture(generation + 1)
      },
      fetch: async () => {
        requestCount += 1
        return new Response(null, {status: 401})
      }
    })

    await expect(
      session.authenticatedFetch('https://api.github.com/user')
    ).rejects.toMatchObject({publicError: {status: 401}})
    expect(requestCount).toBe(2)
    expect(store.state).toBeNull()
  })

  test('retains credentials after a transient refresh failure', async () => {
    const store = new MemoryAuthStore(authStateFixture(1, '2026-08-03T11:59:00Z'))
    const session = new AuthSession({
      store,
      now: () => now,
      refresher: {
        refreshCredentials: async () => {
          throw new AppFailure({
            category: 'network',
            message: 'GitHub is temporarily unavailable.',
            retryable: true
          })
        }
      }
    })

    await expect(
      session.authenticatedFetch('https://api.github.com/user')
    ).rejects.toBeInstanceOf(AppFailure)
    expect(store.state?.credentials.generation).toBe(1)
  })
})

class MemoryAuthStore implements AuthStore {
  state: AuthStateRecord | null

  constructor(state: AuthStateRecord | null) {
    this.state = state
  }

  loadActive(): Promise<AuthStateRecord | null> {
    return Promise.resolve(this.state)
  }

  hasRetainedData(): Promise<boolean> {
    return Promise.resolve(false)
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

function authStateFixture(
  generation: number,
  accessTokenExpiresAt: string
): AuthStateRecord {
  return {
    githubUserId: '42',
    identity: {
      githubUserId: '42',
      userNodeId: 'U_fixture',
      login: 'jolo-dev',
      avatarUrl: 'https://avatars.githubusercontent.com/u/42'
    },
    credentials: {
      ...tokenPairFixture(generation),
      accessTokenExpiresAt
    },
    authenticatedAt: '2026-08-03T10:00:00Z',
    refreshedAt: '2026-08-03T10:00:00Z'
  }
}

function tokenPairFixture(generation: number): TokenPair {
  return {
    accessToken: `access-${generation}`,
    refreshToken: `refresh-${generation}`,
    accessTokenExpiresAt: '2026-08-03T20:00:00Z',
    refreshTokenExpiresAt: '2027-02-03T12:00:00Z',
    generation
  }
}
