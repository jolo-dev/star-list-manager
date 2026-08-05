import {describe, expect, test} from 'bun:test'
import type {AuthStore} from '../../src/auth/store'
import type {
  AuthStateRecord,
  GitHubUserId,
  WriteAuthStateRecord
} from '../../src/domain/types'
import {
  StarringOperation,
  StarringWriteSession,
  type StarringWriteStore
} from '../../src/github/starring-write-session'
import {sanitizeError} from '../../src/shared/errors'

const token = 'gho_starring_secret_fixture'

describe('Starring write session', () => {
  test('uses the matching active account and returns true for starred status', async () => {
    const requests: CapturedRequest[] = []
    const writeStore = new MemoryWriteStore([writeState('42')])
    const session = createSession(authState('42'), writeStore, requests, 204)

    const starred = await session.execute({
      expectedGitHubUserId: '42',
      owner: 'jolo-dev',
      repositoryName: 'fixture',
      operation: StarringOperation.Status
    })

    expect(starred).toBe(true)
    expect(writeStore.loadedAccounts).toEqual(['42'])
    expect(requests).toHaveLength(1)
    expect(requests[0]?.url).toBe(
      'https://api.github.com/user/starred/jolo-dev/fixture'
    )
    expect(requests[0]?.headers.get('authorization')).toBe(`Bearer ${token}`)
  })

  test('calls native-compatible fetch without a receiver', async () => {
    let receiver: unknown = 'not-called'
    const session = new StarringWriteSession({
      authStore: new MemoryAuthStore(authState('42')),
      writeStore: new MemoryWriteStore([writeState('42')]),
      fetch: async function (this: unknown): Promise<Response> {
        receiver = this
        return new Response(null, {status: 204})
      }
    })

    expect(
      await session.execute({
        expectedGitHubUserId: '42',
        owner: 'jolo-dev',
        repositoryName: 'fixture',
        operation: StarringOperation.Status
      })
    ).toBe(true)
    expect(receiver).toBeUndefined()
  })

  test('rejects an account switch before loading or dispatching write credentials', async () => {
    const requests: CapturedRequest[] = []
    const writeStore = new MemoryWriteStore([writeState('42')])
    const session = createSession(authState('84'), writeStore, requests, 204)

    await expect(
      session.execute({
        expectedGitHubUserId: '42',
        owner: 'jolo-dev',
        repositoryName: 'fixture',
        operation: StarringOperation.Star
      })
    ).rejects.toMatchObject({
      publicError: {category: 'authentication', retryable: true}
    })
    expect(writeStore.loadedAccounts).toEqual([])
    expect(requests).toEqual([])
  })

  test('encodes owner and repository segments and allowlists all three methods', async () => {
    const cases: ReadonlyArray<{
      readonly operation: 'status' | 'star' | 'unstar'
      readonly method: string
      readonly status: number
      readonly result: boolean | undefined
    }> = [
      {operation: StarringOperation.Status, method: 'GET', status: 404, result: false},
      {operation: StarringOperation.Star, method: 'PUT', status: 204, result: undefined},
      {operation: StarringOperation.Unstar, method: 'DELETE', status: 204, result: undefined}
    ]

    for (const item of cases) {
      const requests: CapturedRequest[] = []
      const session = createSession(
        authState('42'),
        new MemoryWriteStore([writeState('42')]),
        requests,
        item.status
      )
      const result = await session.execute({
        expectedGitHubUserId: '42',
        owner: 'owner/name',
        repositoryName: 'repo name?#',
        operation: item.operation
      })

      expect(result).toBe(item.result)
      expect(requests[0]?.url).toBe(
        'https://api.github.com/user/starred/owner%2Fname/repo%20name%3F%23'
      )
      expect(requests[0]?.method).toBe(item.method)
    }
  })

  test('rejects missing credentials before dispatch', async () => {
    const requests: CapturedRequest[] = []
    const session = createSession(
      authState('42'),
      new MemoryWriteStore(),
      requests,
      204
    )

    await expect(
      session.execute({
        expectedGitHubUserId: '42',
        owner: 'jolo-dev',
        repositoryName: 'fixture',
        operation: StarringOperation.Star
      })
    ).rejects.toMatchObject({publicError: {category: 'authentication'}})
    expect(requests).toEqual([])
  })

  test('rejects invalid segments and operations locally', async () => {
    const requests: CapturedRequest[] = []
    const session = createSession(
      authState('42'),
      new MemoryWriteStore([writeState('42')]),
      requests,
      204
    )

    const invalidSegments = [
      {owner: '', repositoryName: 'fixture'},
      {owner: '..', repositoryName: 'fixture'},
      {owner: 'jolo-dev', repositoryName: '.'}
    ]
    for (const {owner, repositoryName} of invalidSegments) {
      await expect(
        session.execute({
          expectedGitHubUserId: '42',
          owner,
          repositoryName,
          operation: StarringOperation.Star
        })
      ).rejects.toMatchObject({publicError: {category: 'validation'}})
    }
    await expect(
      session.execute({
        expectedGitHubUserId: '42',
        owner: 'jolo-dev',
        repositoryName: 'fixture',
        operation: 'patch' as typeof StarringOperation.Star
      })
    ).rejects.toMatchObject({publicError: {category: 'validation'}})
    expect(requests).toEqual([])
  })

  test('verifies credential record ownership, identity, and required scope', async () => {
    const invalidRecords = [
      {...writeState('42'), githubUserId: '84'},
      {...writeState('42'), identity: {...writeState('42').identity, githubUserId: '84'}},
      {
        ...writeState('42'),
        credential: {...writeState('42').credential, grantedScopes: ['read:user']}
      }
    ]

    for (const record of invalidRecords) {
      const requests: CapturedRequest[] = []
      const writeStore = new MemoryWriteStore([record], '42')
      const session = createSession(authState('42'), writeStore, requests, 204)
      await expect(
        session.execute({
          expectedGitHubUserId: '42',
          owner: 'jolo-dev',
          repositoryName: 'fixture',
          operation: StarringOperation.Star
        })
      ).rejects.toBeDefined()
      expect(requests).toEqual([])
    }
  })

  test('deletes only the rejected account credential on 401', async () => {
    const writeStore = new MemoryWriteStore([writeState('42'), writeState('84')])
    const session = new StarringWriteSession({
      authStore: new MemoryAuthStore(authState('42')),
      writeStore,
      fetch: async () => new Response(`access_token=${token}`, {status: 401})
    })

    const failure = await captureFailure(
      session.execute({
        expectedGitHubUserId: '42',
        owner: 'jolo-dev',
        repositoryName: 'fixture',
        operation: StarringOperation.Unstar
      })
    )

    expect(writeStore.deletedAccounts).toEqual(['42'])
    expect(writeStore.has('42')).toBe(false)
    expect(writeStore.has('84')).toBe(true)
    expect(sanitizeError(failure)).toEqual({
      category: 'authentication',
      message: 'GitHub Starring authorization was rejected. Reauthorize write access.',
      retryable: false,
      status: 401
    })
    expect(JSON.stringify(sanitizeError(failure))).not.toContain(token)
  })

  test('retains credentials and returns fixed sanitized guidance on 403', async () => {
    const writeStore = new MemoryWriteStore([writeState('42')])
    const session = new StarringWriteSession({
      authStore: new MemoryAuthStore(authState('42')),
      writeStore,
      fetch: async () => new Response(`Bearer ${token}`, {status: 403})
    })

    const failure = await captureFailure(
      session.execute({
        expectedGitHubUserId: '42',
        owner: 'jolo-dev',
        repositoryName: 'fixture',
        operation: StarringOperation.Star
      })
    )
    const error = sanitizeError(failure)

    expect(writeStore.has('42')).toBe(true)
    expect(writeStore.deletedAccounts).toEqual([])
    expect(error).toMatchObject({
      category: 'permission',
      message: 'GitHub denied Starring access. Reauthorize with the public_repo scope.',
      status: 403
    })
    expect(JSON.stringify(error)).not.toContain(token)
  })

  test('retains credentials and rate-limit metadata without exposing response content', async () => {
    const writeStore = new MemoryWriteStore([writeState('42')])
    const session = new StarringWriteSession({
      authStore: new MemoryAuthStore(authState('42')),
      writeStore,
      fetch: async () =>
        new Response(`authorization=Bearer ${token}`, {
          status: 403,
          headers: {
            'x-ratelimit-limit': '5000',
            'x-ratelimit-remaining': '0',
            'x-ratelimit-reset': '1785762000'
          }
        })
    })

    const failure = await captureFailure(
      session.execute({
        expectedGitHubUserId: '42',
        owner: 'jolo-dev',
        repositoryName: 'fixture',
        operation: StarringOperation.Status
      })
    )
    const error = sanitizeError(failure)

    expect(writeStore.has('42')).toBe(true)
    expect(error).toMatchObject({
      category: 'rate-limit',
      message: 'GitHub Starring is rate-limited. Retry after the limit resets.',
      retryable: true,
      status: 403,
      retryAt: '2026-08-03T13:00:00.000Z'
    })
    expect(JSON.stringify(error)).not.toContain(token)
  })

  test('sanitizes thrown network errors that contain credential material', async () => {
    const session = new StarringWriteSession({
      authStore: new MemoryAuthStore(authState('42')),
      writeStore: new MemoryWriteStore([writeState('42')]),
      fetch: async () => {
        throw new Error(`Bearer ${token}`)
      }
    })

    const failure = await captureFailure(
      session.execute({
        expectedGitHubUserId: '42',
        owner: 'jolo-dev',
        repositoryName: 'fixture',
        operation: StarringOperation.Status
      })
    )

    expect(sanitizeError(failure)).toEqual({
      category: 'network',
      message: 'An unexpected error occurred.',
      retryable: true
    })
    expect(JSON.stringify(sanitizeError(failure))).not.toContain(token)
  })
})

