import {
  GitHubWriteDeviceFlow,
  WriteDeviceAuthorizationFailure
} from '../src/auth/write-device-flow'

const apiOrigin = 'https://api.github.com'
const apiVersion = '2026-03-10'
const publicStarsUrl = `${apiOrigin}/user/starred?per_page=100&page=1`
const starringBaseUrl = `${apiOrigin}/user/starred`
const defaultObservationAttempts = 8
const defaultObservationDelayMilliseconds = 1_000

const apiHeaders = {
  accept: 'application/vnd.github+json',
  'x-github-api-version': apiVersion
} as const

const starObservationHeaders = {
  ...apiHeaders,
  accept: 'application/vnd.github.star+json'
} as const

export type ProbeFailureCode =
  | 'invalid-input'
  | 'identity-mismatch'
  | 'fixture-invalid'
  | 'fixture-node-id-mismatch'
  | 'fixture-not-starred'
  | 'authentication'
  | 'permission'
  | 'rate-limit'
  | 'request-failed'
  | 'mutation-failed'
  | 'observation-malformed'
  | 'observation-unstable'
  | 'cleanup-failed'

export class OAuthStarringProbeFailure extends Error {
  readonly code: ProbeFailureCode
  readonly status: number | null

  constructor(code: ProbeFailureCode, message: string, status: number | null = null) {
    super(message)
    this.name = 'OAuthStarringProbeFailure'
    this.code = code
    this.status = status
  }
}

export interface OAuthStarringProbeCredential {
  readonly accessToken: string
  readonly githubUserId: string
}

export interface OAuthStarringProbeOptions {
  readonly fixture: string
  readonly fixtureNodeId: string
  readonly githubUserId: string
  readonly credential: OAuthStarringProbeCredential
  readonly maxObservationAttempts?: number
  readonly observationDelayMilliseconds?: number
}

export type OAuthStarringProbeFetch = (
  input: RequestInfo | URL,
  init?: RequestInit
) => Promise<Response>

export interface OAuthStarringProbeDependencies {
  readonly fetch: OAuthStarringProbeFetch
  readonly sleep?: (milliseconds: number) => Promise<void>
}

export interface OAuthStarringProbeResult {
  readonly fixture: string
  readonly githubUserId: string
  readonly removalObservations: number
  readonly restorationObservations: number
}

interface Fixture {
  readonly owner: string
  readonly name: string
  readonly fullName: string
  readonly nodeId: string
  readonly starringUrl: string
}

interface ObservationResult {
  readonly containsFixture: boolean
}

interface ConvergenceResult {
  readonly observations: number
}

const cleanupMessage =
  'CLEANUP FAILED: Manually star the confirmed fixture repository on GitHub and verify that it appears in your stars. The capability probe did not succeed.'

export async function runOAuthStarringCapabilityProbe(
  options: OAuthStarringProbeOptions,
  dependencies: OAuthStarringProbeDependencies
): Promise<OAuthStarringProbeResult> {
  const fixtureInput = parseFixture(options.fixture)
  const fixtureNodeId = requireArgument(options.fixtureNodeId)
  const githubUserId = requireArgument(options.githubUserId)
  const accessToken = requireArgument(options.credential.accessToken)
  const credentialUserId = requireArgument(options.credential.githubUserId)
  const maxAttempts = options.maxObservationAttempts ?? defaultObservationAttempts
  const delayMilliseconds =
    options.observationDelayMilliseconds ?? defaultObservationDelayMilliseconds

  if (!Number.isSafeInteger(maxAttempts) || maxAttempts < 2) {
    throw failure(
      'invalid-input',
      'The observation attempt limit must be an integer of at least two.'
    )
  }
  if (!Number.isSafeInteger(delayMilliseconds) || delayMilliseconds < 0) {
    throw failure(
      'invalid-input',
      'The observation delay must be a non-negative integer.'
    )
  }
  if (credentialUserId !== githubUserId) {
    throw failure(
      'identity-mismatch',
      'OAuth authorization does not match the confirmed GitHub user ID.'
    )
  }

  await verifyStableIdentity(
    githubUserId,
    accessToken,
    dependencies.fetch
  )
  const fixture = await loadFixture(
    fixtureInput.owner,
    fixtureInput.name,
    fixtureNodeId,
    dependencies.fetch
  )
  const initiallyStarred = await readStarStatus(
    fixture.starringUrl,
    accessToken,
    dependencies.fetch
  )
  if (!initiallyStarred) {
    throw failure(
      'fixture-not-starred',
      'The confirmed disposable fixture must already be starred.'
    )
  }

  let removalObservations = 0
  let restorationObservations = 0
  let primaryFailure: OAuthStarringProbeFailure | null = null

  try {
    await mutateStar(fixture.starringUrl, 'DELETE', accessToken, dependencies.fetch)
    const removal = await waitForConvergence(
      fixture.nodeId,
      false,
      accessToken,
      maxAttempts,
      delayMilliseconds,
      dependencies
    )
    removalObservations = removal.observations
  } catch (error: unknown) {
    primaryFailure = safeFailure(error)
  }

  try {
    await mutateStar(fixture.starringUrl, 'PUT', accessToken, dependencies.fetch)
    const restoration = await waitForConvergence(
      fixture.nodeId,
      true,
      accessToken,
      maxAttempts,
      delayMilliseconds,
      dependencies
    )
    restorationObservations = restoration.observations
  } catch {
    throw failure('cleanup-failed', cleanupMessage)
  }

  if (primaryFailure) throw primaryFailure

  return {
    fixture: fixture.fullName,
    githubUserId,
    removalObservations,
    restorationObservations
  }
}

