import {describe, expect, test} from 'bun:test'
import type {AuthStore} from '../../src/auth/store'
import type {
  AuthStateRecord,
  GitHubUserId,
  RepositoryRecord,
  WriteAuthStateRecord
} from '../../src/domain/types'
import type {PublicStarObservation} from '../../src/github/rest-client'
import {
  SafeUnstarService,
  type SafeUnstarTarget,
  type UnstarPreparationOutcome
} from '../../src/github/safe-unstar-service'
import {
  StarringWriteSession,
  type StarringWriteStore
} from '../../src/github/starring-write-session'

const githubUserId = '42'
const token = 'gho_safe_unstar_secret_fixture'
const timestamp = '2026-08-03T12:00:00Z'
const target: SafeUnstarTarget = {
  expectedGitHubUserId: githubUserId,
  repositoryNodeId: 'R_fixture',
  owner: 'old-owner',
  repositoryName: 'old-name'
}

describe('safe unstar service', () => {
  test('resolves a rename, revalidates the current route, and uses exact credential boundaries', async () => {
    const harness = createHarness({
      publicResponses: [
        routeResponse('R_fixture', 'new-owner', 'new-name'),
        routeResponse('R_fixture', 'new-owner', 'new-name')
      ]
    })

    const outcome = await harness.service.prepare(target)

    expect(outcome).toEqual({
      kind: 'ready-to-delete',
      currentRoute: {owner: 'new-owner', repositoryName: 'new-name'}
    })
    expect(harness.publicRequests.map((request) => request.url)).toEqual([
      'https://api.github.com/repos/old-owner/old-name',
      'https://api.github.com/repos/new-owner/new-name'
    ])
    expect(harness.publicRequests.every((request) => request.method === 'GET')).toBe(true)
    expect(
      harness.publicRequests.every(
        (request) =>
          request.redirect === 'follow' && !request.headers.has('authorization')
      )
    ).toBe(true)
    expect(harness.writeRequests).toHaveLength(1)
    expect(harness.writeRequests[0]).toMatchObject({
      url: 'https://api.github.com/user/starred/new-owner/new-name',
      method: 'GET'
    })
  })

  test('calls native-compatible public fetch without a receiver', async () => {
    let receiver: unknown = 'not-called'
    const authStore = new MutableAuthStore(githubUserId)
    const service = new SafeUnstarService({
      authStore,
      writeSession: new StarringWriteSession({
        authStore,
        writeStore: new MemoryWriteStore(writeState(githubUserId)),
        fetch: async () => new Response(null, {status: 204})
      }),
      publicFetch: async function (this: unknown): Promise<Response> {
        receiver = this
        return routeResponse('R_fixture', 'old-owner', 'old-name')
      },
      starObserver: {
        observePublicStars: async () => observation([repository('R_fixture')])
      },
      observationDelayMs: 0
    })

    expect(await service.prepare(target)).toMatchObject({kind: 'ready-to-delete'})
    expect(receiver).toBeUndefined()
  })

  test('blocks a stable node mismatch before checking Starring status', async () => {
    const harness = createHarness({
      publicResponses: [routeResponse('R_other', 'old-owner', 'old-name')]
    })

    expect(await harness.service.prepare(target)).toEqual({
      kind: 'blocked-unknown',
      reason: 'node',
      statusCode: null
    })
    expect(harness.writeRequests).toEqual([])
  })

  test('blocks a route that changes again during revalidation', async () => {
    const harness = createHarness({
      publicResponses: [
        routeResponse('R_fixture', 'new-owner', 'new-name'),
        routeResponse('R_fixture', 'newer-owner', 'newer-name')
      ]
    })

    expect(await harness.service.prepare(target)).toEqual({
      kind: 'blocked-unknown',
      reason: 'route',
      statusCode: null
    })
    expect(harness.writeRequests).toEqual([])
  })

  test('requires two complete absent observations before confirming pre-delete absence', async () => {
    const harness = createHarness({
      writeResponses: [new Response(null, {status: 404})],
      observations: [observation([]), observation([])]
    })

    expect(await harness.service.prepare(target)).toEqual({
      kind: 'confirmed-already-absent',
      observationAttempts: 2
    })
    expect(harness.observedAccounts).toEqual([githubUserId, githubUserId])
  })

  test('does not treat a Starring route 404 as absence when complete observations show present', async () => {
    const harness = createHarness({
      writeResponses: [new Response(null, {status: 404})],
      observations: [
        observation([repository('R_fixture')]),
        observation([repository('R_fixture')])
      ]
    })

    expect(await harness.service.prepare(target)).toEqual({
      kind: 'ready-to-delete',
      currentRoute: {owner: 'old-owner', repositoryName: 'old-name'}
    })
  })

  test('verifies immediate absence only after two matching post-delete observations', async () => {
    const harness = createHarness({observations: [observation([]), observation([])]})

    expect(await harness.service.deleteAndVerify(target)).toEqual({
      kind: 'verified-absent',
      currentRoute: {owner: 'old-owner', repositoryName: 'old-name'},
      observationAttempts: 2
    })
    expect(harness.writeRequests.map((request) => [request.method, request.url])).toEqual([
      ['DELETE', 'https://api.github.com/user/starred/old-owner/old-name']
    ])
  })

  test('allows bounded delayed visibility before verifying absence', async () => {
    const harness = createHarness({
      observations: [
        observation([repository('R_fixture')]),
        observation([]),
        observation([])
      ]
    })

    expect(await harness.service.deleteAndVerify(target)).toMatchObject({
      kind: 'verified-absent',
      observationAttempts: 3
    })
  })

  test('blocks persistent post-delete presence and changing complete observations', async () => {
    const persistent = createHarness({
      observations: [
        observation([repository('R_fixture')]),
        observation([repository('R_fixture')])
      ]
    })
    expect(await persistent.service.deleteAndVerify(target)).toEqual({
      kind: 'blocked-unknown',
      reason: 'unstable',
      statusCode: null
    })

    const unstable = createHarness({
      maxObservationAttempts: 4,
      observations: [
        observation([repository('R_fixture')]),
        observation([repository('R_other')]),
        observation([repository('R_fixture')]),
        observation([repository('R_other')])
      ]
    })
    expect(await unstable.service.deleteAndVerify(target)).toEqual({
      kind: 'blocked-unknown',
      reason: 'unstable',
      statusCode: null
    })
  })

  test('ignores unrelated star changes when the target presence converges', async () => {
    const harness = createHarness({
      observations: [
        observation([repository('R_other-a')]),
        observation([repository('R_other-b')])
      ]
    })

    expect(await harness.service.deleteAndVerify(target)).toMatchObject({
      kind: 'verified-absent',
      observationAttempts: 2
    })
  })

  test('uses complete observations to distinguish an unavailable route from confirmed absence', async () => {
    const unavailable = createHarness({
      publicResponses: [new Response(null, {status: 404})],
      observations: [
        observation([repository('R_fixture')]),
        observation([repository('R_fixture')])
      ]
    })
    expect(await unavailable.service.prepare(target)).toEqual({
      kind: 'blocked-unknown',
      reason: 'unavailable',
      statusCode: 404
    })
    expect(unavailable.writeRequests).toEqual([])

    const absent = createHarness({
      publicResponses: [new Response(null, {status: 404})],
      observations: [observation([]), observation([])]
    })
    expect(await absent.service.prepare(target)).toEqual({
      kind: 'confirmed-already-absent',
      observationAttempts: 2
    })
  })

  test('maps malformed routes and incomplete observations to blocked-unknown', async () => {
    const malformedInput = createHarness()
    expect(
      await malformedInput.service.prepare({...target, owner: 'owner/name'})
    ).toEqual({kind: 'blocked-unknown', reason: 'route', statusCode: null})
    expect(malformedInput.publicRequests).toEqual([])

    const malformedResponse = createHarness({
      publicResponses: [
        new Response(JSON.stringify({node_id: 'R_fixture', owner: {login: 'owner'}}), {
          status: 200
        })
      ]
    })
    expect(await malformedResponse.service.prepare(target)).toEqual({
      kind: 'blocked-unknown',
      reason: 'malformed',
      statusCode: 200
    })

    const malformedObservation: PublicStarObservation = {
      ...observation([]),
      pagesProcessed: 0
    }
    const malformedStars = createHarness({
      writeResponses: [new Response(null, {status: 404})],
      observations: [malformedObservation]
    })
    expect(await malformedStars.service.prepare(target)).toEqual({
      kind: 'blocked-unknown',
      reason: 'malformed',
      statusCode: null
    })
  })

  test('maps authentication, permission, rate-limit, server, and network failures', async () => {
    const cases: ReadonlyArray<{
      readonly response: Response | Error
      readonly expected: UnstarPreparationOutcome
    }> = [
      {
        response: new Response(`access_token=${token}`, {status: 401}),
        expected: {kind: 'authentication', statusCode: 401, retryAt: null}
      },
      {
        response: new Response(`Bearer ${token}`, {status: 403}),
        expected: {kind: 'permission', statusCode: 403, retryAt: null}
      },
      {
        response: new Response(`authorization=Bearer ${token}`, {
          status: 403,
          headers: {
            'x-ratelimit-remaining': '0',
            'x-ratelimit-reset': '1785762000'
          }
        }),
        expected: {
          kind: 'rate-limit',
          statusCode: 403,
          retryAt: '2026-08-03T13:00:00.000Z'
        }
      },
      {
        response: new Response(token, {status: 503}),
        expected: {kind: 'server', statusCode: 503, retryAt: null}
      },
      {
        response: new Error(`Bearer ${token}`),
        expected: {kind: 'network', statusCode: null, retryAt: null}
      }
    ]

    for (const item of cases) {
      const harness = createHarness({writeResponses: [item.response]})
      const outcome = await harness.service.prepare(target)
      expect(outcome).toEqual(item.expected)
      expect(JSON.stringify(outcome)).not.toContain(token)
    }
  })

  test('preserves safe rate-limit timing from public route resolution', async () => {
    const harness = createHarness({
      publicResponses: [
        new Response(token, {
          status: 429,
          headers: {'x-ratelimit-reset': '1785762000'}
        })
      ]
    })

    const outcome = await harness.service.prepare(target)
    expect(outcome).toEqual({
      kind: 'rate-limit',
      statusCode: 429,
      retryAt: '2026-08-03T13:00:00.000Z'
    })
    expect(JSON.stringify(outcome)).not.toContain(token)
  })

  test('requires the owning account before every remote operation', async () => {
    const switched = createHarness({activeGitHubUserId: '84'})
    expect(await switched.service.prepare(target)).toEqual({
      kind: 'authentication',
      statusCode: null,
      retryAt: null
    })
    expect(switched.publicRequests).toEqual([])
    expect(switched.writeRequests).toEqual([])
    expect(switched.observedAccounts).toEqual([])

    const midObservation = createHarness({
      writeResponses: [new Response(null, {status: 404})],
      observations: [observation([]), observation([])]
    })
    midObservation.hooks.afterObservation = () =>
      midObservation.authStore.setActive('84')
    expect(await midObservation.service.prepare(target)).toEqual({
      kind: 'authentication',
      statusCode: null,
      retryAt: null
    })
    expect(midObservation.observedAccounts).toEqual([githubUserId])
  })

  test('observes after an ambiguous DELETE 404 instead of claiming request success', async () => {
    const harness = createHarness({
      writeResponses: [new Response(token, {status: 404})],
      observations: [observation([]), observation([])]
    })

    const outcome = await harness.service.deleteAndVerify(target)
    expect(outcome).toMatchObject({kind: 'verified-absent', observationAttempts: 2})
    expect(JSON.stringify(outcome)).not.toContain(token)
  })

  test('observes by stable node ID when the route disappears before DELETE', async () => {
    const harness = createHarness({
      publicResponses: [
        new Response(null, {status: 404}),
        new Response(null, {status: 404})
      ],
      observations: [observation([]), observation([])]
    })

    expect(await harness.service.deleteAndVerify(target)).toMatchObject({
      kind: 'verified-absent',
      observationAttempts: 2
    })
    expect(harness.writeRequests).toEqual([])
  })
})