interface CapturedRequest {
  readonly url: string
  readonly method: string
  readonly headers: Headers
}

class MemoryAuthStore implements Pick<AuthStore, 'loadActive'> {
  readonly #state: AuthStateRecord | null

  constructor(state: AuthStateRecord | null) {
    this.#state = state
  }

  loadActive(): Promise<AuthStateRecord | null> {
    return Promise.resolve(this.#state)
  }
}

class MemoryWriteStore implements StarringWriteStore {
  readonly #records = new Map<GitHubUserId, WriteAuthStateRecord>()
  readonly loadedAccounts: GitHubUserId[] = []
  readonly deletedAccounts: GitHubUserId[] = []

  constructor(records: readonly WriteAuthStateRecord[] = [], keyOverride?: GitHubUserId) {
    for (const record of records) {
      this.#records.set(keyOverride ?? record.githubUserId, record)
    }
  }

  loadAccount(githubUserId: GitHubUserId): Promise<WriteAuthStateRecord | null> {
    this.loadedAccounts.push(githubUserId)
    return Promise.resolve(this.#records.get(githubUserId) ?? null)
  }

  deleteAccount(githubUserId: GitHubUserId): Promise<void> {
    this.deletedAccounts.push(githubUserId)
    this.#records.delete(githubUserId)
    return Promise.resolve()
  }

  has(githubUserId: GitHubUserId): boolean {
    return this.#records.has(githubUserId)
  }
}

function createSession(
  active: AuthStateRecord | null,
  writeStore: MemoryWriteStore,
  requests: CapturedRequest[],
  responseStatus: number
): StarringWriteSession {
  return new StarringWriteSession({
    authStore: new MemoryAuthStore(active),
    writeStore,
    fetch: async (input, init) => {
      requests.push({
        url: String(input),
        method: init?.method ?? '',
        headers: new Headers(init?.headers)
      })
      return new Response(null, {status: responseStatus})
    }
  })
}

function authState(githubUserId: GitHubUserId): AuthStateRecord {
  return {
    githubUserId,
    identity: identity(githubUserId),
    credentials: {
      accessToken: 'read-token',
      refreshToken: 'read-refresh',
      accessTokenExpiresAt: '2026-08-04T12:00:00Z',
      refreshTokenExpiresAt: '2027-02-04T12:00:00Z',
      generation: 1
    },
    authenticatedAt: '2026-08-03T12:00:00Z',
    refreshedAt: '2026-08-03T12:00:00Z'
  }
}

function writeState(githubUserId: GitHubUserId): WriteAuthStateRecord {
  return {
    githubUserId,
    identity: identity(githubUserId),
    credential: {
      accessToken: token,
      tokenType: 'bearer',
      grantedScopes: ['public_repo']
    },
    authorizedAt: '2026-08-03T12:00:00Z',
    lastFailure: null
  }
}

function identity(githubUserId: GitHubUserId) {
  return {
    githubUserId,
    userNodeId: `U_${githubUserId}`,
    login: `user-${githubUserId}`,
    avatarUrl: `https://avatars.githubusercontent.com/u/${githubUserId}`
  }
}

async function captureFailure(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise
  } catch (error: unknown) {
    return error
  }
  throw new Error('Expected operation to fail.')
}