async function verifyStableIdentity(
  expectedGitHubUserId: string,
  accessToken: string,
  request: OAuthStarringProbeFetch
): Promise<void> {
  const response = await safeFetch(
    request,
    `${apiOrigin}/user`,
    {headers: authenticatedHeaders(accessToken)},
    'GitHub identity verification could not be completed.'
  )
  if (!response.ok) throw httpFailure(response, 'request-failed')
  const record = requireRecord(
    await readJson(response),
    'GitHub identity data was malformed.'
  )
  const id = record.id
  if (!Number.isSafeInteger(id) || typeof id !== 'number' || id < 0) {
    throw failure('fixture-invalid', 'GitHub identity data was malformed.')
  }
  if (String(id) !== expectedGitHubUserId) {
    throw failure(
      'identity-mismatch',
      'OAuth authorization does not match the confirmed GitHub user ID.'
    )
  }
}

async function loadFixture(
  owner: string,
  name: string,
  expectedNodeId: string,
  request: OAuthStarringProbeFetch
): Promise<Fixture> {
  const fullName = `${owner}/${name}`
  const repositoryUrl = `${apiOrigin}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`
  const response = await safeFetch(
    request,
    repositoryUrl,
    {headers: apiHeaders},
    'Public fixture metadata could not be loaded.'
  )
  if (!response.ok) throw httpFailure(response, 'request-failed')
  const record = requireRecord(
    await readJson(response),
    'Public fixture metadata was malformed.'
  )
  if (
    record.private !== false ||
    record.full_name !== fullName ||
    typeof record.node_id !== 'string' ||
    record.node_id.length === 0
  ) {
    throw failure('fixture-invalid', 'Public fixture metadata was malformed.')
  }
  if (record.node_id !== expectedNodeId) {
    throw failure(
      'fixture-node-id-mismatch',
      'Public fixture metadata did not match the confirmed repository node ID.'
    )
  }

  return {
    owner,
    name,
    fullName,
    nodeId: record.node_id,
    starringUrl: `${starringBaseUrl}/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`
  }
}

async function readStarStatus(
  url: string,
  accessToken: string,
  request: OAuthStarringProbeFetch
): Promise<boolean> {
  const response = await safeFetch(
    request,
    url,
    {method: 'GET', headers: authenticatedHeaders(accessToken)},
    'The disposable fixture star status could not be checked.'
  )
  if (response.status === 204) return true
  if (response.status === 404) return false
  throw httpFailure(response, 'request-failed')
}

async function mutateStar(
  url: string,
  method: 'PUT' | 'DELETE',
  accessToken: string,
  request: OAuthStarringProbeFetch
): Promise<void> {
  const response = await safeFetch(
    request,
    url,
    {method, headers: authenticatedHeaders(accessToken)},
    'The disposable Starring mutation could not be sent.'
  )
  if (response.status !== 204) throw httpFailure(response, 'mutation-failed')
}

async function waitForConvergence(
  fixtureNodeId: string,
  expectedPresence: boolean,
  accessToken: string,
  maxAttempts: number,
  delayMilliseconds: number,
  dependencies: OAuthStarringProbeDependencies
): Promise<ConvergenceResult> {
  let consecutiveMatches = 0

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    if (attempt > 1) {
      try {
        await (dependencies.sleep ?? sleep)(delayMilliseconds)
      } catch {
        throw failure(
          'request-failed',
          'Waiting for a complete public-star observation failed.'
        )
      }
    }

    const observation = await observePublicStars(
      fixtureNodeId,
      accessToken,
      dependencies.fetch
    )
    if (observation.containsFixture === expectedPresence) {
      consecutiveMatches += 1
      if (consecutiveMatches === 2) return {observations: attempt}
    } else {
      consecutiveMatches = 0
    }
  }

  throw failure(
    'observation-unstable',
    'Public-star observations did not converge to two consecutive matching results.'
  )
}

