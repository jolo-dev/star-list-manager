import {describe, expect, test} from 'bun:test'
import {
  DeviceAuthorizationFailure,
  GitHubDeviceFlow,
  toPublicDeviceAuthorization
} from '../../src/auth/device-flow'

describe('GitHub device flow', () => {
  test('invokes the fetch dependency without a service-object receiver', async () => {
    let receiver: unknown = 'not-called'
    const request = async function (this: unknown): Promise<Response> {
      receiver = this
      return jsonResponse({
        device_code: 'device-secret',
        user_code: 'ABCD-EFGH',
        verification_uri: 'https://github.com/login/device',
        expires_in: 900,
        interval: 5
      })
    }
    const flow = new GitHubDeviceFlow({
      clientId: 'public-client-id',
      fetch: request
    })

    await flow.requestAuthorization(new AbortController().signal)
    expect(receiver).toBeUndefined()
  })

  test('honors polling intervals and slow_down before validating identity', async () => {
    let now = Date.parse('2026-08-03T12:00:00Z')
    const sleeps: number[] = []
    const responses = [
      jsonResponse({
        device_code: 'device-secret',
        user_code: 'ABCD-EFGH',
        verification_uri: 'https://github.com/login/device',
        expires_in: 900,
        interval: 5
      }),
      jsonResponse({error: 'authorization_pending'}),
      jsonResponse({error: 'slow_down'}),
      jsonResponse({
        access_token: 'access-secret',
        refresh_token: 'refresh-secret',
        expires_in: 28_800,
        refresh_token_expires_in: 15_897_600
      }),
      jsonResponse({
        id: 42,
        node_id: 'U_fixture',
        login: 'jolo-dev',
        avatar_url: 'https://avatars.githubusercontent.com/u/42'
      })
    ]
    const flow = new GitHubDeviceFlow({
      clientId: 'public-client-id',
      now: () => now,
      sleep: async (milliseconds) => {
        sleeps.push(milliseconds)
        now += milliseconds
      },
      fetch: async () => responses.shift() ?? jsonResponse({}, 500)
    })
    const controller = new AbortController()

    const grant = await flow.requestAuthorization(controller.signal)
    expect(toPublicDeviceAuthorization(grant)).toEqual({
      userCode: 'ABCD-EFGH',
      verificationUri: 'https://github.com/login/device',
      expiresAt: '2026-08-03T12:15:00.000Z',
      intervalSeconds: 5
    })

    const completed = await flow.completeAuthorization(grant, controller.signal)
    expect(sleeps).toEqual([5000, 5000, 10000])
    expect(completed.identity).toMatchObject({githubUserId: '42', login: 'jolo-dev'})
    expect(completed.credentials).toMatchObject({
      accessToken: 'access-secret',
      refreshToken: 'refresh-secret',
      generation: 1
    })
  })

  test('reports denial without exposing the device code', async () => {
    const flow = flowForTokenResponse({error: 'access_denied'})
    const controller = new AbortController()
    const grant = await flow.requestAuthorization(controller.signal)

    try {
      await flow.completeAuthorization(grant, controller.signal)
      throw new Error('Expected authorization denial')
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(DeviceAuthorizationFailure)
      if (!(error instanceof DeviceAuthorizationFailure)) return
      expect(error.reason).toBe('denied')
      expect(JSON.stringify(error.publicError)).not.toContain('device-secret')
    }
  })

  test('supports explicit cancellation', async () => {
    const controller = new AbortController()
    const flow = new GitHubDeviceFlow({
      clientId: 'public-client-id',
      fetch: async () =>
        jsonResponse({
          device_code: 'device-secret',
          user_code: 'ABCD-EFGH',
          verification_uri: 'https://github.com/login/device',
          expires_in: 900,
          interval: 5
        }),
      sleep: async () => {
        controller.abort()
        throw new Error('cancelled sleep')
      }
    })
    const grant = await flow.requestAuthorization(controller.signal)

    await expect(flow.completeAuthorization(grant, controller.signal)).rejects.toMatchObject({
      reason: 'cancelled'
    })
  })
})

function flowForTokenResponse(tokenResponse: unknown): GitHubDeviceFlow {
  const responses = [
    jsonResponse({
      device_code: 'device-secret',
      user_code: 'ABCD-EFGH',
      verification_uri: 'https://github.com/login/device',
      expires_in: 900,
      interval: 5
    }),
    jsonResponse(tokenResponse)
  ]
  return new GitHubDeviceFlow({
    clientId: 'public-client-id',
    fetch: async () => responses.shift() ?? jsonResponse({}, 500),
    sleep: async () => undefined
  })
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {'content-type': 'application/json'}
  })
}
