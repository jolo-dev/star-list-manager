import {
  GitHubWriteDeviceFlow,
  WriteDeviceAuthorizationFailure
} from '../src/auth/write-device-flow'
import type {WriteAuthStateRecord} from '../src/domain/types'
import {
  type ListMembershipCapabilityProof
} from '../src/github/list-membership-capability'
import {
  ListMembershipMutationFailure,
  ListMembershipWriteSession,
  type ListMembershipMutationResult
} from '../src/github/list-membership-write-session'

const apiOrigin = 'https://api.github.com'
const graphqlUrl = `${apiOrigin}/graphql`
const apiVersion = '2026-03-10'
const defaultObservationAttempts = 8
const defaultObservationDelayMilliseconds = 1_000

export type ListMembershipProbeFailureCode =
  | 'invalid-input'
  | 'fixture-invalid'
  | 'fixture-not-starred'
  | 'observation-failed'
  | 'observation-unstable'
  | 'mutation-failed'
  | 'read-back-mismatch'

export class OAuthListMembershipProbeFailure extends Error {
  readonly code: ListMembershipProbeFailureCode

  constructor(code: ListMembershipProbeFailureCode, message: string) {
    super(message)
    this.name = 'OAuthListMembershipProbeFailure'
    this.code = code
  }
}

export interface OAuthListMembershipProbeOptions {
  readonly fixture: string
  readonly repositoryNodeId: string
  readonly expectedGitHubUserId: string
}

export interface StableMembershipObservation {
  readonly completeListIds: readonly string[]
  readonly observations: number
}

export interface OAuthListMembershipProbeDependencies {
  readonly transport: {
    updateMemberships(request: {
      readonly expectedGitHubUserId: string
      readonly repositoryNodeId: string
      readonly completeListIds: readonly string[]
    }): Promise<ListMembershipMutationResult>
  }
  readonly observeStableMemberships: (
    expectedGitHubUserId: string,
    repositoryNodeId: string
  ) => Promise<StableMembershipObservation>
}

export interface OAuthListMembershipProbeResult {
  readonly fixture: string
  readonly githubUserId: string
  readonly listCount: number
  readonly initialObservations: number
  readonly readBackObservations: number
  readonly proof: ListMembershipCapabilityProof
}

export async function runOAuthListMembershipCapabilityProbe(
  options: OAuthListMembershipProbeOptions,
  dependencies: OAuthListMembershipProbeDependencies
): Promise<OAuthListMembershipProbeResult> {
  const fixture = parseFixture(options.fixture)
  const repositoryNodeId = requireValue(options.repositoryNodeId)
  const expectedGitHubUserId = requireValue(options.expectedGitHubUserId)

  const initial = await observe(
    dependencies,
    expectedGitHubUserId,
    repositoryNodeId
  )
  requireCanonicalIds(initial.completeListIds)

  try {
    await dependencies.transport.updateMemberships({
      expectedGitHubUserId,
      repositoryNodeId,
      completeListIds: initial.completeListIds
    })
  } catch {
    throw probeFailure(
      'mutation-failed',
      'The unchanged native List membership mutation did not succeed.'
    )
  }

  const readBack = await observe(
    dependencies,
    expectedGitHubUserId,
    repositoryNodeId
  )
  requireCanonicalIds(readBack.completeListIds)
  if (!equalIds(initial.completeListIds, readBack.completeListIds)) {
    throw probeFailure(
      'read-back-mismatch',
      'Independent read-back did not match the unchanged native List membership set.'
    )
  }

  return {
    fixture: fixture.fullName,
    githubUserId: expectedGitHubUserId,
    listCount: initial.completeListIds.length,
    initialObservations: initial.observations,
    readBackObservations: readBack.observations,
    proof: {
      schema: 'available',
      oauthUserScope: 'verified',
      accountOwnership: 'verified',
      unchangedSetMutation: 'verified',
      independentReadBack: 'verified'
    }
  }
}