async function observePublicStars(
  fixtureNodeId: string,
  accessToken: string,
  request: OAuthStarringProbeFetch
): Promise<ObservationResult> {
  let nextUrl: string | null = publicStarsUrl
  let pages = 0
  let containsFixture = false

  while (nextUrl) {
    pages += 1
    if (pages > 1_000) {
      throw failure(
        'observation-malformed',
        'Complete public-star observation exceeded the pagination safety limit.'
      )
    }
    const response = await safeFetch(
      request,
      nextUrl,
      {headers: authenticatedHeaders(accessToken, true)},
      'A complete public-star observation could not be loaded.'
    )
    if (!response.ok) throw httpFailure(response, 'request-failed')
    const value = await readJson(response)
    if (!Array.isArray(value)) {
      throw failure(
        'observation-malformed',
        'GitHub returned malformed public-star observation data.'
      )
    }

    for (const item of value) {
      const star = requireRecord(
        item,
        'GitHub returned malformed public-star observation data.'
      )
      const repository = requireRecord(
        star.repo,
        'GitHub returned malformed public-star observation data.'
      )
      if (
        typeof repository.node_id !== 'string' ||
        repository.node_id.length === 0 ||
        typeof repository.private !== 'boolean'
      ) {
        throw failure(
          'observation-malformed',
          'GitHub returned malformed public-star observation data.'
        )
      }
      if (repository.private === false && repository.node_id === fixtureNodeId) {
        containsFixture = true
      }
    }

    nextUrl = parseNextPublicStarsUrl(response.headers.get('link'))
  }

  return {containsFixture}
}

function parseNextPublicStarsUrl(link: string | null): string | null {
  if (!link) return null
  let nextUrl: string | null = null
  for (const part of link.split(',')) {
    const match = part.trim().match(/^<([^>]+)>;\s*rel="([^"]+)"$/)
    if (!match) {
      throw failure(
        'observation-malformed',
        'GitHub returned an invalid public-star pagination URL.'
      )
    }
    if (match?.[2]?.split(/\s+/).includes('next')) {
      if (nextUrl !== null) {
        throw failure(
          'observation-malformed',
          'GitHub returned an invalid public-star pagination URL.'
        )
      }
      nextUrl = validatePublicStarsUrl(match[1] ?? '')
    }
  }
  return nextUrl
}

function validatePublicStarsUrl(value: string): string {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw failure(
      'observation-malformed',
      'GitHub returned an invalid public-star pagination URL.'
    )
  }
  const keys = [...url.searchParams.keys()]
  if (
    url.origin !== apiOrigin ||
    url.pathname !== '/user/starred' ||
    url.username !== '' ||
    url.password !== '' ||
    url.hash !== '' ||
    keys.some((key) => key !== 'page' && key !== 'per_page') ||
    url.searchParams.get('per_page') !== '100' ||
    !/^\d+$/.test(url.searchParams.get('page') ?? '')
  ) {
    throw failure(
      'observation-malformed',
      'GitHub returned an invalid public-star pagination URL.'
    )
  }
  return url.toString()
}

function authenticatedHeaders(
  accessToken: string,
  starObservation = false
): Readonly<Record<string, string>> {
  return {
    ...(starObservation ? starObservationHeaders : apiHeaders),
    authorization: `Bearer ${accessToken}`
  }
}

async function safeFetch(
  request: OAuthStarringProbeFetch,
  url: string,
  init: RequestInit,
  message: string
): Promise<Response> {
  try {
    return await request(url, init)
  } catch {
    throw failure('request-failed', message)
  }
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return (await response.json()) as unknown
  } catch {
    throw failure(
      'observation-malformed',
      'GitHub returned malformed JSON data.'
    )
  }
}

function requireRecord(
  value: unknown,
  message: string
): Readonly<Record<string, unknown>> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw failure('observation-malformed', message)
  }
  return value as Readonly<Record<string, unknown>>
}

