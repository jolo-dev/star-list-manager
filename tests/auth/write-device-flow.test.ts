import {describe, expect, test} from 'bun:test'
import {
  GitHubWriteDeviceFlow,
  WriteDeviceAuthorizationFailure,
  toPublicWriteDeviceAuthorization
} from '../../src/auth/write-device-flow'

const startedAt = Date.parse('2026-08-04T12:00:00Z')
const deviceResponse = {
  device_code: 'device-secret',
  user_code: 'ABCD-EFGH',
  verification_uri: 'https://github.com/login/device',
  expires_in: 900,
  interval: 5
}
const identityResponse = {
  id: 42,
  node_id: 'U_fixture',
  login: 'jolo-dev',
  avatar_url: 'https://avatars.githubusercontent.com/u/42'
}

describe('GitHub OAuth write device flow', () => {
  test('requests a device code with only the public client ID and exact public_repo scope', async () => {
    let requestUrl = ''
    let requestInit: RequestInit | undefined
    let receiver: unknown = 'not-called'
    const flow = new GitHubWriteDeviceFlow({
      clientId: 'write-client-id',
      now: () => startedAt,
      fetch: async function (this: unknown, input, init): Promise<Response> {
        receiver = this
        requestUrl = String(input)
        requestInit = init
        return jsonResponse(deviceResponse)
      }
    })

    const grant = await flow.requestAuthorization(new AbortController().signal)

    expect(receiver).toBeUndefined()
    expect(requestUrl).toBe('https://github.com/login/device/code')
    expect(requestInit?.method).toBe('POST')
    expect(new Headers(requestInit?.headers).get('accept')).toBe('application/json')
    expect(new Headers(requestInit?.headers).get('content-type')).toBe(
      'application/x-www-form-urlencoded'
    )
    expect(String(requestInit?.body)).toBe('client_id=write-client-id&scope=public_repo')
    expect(String(requestInit?.body)).not.toContain('client_secret')
    expect(toPublicWriteDeviceAuthorization(grant)).toEqual({
      userCode: 'ABCD-EFGH',
      verificationUri: 'https://github.com/login/device',
      expiresAt: '2026-08-04T12:15:00.000Z',
      intervalSeconds: 5
    })
    expect(JSON.stringify(toPublicWriteDeviceAuthorization(grant))).not.toContain(
      'device-secret'
    )
  })

  test('polls through pending and slow_down, normalizes scopes, and validates identity', async () => {
    let now = startedAt
    const sleeps: number[] = []
    const requests: Array<{readonly url: string; readonly init?: RequestInit}> = []
    const responses = [
      jsonResponse(deviceResponse),
      jsonResponse({error: 'authorization_pending'}),
      jsonResponse({error: 'slow_down'}),
      jsonResponse({
        access_token: 'access-secret',
        token_type: 'Bearer',
        scope: ' user:email, PUBLIC_REPO,public_repo ',
        refresh_token: 'must-be-ignored',
        expires_in: 123
      }),
      jsonResponse(identityResponse)
    ]
    const flow = new GitHubWriteDeviceFlow({
      clientId: 'write-client-id',
      now: () => now,
      sleep: async (milliseconds) => {
        sleeps.push(milliseconds)
        now += milliseconds
      },
      fetch: async (input, init) => {
        requests.push({url: String(input), ...(init === undefined ? {} : {init})})
        return responses.shift() ?? jsonResponse({}, 500)
      }
    })
    const signal = new AbortController().signal

    const grant = await flow.requestAuthorization(signal)
    const state = await flow.completeAuthorization(grant, '42', signal)

    expect(sleeps).toEqual([5000, 5000, 10000])
    expect(state).toEqual({
      githubUserId: '42',
      identity: {
        githubUserId: '42',
        userNodeId: 'U_fixture',
        login: 'jolo-dev',
        avatarUrl: 'https://avatars.githubusercontent.com/u/42'
      },
      credential: {
        accessToken: 'access-secret',
        tokenType: 'bearer',
        grantedScopes: ['public_repo', 'user:email']
      },
      authorizedAt: '2026-08-04T12:00:20.000Z',
      lastFailure: null
    })
    expect(requests[3]?.url).toBe('https://github.com/login/oauth/access_token')
    expect(String(requests[3]?.init?.body)).toBe(
      'client_id=write-client-id&device_code=device-secret&grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Adevice_code'
    )
    expect(requests[4]?.url).toBe('https://api.github.com/user')
    expect(new Headers(requests[4]?.init?.headers).get('authorization')).toBe(
      'Bearer access-secret'
    )
    expect(JSON.stringify(state.credential)).not.toContain('must-be-ignored')
  })

  test('supports explicit cancellation without making a token request', async () => {
    const controller = new AbortController()
    let requests = 0
    const flow = new GitHubWriteDeviceFlow({
      clientId: 'write-client-id',
      fetch: async () => {
        requests += 1
        return jsonResponse(deviceResponse)
      },
      sleep: async () => {
        controller.abort('device-secret access-secret')
        throw new Error('device-secret access-secret')
      }
    })
    const grant = await flow.requestAuthorization(controller.signal)

    await expectFailure(
      flow.completeAuthorization(grant, '42', controller.signal),
      'cancelled',
      ['device-secret', 'access-secret']
    )
    expect(requests).toBe(1)
  })

  test('maps GitHub denial to a sanitized typed failure', async () => {
    const {flow, signal, grant} = await flowForTokenResponse({
      error: 'access_denied',
      error_description: 'device-secret access-secret'
    })
    await expectFailure(flow.completeAuthorization(grant, '42', signal), 'denied', [
      'device-secret',
      'access-secret'
    ])
  })

  test('maps GitHub expiry and local expiry to expired failures', async () => {
    const remote = await flowForTokenResponse({error: 'expired_token'})
    await expectFailure(
      remote.flow.completeAuthorization(remote.grant, '42', remote.signal),
      'expired'
    )

    let now = startedAt
    let tokenRequests = 0
    const localFlow = new GitHubWriteDeviceFlow({
      clientId: 'write-client-id',
      now: () => now,
      fetch: async () => {
        tokenRequests += 1
        return jsonResponse({...deviceResponse, expires_in: 5})
      },
      sleep: async (milliseconds) => {
        now += milliseconds
      }
    })
    const signal = new AbortController().signal
    const grant = await localFlow.requestAuthorization(signal)
    await expectFailure(localFlow.completeAuthorization(grant, '42', signal), 'expired')
    expect(tokenRequests).toBe(1)
  })

  test('rejects missing or insufficient scopes before identity lookup', async () => {
    for (const tokenResponse of [
      {access_token: 'access-secret', token_type: 'bearer'},
      {access_token: 'access-secret', token_type: 'bearer', scope: ''},
      {access_token: 'access-secret', token_type: 'bearer', scope: 'read:user, gist'}
    ]) {
      const fixture = await flowForTokenResponse(tokenResponse)
      await expectFailure(
        fixture.flow.completeAuthorization(fixture.grant, '42', fixture.signal),
        'scope-denied',
        ['access-secret', 'device-secret']
      )
      expect(fixture.requestCount()).toBe(2)
    }
  })

  test('rejects non-bearer credentials before identity lookup', async () => {
    const fixture = await flowForTokenResponse({
      access_token: 'access-secret',
      token_type: 'mac',
      scope: 'public_repo'
    })
    await expectFailure(
      fixture.flow.completeAuthorization(fixture.grant, '42', fixture.signal),
      'credential-rejected',
      ['access-secret', 'device-secret']
    )
    expect(fixture.requestCount()).toBe(2)
  })

  test('rejects an OAuth identity that does not exactly match the caller account', async () => {
    const fixture = await flowForTokenResponse(
      {access_token: 'access-secret', token_type: 'bearer', scope: 'public_repo'},
      {...identityResponse, id: 420}
    )
    await expectFailure(
      fixture.flow.completeAuthorization(fixture.grant, '42', fixture.signal),
      'account-mismatch',
      ['access-secret', 'device-secret', '420']
    )
  })

  test('maps a rejected identity credential without exposing response content', async () => {
    const fixture = await flowForTokenResponse(
      {access_token: 'access-secret', token_type: 'bearer', scope: 'public_repo'},
      new Response('access_token=access-secret device_code=device-secret', {status: 401})
    )
    await expectFailure(
      fixture.flow.completeAuthorization(fixture.grant, '42', fixture.signal),
      'credential-rejected',
      ['access-secret', 'device-secret'],
      401
    )
  })

  test('maps malformed device, token, JSON, and identity responses to safe failures', async () => {
    const malformedDeviceFlow = new GitHubWriteDeviceFlow({
      clientId: 'write-client-id',
      fetch: async () => jsonResponse({...deviceResponse, interval: '5'})
    })
    await expectFailure(
      malformedDeviceFlow.requestAuthorization(new AbortController().signal),
      'failed'
    )

    for (const tokenResponse of [
      [],
      {},
      {access_token: 42, token_type: 'bearer', scope: 'public_repo'},
      {access_token: 'access-secret', scope: 'public_repo'},
      {access_token: 'access-secret', token_type: 'bearer', scope: 42}
    ]) {
      const fixture = await flowForTokenResponse(tokenResponse)
      await expectFailure(
        fixture.flow.completeAuthorization(fixture.grant, '42', fixture.signal),
        'failed',
        ['access-secret', 'device-secret']
      )
    }

    const invalidJson = await flowForTokenResponse(
      new Response('access_token=access-secret', {
        status: 200,
        headers: {'content-type': 'application/json'}
      })
    )
    await expectFailure(
      invalidJson.flow.completeAuthorization(invalidJson.grant, '42', invalidJson.signal),
      'failed',
      ['access-secret', 'device-secret']
    )

    const invalidIdentity = await flowForTokenResponse(
      {access_token: 'access-secret', token_type: 'bearer', scope: 'public_repo'},
      {...identityResponse, id: {raw_token: 'access-secret'}}
    )
    await expectFailure(
      invalidIdentity.flow.completeAuthorization(invalidIdentity.grant, '42', invalidIdentity.signal),
      'failed',
      ['access-secret', 'device-secret']
    )
  })

  test('sanitizes unknown OAuth errors, HTTP failures, and thrown credential text', async () => {
    const unknown = await flowForTokenResponse({
      error: 'server_error',
      error_description: 'access-secret device-secret'
    })
    await expectFailure(
      unknown.flow.completeAuthorization(unknown.grant, '42', unknown.signal),
      'failed',
      ['access-secret', 'device-secret']
    )

    const httpFlow = new GitHubWriteDeviceFlow({
      clientId: 'write-client-id',
      fetch: async () => new Response('access-secret device-secret', {status: 503})
    })
    await expectFailure(
      httpFlow.requestAuthorization(new AbortController().signal),
      'failed',
      ['access-secret', 'device-secret'],
      503
    )

    const thrownFlow = new GitHubWriteDeviceFlow({
      clientId: 'write-client-id',
      fetch: async () => {
        throw new Error('Bearer access-secret device_code=device-secret')
      }
    })
    await expectFailure(
      thrownFlow.requestAuthorization(new AbortController().signal),
      'failed',
      ['access-secret', 'device-secret']
    )
  })
})