async function observe(
  dependencies: OAuthListMembershipProbeDependencies,
  expectedGitHubUserId: string,
  repositoryNodeId: string
): Promise<StableMembershipObservation> {
  try {
    return await dependencies.observeStableMemberships(
      expectedGitHubUserId,
      repositoryNodeId
    )
  } catch (error: unknown) {
    if (error instanceof OAuthListMembershipProbeFailure) throw error
    throw probeFailure(
      'observation-failed',
      'A complete stable native List membership observation could not be obtained.'
    )
  }
}

function requireCanonicalIds(ids: readonly string[]): void {
  if (
    !Array.isArray(ids) ||
    ids.some((id) => !isValue(id)) ||
    ids.some((id, index) => index > 0 && id <= (ids[index - 1] ?? ''))
  ) {
    throw probeFailure(
      'observation-failed',
      'The stable observation did not return canonical native List IDs.'
    )
  }
}

function equalIds(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((id, index) => id === right[index])
}

interface Fixture {
  readonly owner: string
  readonly name: string
  readonly fullName: string
}

function parseFixture(value: string): Fixture {
  const [owner, name, extra] = value.split('/')
  if (
    !owner ||
    !name ||
    extra !== undefined ||
    !isValue(owner) ||
    !isValue(name) ||
    owner === '.' ||
    owner === '..' ||
    name === '.' ||
    name === '..'
  ) {
    throw probeFailure(
      'invalid-input',
      'The disposable fixture must use a valid owner/name value.'
    )
  }
  return {owner, name, fullName: `${owner}/${name}`}
}

function requireValue(value: string): string {
  if (!isValue(value)) {
    throw probeFailure('invalid-input', 'A required capability probe value is invalid.')
  }
  return value
}

function isValue(value: string): boolean {
  return value.length > 0 && value.trim() === value
}

function probeFailure(
  code: ListMembershipProbeFailureCode,
  message: string
): OAuthListMembershipProbeFailure {
  return new OAuthListMembershipProbeFailure(code, message)
}

type ProbeFetch = (
  input: RequestInfo | URL,
  init?: RequestInit
) => Promise<Response>

interface CliArguments extends OAuthListMembershipProbeOptions {}

function parseCliArguments(arguments_: readonly string[]): CliArguments {
  const prefixes = ['--fixture=', '--fixture-node-id=', '--github-user-id='] as const
  const confirmed = arguments_.filter(
    (argument) => argument === '--confirm-unchanged-membership-set'
  ).length
  const unknown = arguments_.some(
    (argument) =>
      argument !== '--confirm-unchanged-membership-set' &&
      !prefixes.some((prefix) => argument.startsWith(prefix))
  )
  if (confirmed !== 1 || unknown) {
    throw probeFailure(
      'invalid-input',
      'Usage requires --confirm-unchanged-membership-set and the documented fixture arguments.'
    )
  }
  return {
    fixture: requiredCliArgument(arguments_, '--fixture='),
    repositoryNodeId: requiredCliArgument(arguments_, '--fixture-node-id='),
    expectedGitHubUserId: requiredCliArgument(arguments_, '--github-user-id=')
  }
}

function requiredCliArgument(arguments_: readonly string[], prefix: string): string {
  const matches = arguments_.filter((argument) => argument.startsWith(prefix))
  if (matches.length !== 1) {
    throw probeFailure(
      'invalid-input',
      'Each required capability probe argument must occur once.'
    )
  }
  return requireValue(matches[0]?.slice(prefix.length) ?? '')
}

async function validateDisposableFixture(
  fixtureValue: string,
  repositoryNodeId: string,
  accessToken: string,
  request: ProbeFetch
): Promise<void> {
  const fixture = parseFixture(fixtureValue)
  const metadata = await safeFetch(
    request,
    `${apiOrigin}/repos/${encodeURIComponent(fixture.owner)}/${encodeURIComponent(fixture.name)}`,
    {headers: apiHeaders()},
    'Disposable fixture metadata could not be loaded.'
  )
  if (!metadata.ok) throw httpProbeFailure(metadata)
  const record = requireRecord(await readJson(metadata))
  if (
    record.private !== false ||
    record.full_name !== fixture.fullName ||
    record.node_id !== repositoryNodeId
  ) {
    throw probeFailure(
      'fixture-invalid',
      'The confirmed fixture is not the expected disposable public repository.'
    )
  }

  const status = await safeFetch(
    request,
    `${apiOrigin}/user/starred/${encodeURIComponent(fixture.owner)}/${encodeURIComponent(fixture.name)}`,
    {headers: authenticatedHeaders(accessToken)},
    'Disposable fixture star status could not be checked.'
  )
  if (status.status === 404) {
    throw probeFailure(
      'fixture-not-starred',
      'The confirmed disposable public repository must already be starred.'
    )
  }
  if (status.status !== 204) throw httpProbeFailure(status)
}