function httpFailure(
  response: Response,
  fallbackCode: 'request-failed' | 'mutation-failed'
): OAuthStarringProbeFailure {
  const status = response.status
  if (
    status === 429 ||
    (status === 403 && response.headers.get('x-ratelimit-remaining') === '0')
  ) {
    return failure(
      'rate-limit',
      'GitHub rate-limited the OAuth Starring capability probe.',
      status
    )
  }
  if (status === 401) {
    return failure(
      'authentication',
      'GitHub rejected the OAuth Starring credential.',
      status
    )
  }
  if (status === 403) {
    return failure(
      'permission',
      'GitHub denied OAuth Starring access with the required public_repo scope.',
      status
    )
  }
  return failure(
    fallbackCode,
    fallbackCode === 'mutation-failed'
      ? 'GitHub did not accept the disposable Starring mutation.'
      : 'GitHub could not complete the OAuth Starring capability probe request.',
    status
  )
}

function parseFixture(value: string): {readonly owner: string; readonly name: string} {
  const [owner, name, extra] = value.split('/')
  if (
    !owner ||
    !name ||
    extra !== undefined ||
    !isSafeSegment(owner) ||
    !isSafeSegment(name)
  ) {
    throw failure(
      'invalid-input',
      'The disposable fixture must use a valid owner/name value.'
    )
  }
  return {owner, name}
}

function isSafeSegment(value: string): boolean {
  return value.trim() === value && value !== '.' && value !== '..'
}

function requireArgument(value: string): string {
  if (value.length === 0 || value.trim() !== value) {
    throw failure('invalid-input', 'A required capability probe value is invalid.')
  }
  return value
}

function safeFailure(error: unknown): OAuthStarringProbeFailure {
  return error instanceof OAuthStarringProbeFailure
    ? error
    : failure('request-failed', 'The OAuth Starring capability probe failed safely.')
}

function failure(
  code: ProbeFailureCode,
  message: string,
  status: number | null = null
): OAuthStarringProbeFailure {
  return new OAuthStarringProbeFailure(code, message, status)
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

interface CliArguments {
  readonly fixture: string
  readonly fixtureNodeId: string
  readonly githubUserId: string
}

function parseCliArguments(arguments_: readonly string[]): CliArguments {
  const allowedPrefixes = [
    '--fixture=',
    '--fixture-node-id=',
    '--github-user-id='
  ] as const
  const confirmationCount = arguments_.filter(
    (argument) => argument === '--confirm-disposable'
  ).length
  const unknownArgument = arguments_.some(
    (argument) =>
      argument !== '--confirm-disposable' &&
      !allowedPrefixes.some((prefix) => argument.startsWith(prefix))
  )
  if (confirmationCount !== 1 || unknownArgument) {
    throw failure(
      'invalid-input',
      'Usage requires --confirm-disposable and the documented fixture arguments.'
    )
  }

  return {
    fixture: requiredCliValue(arguments_, '--fixture='),
    fixtureNodeId: requiredCliValue(arguments_, '--fixture-node-id='),
    githubUserId: requiredCliValue(arguments_, '--github-user-id=')
  }
}

function requiredCliValue(arguments_: readonly string[], prefix: string): string {
  const matches = arguments_.filter((argument) => argument.startsWith(prefix))
  if (matches.length !== 1) {
    throw failure('invalid-input', 'Each required capability probe argument must occur once.')
  }
  return requireArgument(matches[0]?.slice(prefix.length) ?? '')
}

async function runCli(): Promise<void> {
  const arguments_ = parseCliArguments(Bun.argv.slice(2))
  const clientId = Bun.env.EXTENSION_PUBLIC_GITHUB_WRITE_CLIENT_ID
  if (!clientId) {
    throw failure(
      'invalid-input',
      'Set EXTENSION_PUBLIC_GITHUB_WRITE_CLIENT_ID before running the probe.'
    )
  }

  const signal = new AbortController().signal
  const flow = new GitHubWriteDeviceFlow({clientId})
  const grant = await flow.requestAuthorization(signal)
  console.log(`Open ${grant.verificationUri} and enter code ${grant.userCode}`)
  console.log('Waiting for GitHub OAuth authorization...')
  const state = await flow.completeAuthorization(
    grant,
    arguments_.githubUserId,
    signal
  )

  const result = await runOAuthStarringCapabilityProbe(
    {
      ...arguments_,
      credential: {
        accessToken: state.credential.accessToken,
        githubUserId: state.identity.githubUserId
      }
    },
    {fetch: globalThis.fetch}
  )
  console.log(
    `OAuth Starring capability probe succeeded for ${result.fixture} after verified removal and restoration.`
  )
}

if (import.meta.main) {
  try {
    await runCli()
  } catch (error: unknown) {
    console.error(
      error instanceof OAuthStarringProbeFailure ||
        error instanceof WriteDeviceAuthorizationFailure
        ? error.message
        : 'The OAuth Starring capability probe failed safely.'
    )
    process.exitCode = 1
  }
}