interface CapturedRequest {
  readonly url: string
  readonly method: string
  readonly headers: Headers
  readonly redirect: RequestRedirect | undefined
}

interface HarnessOptions {
  readonly activeGitHubUserId?: GitHubUserId
  readonly publicResponses?: readonly (Response | Error)[]
  readonly writeResponses?: readonly (Response | Error)[]
  readonly observations?: readonly (PublicStarObservation | Error)[]
  readonly maxObservationAttempts?: number
}

interface Harness {
  readonly service: SafeUnstarService
  readonly authStore: MutableAuthStore
  readonly publicRequests: CapturedRequest[]
  readonly writeRequests: CapturedRequest[]
  readonly observedAccounts: GitHubUserId[]
  readonly hooks: {afterObservation: () => void}
}

function createHarness(options: HarnessOptions = {}): Harness {
  const authStore = new MutableAuthStore(options.activeGitHubUserId ?? githubUserId)
  const publicRequests: CapturedRequest[] = []
  const writeRequests: CapturedRequest[] = []
  const observedAccounts: GitHubUserId[] = []
  const publicResponses = [...(options.publicResponses ?? [])]
  const writeResponses = [...(options.writeResponses ?? [])]
  const observations = [...(options.observations ?? [])]
  const hooks = {afterObservation: () => undefined}
  const writeSession = new StarringWriteSession({
    authStore,
    writeStore: new MemoryWriteStore(writeState(githubUserId)),
    fetch: async (input, init) => {
      writeRequests.push(captureRequest(input, init))
      return nextResponse(writeResponses, new Response(null, {status: 204}))
    }
  })
  const service = new SafeUnstarService({
    authStore,
    writeSession,
    publicFetch: async (input, init) => {
      publicRequests.push(captureRequest(input, init))
      return nextResponse(
        publicResponses,
        routeResponse('R_fixture', 'old-owner', 'old-name')
      )
    },
    starObserver: {
      observePublicStars: async (account) => {
        observedAccounts.push(account)
        const result = await nextObservation(observations)
        hooks.afterObservation()
        return result
      }
    },
    now: () => Date.parse(timestamp),
    ...(options.maxObservationAttempts === undefined
      ? {}
      : {maxObservationAttempts: options.maxObservationAttempts}),
    observationDelayMs: 0
  })
  return {service, authStore, publicRequests, writeRequests, observedAccounts, hooks}
}