function createStableObserver(
  accessToken: string,
  request: ProbeFetch,
  sleep: (milliseconds: number) => Promise<void> = delay
): OAuthListMembershipProbeDependencies['observeStableMemberships'] {
  return async (_expectedGitHubUserId, repositoryNodeId) => {
    let prior: readonly string[] | null = null
    for (let attempt = 1; attempt <= defaultObservationAttempts; attempt += 1) {
      if (attempt > 1) await sleep(defaultObservationDelayMilliseconds)
      const current = await observeCompleteMemberships(
        accessToken,
        repositoryNodeId,
        request
      )
      if (prior && equalIds(prior, current)) {
        return {completeListIds: current, observations: attempt}
      }
      prior = current
    }
    throw probeFailure(
      'observation-unstable',
      'Native List memberships did not converge to two complete matching observations.'
    )
  }
}

async function observeCompleteMemberships(
  accessToken: string,
  repositoryNodeId: string,
  request: ProbeFetch
): Promise<readonly string[]> {
  const listIds: string[] = []
  let catalogCursor: string | null = null
  let catalogPages = 0
  do {
    catalogPages += 1
    if (catalogPages > 1_000) throw observationMalformed()
    const root = await graphql(
      accessToken,
      `query ListMembershipProbeCatalog($after: String) {
        viewer { lists(first: 100, after: $after) {
          pageInfo { hasNextPage endCursor }
          nodes { id }
        } }
      }`,
      {after: catalogCursor},
      request
    )
    const viewer = requireRecord(requireRecord(root.data).viewer)
    const lists = requireRecord(viewer.lists)
    const nodes = requireArray(lists.nodes)
    for (const node of nodes) listIds.push(requireId(requireRecord(node).id))
    catalogCursor = nextCursor(lists.pageInfo)
  } while (catalogCursor !== null)

  const memberships: string[] = []
  for (const listId of listIds) {
    let itemCursor: string | null = null
    let itemPages = 0
    let found = false
    do {
      itemPages += 1
      if (itemPages > 1_000) throw observationMalformed()
      const root = await graphql(
        accessToken,
        `query ListMembershipProbeItems($listId: ID!, $after: String) {
          node(id: $listId) { ... on UserList {
            items(first: 100, after: $after) {
              pageInfo { hasNextPage endCursor }
              nodes { ... on Repository { id } }
            }
          } }
        }`,
        {listId, after: itemCursor},
        request
      )
      const node = requireRecord(requireRecord(root.data).node)
      const items = requireRecord(node.items)
      for (const item of requireArray(items.nodes)) {
        if (requireId(requireRecord(item).id) === repositoryNodeId) found = true
      }
      itemCursor = nextCursor(items.pageInfo)
    } while (itemCursor !== null)
    if (found) memberships.push(listId)
  }
  return [...new Set(memberships)].sort()
}

async function graphql(
  accessToken: string,
  query: string,
  variables: Readonly<Record<string, unknown>>,
  request: ProbeFetch
): Promise<Readonly<Record<string, unknown>>> {
  const response = await safeFetch(
    request,
    graphqlUrl,
    {
      method: 'POST',
      headers: authenticatedHeaders(accessToken, true),
      body: JSON.stringify({query, variables})
    },
    'A complete native List observation could not be loaded.'
  )
  if (!response.ok) throw httpProbeFailure(response)
  const root = requireRecord(await readJson(response))
  if (root.errors !== undefined) {
    throw probeFailure(
      'observation-failed',
      'GitHub rejected a native List observation request.'
    )
  }
  requireRecord(root.data)
  return root
}