async function flowForTokenResponse(
  tokenResponse: unknown | Response,
  identity: unknown | Response = identityResponse
): Promise<{
  readonly flow: GitHubWriteDeviceFlow
  readonly signal: AbortSignal
  readonly grant: Awaited<ReturnType<GitHubWriteDeviceFlow['requestAuthorization']>>
  readonly requestCount: () => number
}> {
  let requests = 0
  const responses: Response[] = [
    jsonResponse(deviceResponse),
    tokenResponse instanceof Response ? tokenResponse : jsonResponse(tokenResponse),
    identity instanceof Response ? identity : jsonResponse(identity)
  ]
  const flow = new GitHubWriteDeviceFlow({
    clientId: 'write-client-id',
    now: () => startedAt,
    fetch: async () => {
      requests += 1
      return responses.shift() ?? jsonResponse({}, 500)
    },
    sleep: async () => undefined
  })
  const signal = new AbortController().signal
  const grant = await flow.requestAuthorization(signal)
  return {flow, signal, grant, requestCount: () => requests}
}

async function expectFailure(
  promise: Promise<unknown>,
  reason: WriteDeviceAuthorizationFailure['reason'],
  secrets: readonly string[] = [],
  status?: number
): Promise<void> {
  try {
    await promise
    throw new Error(`Expected ${reason} failure`)
  } catch (error: unknown) {
    expect(error).toBeInstanceOf(WriteDeviceAuthorizationFailure)
    if (!(error instanceof WriteDeviceAuthorizationFailure)) return
    expect(error.reason).toBe(reason)
    expect(error.publicError.status).toBe(status)
    const publicFailure = `${error.message} ${JSON.stringify(error.publicError)}`
    for (const secret of secrets) expect(publicFailure).not.toContain(secret)
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {'content-type': 'application/json'}
  })
}