function captureRequest(input: RequestInfo | URL, init?: RequestInit): CapturedRequest {
  return {
    url: String(input),
    method: init?.method ?? 'GET',
    headers: new Headers(init?.headers),
    redirect: init?.redirect
  }
}

function nextResponse(responses: Array<Response | Error>, fallback: Response): Response {
  const next = responses.shift() ?? fallback
  if (next instanceof Error) throw next
  return next
}

function nextObservation(
  observations: Array<PublicStarObservation | Error>
): Promise<PublicStarObservation> {
  const next = observations.shift()
  if (!next) throw new Error('Missing public star observation fixture.')
  if (next instanceof Error) throw next
  return Promise.resolve(next)
}

function routeResponse(
  repositoryNodeId: string,
  owner: string,
  repositoryName: string
): Response {
  return new Response(
    JSON.stringify({
      node_id: repositoryNodeId,
      owner: {login: owner},
      name: repositoryName,
      private: false
    }),
    {status: 200, headers: {'content-type': 'application/json'}}
  )
}

function observation(repositories: readonly RepositoryRecord[]): PublicStarObservation {
  return {
    repositories,
    pagesProcessed: 1,
    skippedPrivateRepositories: 0,
    rateLimit: {limit: 5000, remaining: 4999, resetAt: timestamp},
    etag: '"fixture"'
  }
}