function nextCursor(value: unknown): string | null {
  const pageInfo = requireRecord(value)
  if (typeof pageInfo.hasNextPage !== 'boolean') throw observationMalformed()
  if (!pageInfo.hasNextPage) {
    if (pageInfo.endCursor !== null && typeof pageInfo.endCursor !== 'string') {
      throw observationMalformed()
    }
    return null
  }
  return requireId(pageInfo.endCursor)
}

function requireRecord(value: unknown): Readonly<Record<string, unknown>> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw observationMalformed()
  }
  return value as Readonly<Record<string, unknown>>
}

function requireArray(value: unknown): readonly unknown[] {
  if (!Array.isArray(value)) throw observationMalformed()
  return value
}

function requireId(value: unknown): string {
  if (typeof value !== 'string' || !isValue(value)) throw observationMalformed()
  return value
}

function observationMalformed(): OAuthListMembershipProbeFailure {
  return probeFailure(
    'observation-failed',
    'GitHub returned malformed native List observation data.'
  )
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return (await response.json()) as unknown
  } catch {
    throw observationMalformed()
  }
}

async function safeFetch(
  request: ProbeFetch,
  url: string,
  init: RequestInit,
  message: string
): Promise<Response> {
  try {
    return await request(url, init)
  } catch {
    throw probeFailure('observation-failed', message)
  }
}

function httpProbeFailure(response: Response): OAuthListMembershipProbeFailure {
  if (
    response.status === 429 ||
    (response.status === 403 && response.headers.get('x-ratelimit-remaining') === '0')
  ) {
    return probeFailure('observation-failed', 'GitHub rate-limited the capability probe.')
  }
  return probeFailure(
    'observation-failed',
    'GitHub could not complete the native List capability probe.'
  )
}

function apiHeaders(): Readonly<Record<string, string>> {
  return {
    accept: 'application/vnd.github+json',
    'x-github-api-version': apiVersion
  }
}

function authenticatedHeaders(
  accessToken: string,
  jsonBody = false
): Readonly<Record<string, string>> {
  return {
    ...apiHeaders(),
    authorization: `Bearer ${accessToken}`,
    ...(jsonBody ? {'content-type': 'application/json'} : {})
  }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

async function runCli(): Promise<void> {
  const arguments_ = parseCliArguments(Bun.argv.slice(2))
  const clientId = Bun.env.EXTENSION_PUBLIC_GITHUB_WRITE_CLIENT_ID
  if (!clientId) {
    throw probeFailure(
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
    arguments_.expectedGitHubUserId,
    signal
  )
  const nativeFetch = globalThis.fetch
  await validateDisposableFixture(
    arguments_.fixture,
    arguments_.repositoryNodeId,
    state.credential.accessToken,
    nativeFetch
  )

  let writeState: WriteAuthStateRecord | null = state
  const transport = new ListMembershipWriteSession({
    authStore: {
      loadActive: () =>
        Promise.resolve({
          githubUserId: state.githubUserId,
          identity: {githubUserId: state.identity.githubUserId}
        })
    },
    writeStore: {
      loadAccount: (githubUserId) =>
        Promise.resolve(writeState?.githubUserId === githubUserId ? writeState : null),
      deleteAccount: () => {
        writeState = null
        return Promise.resolve()
      }
    },
    fetch: nativeFetch
  })
  const result = await runOAuthListMembershipCapabilityProbe(arguments_, {
    transport,
    observeStableMemberships: createStableObserver(
      state.credential.accessToken,
      nativeFetch
    )
  })
  console.log(
    `Native List membership capability probe succeeded for ${result.fixture} with an unchanged ${result.listCount}-List set and independent read-back.`
  )
}

if (import.meta.main) {
  try {
    await runCli()
  } catch (error: unknown) {
    console.error(
      error instanceof OAuthListMembershipProbeFailure ||
        error instanceof ListMembershipMutationFailure ||
        error instanceof WriteDeviceAuthorizationFailure
        ? error.message
        : 'The native List membership capability probe failed safely.'
    )
    process.exitCode = 1
  }
}
