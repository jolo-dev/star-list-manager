import {describe, expect, test} from 'bun:test'
import {
  OAuthStarringProbeFailure,
  runOAuthStarringCapabilityProbe,
  type OAuthStarringProbeFetch,
  type OAuthStarringProbeOptions
} from '../../scripts/oauth-starring-capability-probe'

const fixture = 'fixture-owner/disposable-star'
const fixtureNodeId = 'R_fixture'
const githubUserId = '42'
const token = 'fake-oauth-credential'
const apiOrigin = 'https://api.github.com'
const fixtureUrl = `${apiOrigin}/repos/fixture-owner/disposable-star`
const starringUrl = `${apiOrigin}/user/starred/fixture-owner/disposable-star`
const starsUrl = `${apiOrigin}/user/starred?per_page=100&page=1`
const secondStarsPageUrl = `${apiOrigin}/user/starred?page=2&per_page=100`

interface RequestStep {
  readonly url: string
  readonly method?: string
  readonly response: Response
}

interface ScriptedNetwork {
  readonly fetch: OAuthStarringProbeFetch
  readonly requests: readonly {
    readonly url: string
    readonly method: string
    readonly authorization: string | null
  }[]
  readonly remaining: () => number
}

const baseOptions: OAuthStarringProbeOptions = {
  fixture,
  fixtureNodeId,
  githubUserId,
  credential: {accessToken: token, githubUserId},
  observationDelayMilliseconds: 0
}