function repository(
  repositoryNodeId: string,
  account: GitHubUserId = githubUserId
): RepositoryRecord {
  return {
    githubUserId: account,
    repositoryNodeId,
    ownerLogin: 'old-owner',
    name: repositoryNodeId,
    fullName: `old-owner/${repositoryNodeId}`,
    htmlUrl: `https://github.com/old-owner/${repositoryNodeId}`,
    description: null,
    topics: [],
    primaryLanguage: null,
    starredAt: timestamp,
    pushedAt: timestamp,
    archived: false,
    disabled: false,
    isStarred: true,
    firstObservedAt: timestamp,
    lastObservedAt: timestamp,
    unstarredAt: null
  }
}

class MutableAuthStore implements Pick<AuthStore, 'loadActive'> {
  #activeGitHubUserId: GitHubUserId | null

  constructor(activeGitHubUserId: GitHubUserId | null) {
    this.#activeGitHubUserId = activeGitHubUserId
  }

  setActive(githubUserId: GitHubUserId | null): void {
    this.#activeGitHubUserId = githubUserId
  }

  loadActive(): Promise<AuthStateRecord | null> {
    return Promise.resolve(
      this.#activeGitHubUserId ? authState(this.#activeGitHubUserId) : null
    )
  }
}

class MemoryWriteStore implements StarringWriteStore {
  readonly #state: WriteAuthStateRecord

  constructor(state: WriteAuthStateRecord) {
    this.#state = state
  }

  loadAccount(githubUserId: GitHubUserId): Promise<WriteAuthStateRecord | null> {
    return Promise.resolve(this.#state.githubUserId === githubUserId ? this.#state : null)
  }

  deleteAccount(): Promise<void> {
    return Promise.resolve()
  }
}

function authState(account: GitHubUserId): AuthStateRecord {
  return {
    githubUserId: account,
    identity: identity(account),
    credentials: {
      accessToken: 'read-token',
      refreshToken: 'read-refresh',
      accessTokenExpiresAt: '2026-08-04T12:00:00Z',
      refreshTokenExpiresAt: '2027-02-04T12:00:00Z',
      generation: 1
    },
    authenticatedAt: timestamp,
    refreshedAt: timestamp
  }
}

function writeState(account: GitHubUserId): WriteAuthStateRecord {
  return {
    githubUserId: account,
    identity: identity(account),
    credential: {
      accessToken: token,
      tokenType: 'bearer',
      grantedScopes: ['public_repo']
    },
    authorizedAt: timestamp,
    lastFailure: null
  }
}

function identity(account: GitHubUserId) {
  return {
    githubUserId: account,
    userNodeId: `U_${account}`,
    login: `user-${account}`,
    avatarUrl: `https://avatars.githubusercontent.com/u/${account}`
  }
}