describe('OAuth Starring capability probe', () => {
  test('removes and restores only through exact Starring URLs after complete observations', async () => {
    const network = scriptedNetwork([
      ...validatedFixtureSteps(),
      mutationStep('DELETE'),
      observationStep(false, {
        link: `<${secondStarsPageUrl}>; rel="next"`,
        body: [starItem('R_other')]
      }),
      {
        url: secondStarsPageUrl,
        response: jsonResponse([])
      },
      observationStep(false),
      mutationStep('PUT'),
      observationStep(true),
      observationStep(true)
    ])

    const result = await runProbe(network)

    expect(result).toEqual({
      fixture,
      githubUserId,
      removalObservations: 2,
      restorationObservations: 2
    })
    expect(network.remaining()).toBe(0)
    expect(
      network.requests
        .filter((request) => request.method === 'DELETE' || request.method === 'PUT')
        .map((request) => ({url: request.url, method: request.method}))
    ).toEqual([
      {url: starringUrl, method: 'DELETE'},
      {url: starringUrl, method: 'PUT'}
    ])
    expect(network.requests[1]).toEqual({
      url: fixtureUrl,
      method: 'GET',
      authorization: null
    })
  })

  test('accepts delayed visibility only after two consecutive observations', async () => {
    const network = scriptedNetwork([
      ...validatedFixtureSteps(),
      mutationStep('DELETE'),
      observationStep(true),
      observationStep(false),
      observationStep(false),
      mutationStep('PUT'),
      observationStep(false),
      observationStep(true),
      observationStep(true)
    ])

    const result = await runProbe(network)

    expect(result.removalObservations).toBe(3)
    expect(result.restorationObservations).toBe(3)
    expect(network.remaining()).toBe(0)
  })

  test('rejects unstable removal observations after restoring the fixture', async () => {
    const network = scriptedNetwork([
      ...validatedFixtureSteps(),
      mutationStep('DELETE'),
      observationStep(false),
      observationStep(true),
      observationStep(false),
      observationStep(true),
      mutationStep('PUT'),
      observationStep(true),
      observationStep(true)
    ])

    await expectProbeFailure(
      runProbe(network, {maxObservationAttempts: 4}),
      'observation-unstable'
    )
    expect(network.remaining()).toBe(0)
  })

  test('reports a fixed mutation failure only after successful restoration', async () => {
    const network = scriptedNetwork([
      ...validatedFixtureSteps(),
      mutationStep(
        'DELETE',
        new Response(`Bearer ${token} raw-response`, {status: 500})
      ),
      ...successfulRestorationSteps()
    ])

    const error = await expectProbeFailure(runProbe(network), 'mutation-failed', 500)

    expect(error.message).not.toContain(token)
    expect(error.message).not.toContain('raw-response')
    expect(network.remaining()).toBe(0)
  })

  test('maps 401 without exposing credentials and still restores', async () => {
    const network = scriptedNetwork([
      ...validatedFixtureSteps(),
      mutationStep('DELETE', new Response(token, {status: 401})),
      ...successfulRestorationSteps()
    ])

    const error = await expectProbeFailure(runProbe(network), 'authentication', 401)

    expect(error.message).toBe('GitHub rejected the OAuth Starring credential.')
    expect(error.message).not.toContain(token)
    expect(network.remaining()).toBe(0)
  })

  test('maps 403 permission denial and still restores', async () => {
    const network = scriptedNetwork([
      ...validatedFixtureSteps(),
      mutationStep('DELETE', new Response(token, {status: 403})),
      ...successfulRestorationSteps()
    ])

    const error = await expectProbeFailure(runProbe(network), 'permission', 403)

    expect(error.message).toBe(
      'GitHub denied OAuth Starring access with the required public_repo scope.'
    )
    expect(network.remaining()).toBe(0)
  })

  test('maps rate limits separately from permission denial and still restores', async () => {
    const network = scriptedNetwork([
      ...validatedFixtureSteps(),
      mutationStep(
        'DELETE',
        new Response(token, {
          status: 403,
          headers: {'x-ratelimit-remaining': '0'}
        })
      ),
      ...successfulRestorationSteps()
    ])

    const error = await expectProbeFailure(runProbe(network), 'rate-limit', 403)

    expect(error.message).toBe(
      'GitHub rate-limited the OAuth Starring capability probe.'
    )
    expect(network.remaining()).toBe(0)
  })

  test('rejects malformed complete-observation data after restoring', async () => {
    const network = scriptedNetwork([
      ...validatedFixtureSteps(),
      mutationStep('DELETE'),
      {url: starsUrl, response: jsonResponse({access_token: token})},
      ...successfulRestorationSteps()
    ])

    const error = await expectProbeFailure(
      runProbe(network),
      'observation-malformed'
    )

    expect(error.message).not.toContain(token)
    expect(network.remaining()).toBe(0)
  })

  test('throws prominent manual guidance when the restoration mutation fails', async () => {
    const network = scriptedNetwork([
      ...validatedFixtureSteps(),
      mutationStep('DELETE'),
      observationStep(false),
      observationStep(false),
      mutationStep('PUT', new Response(token, {status: 500}))
    ])

    const error = await expectProbeFailure(runProbe(network), 'cleanup-failed')

    expect(error.message).toContain('CLEANUP FAILED')
    expect(error.message).toContain('Manually star')
    expect(error.message).toContain('did not succeed')
    expect(error.message).not.toContain(token)
    expect(network.remaining()).toBe(0)
  })

  test('throws cleanup guidance when restored presence cannot converge', async () => {
    const network = scriptedNetwork([
      ...validatedFixtureSteps(),
      mutationStep('DELETE'),
      observationStep(false),
      observationStep(false),
      mutationStep('PUT'),
      observationStep(false),
      observationStep(true),
      observationStep(false)
    ])

    const error = await expectProbeFailure(
      runProbe(network, {maxObservationAttempts: 3}),
      'cleanup-failed'
    )

    expect(error.message).toContain('CLEANUP FAILED')
    expect(network.remaining()).toBe(0)
  })

  test('rejects unstable OAuth identity before reading or mutating the fixture', async () => {
    const network = scriptedNetwork([
      {
        url: `${apiOrigin}/user`,
        response: jsonResponse({id: 420})
      }
    ])

    await expectProbeFailure(runProbe(network), 'identity-mismatch')
    expect(network.remaining()).toBe(0)
  })

  test('requires exact public fixture metadata and confirmed node ID', async () => {
    const network = scriptedNetwork([
      identityStep(),
      {
        url: fixtureUrl,
        response: jsonResponse({
          full_name: fixture,
          node_id: 'R_changed',
          private: false
        })
      }
    ])

    await expectProbeFailure(runProbe(network), 'fixture-node-id-mismatch')
    expect(network.remaining()).toBe(0)
  })
})

async function runProbe(
  network: ScriptedNetwork,
  overrides: Partial<OAuthStarringProbeOptions> = {}
) {
  return runOAuthStarringCapabilityProbe(
    {...baseOptions, ...overrides},
    {fetch: network.fetch, sleep: async () => undefined}
  )
}

async function expectProbeFailure(
  promise: Promise<unknown>,
  code: OAuthStarringProbeFailure['code'],
  status: number | null = null
): Promise<OAuthStarringProbeFailure> {
  try {
    await promise
    throw new Error(`Expected probe failure ${code}`)
  } catch (error: unknown) {
    expect(error).toBeInstanceOf(OAuthStarringProbeFailure)
    if (!(error instanceof OAuthStarringProbeFailure)) throw error
    expect(error.code).toBe(code)
    expect(error.status).toBe(status)
    return error
  }
}

function validatedFixtureSteps(): readonly RequestStep[] {
  return [
    identityStep(),
    {
      url: fixtureUrl,
      response: jsonResponse({
        full_name: fixture,
        node_id: fixtureNodeId,
        private: false
      })
    },
    {url: starringUrl, method: 'GET', response: new Response(null, {status: 204})}
  ]
}

function identityStep(): RequestStep {
  return {
    url: `${apiOrigin}/user`,
    response: jsonResponse({id: 42})
  }
}

function successfulRestorationSteps(): readonly RequestStep[] {
  return [mutationStep('PUT'), observationStep(true), observationStep(true)]
}

function mutationStep(
  method: 'DELETE' | 'PUT',
  response: Response = new Response(null, {status: 204})
): RequestStep {
  return {url: starringUrl, method, response}
}

function observationStep(
  present: boolean,
  options: {readonly body?: unknown; readonly link?: string} = {}
): RequestStep {
  return {
    url: starsUrl,
    response: jsonResponse(
      options.body ?? (present ? [starItem(fixtureNodeId)] : [starItem('R_other')]),
      200,
      options.link === undefined ? {} : {link: options.link}
    )
  }
}

function starItem(nodeId: string): unknown {
  return {
    starred_at: '2026-08-04T12:00:00Z',
    repo: {node_id: nodeId, private: false}
  }
}

function scriptedNetwork(initialSteps: readonly RequestStep[]): ScriptedNetwork {
  const steps = [...initialSteps]
  const requests: Array<{
    readonly url: string
    readonly method: string
    readonly authorization: string | null
  }> = []
  const fetch: OAuthStarringProbeFetch = async (input, init) => {
    const step = steps.shift()
    if (!step) throw new Error('Unexpected request')
    const method = init?.method ?? 'GET'
    const headers = new Headers(init?.headers)
    const request = {
      url: String(input),
      method,
      authorization: headers.get('authorization')
    }
    requests.push(request)
    expect(request.url).toBe(step.url)
    expect(request.method).toBe(step.method ?? 'GET')
    if (request.url === fixtureUrl) {
      expect(request.authorization).toBeNull()
    } else {
      expect(request.authorization).toBe(`Bearer ${token}`)
    }
    return step.response
  }
  return {fetch, requests, remaining: () => steps.length}
}

function jsonResponse(
  body: unknown,
  status = 200,
  headers: Readonly<Record<string, string>> = {}
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {'content-type': 'application/json', ...headers}
  })
}
