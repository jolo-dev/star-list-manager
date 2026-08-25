import {
  GitHubWriteDeviceFlow,
  WriteDeviceAuthorizationFailure
} from '../src/auth/write-device-flow'
import type {WriteAuthStateRecord} from '../src/domain/types'
import {
  ListLifecycleMutationFailure,
  ListLifecycleWriteSession,
  type CreatedNativeList,
  type CreateNativeListRequest,
  type DeleteNativeListRequest
} from '../src/github/list-lifecycle-write-session'
import type {ListLifecycleCapabilityProof} from '../src/github/list-lifecycle-capability'

const graphqlUrl = 'https://api.github.com/graphql'
const apiVersion = '2026-03-10'
const catalogDocument = `query NativeListLifecycleProbeCatalog($after: String) {
  viewer { lists(first: 100, after: $after) {
    pageInfo { hasNextPage endCursor }
    nodes { id name isPrivate }
  } }
}`
const cleanupMessage =
  'CLEANUP REQUIRED: The disposable List may remain on GitHub. Manually inspect the confirmed disposable fixture, delete only the List created by this probe, and independently verify its absence before recording any capability result.'

export type ListLifecycleProbeFailureCode =
  | 'invalid-input'
  | 'fixture-invalid'
  | 'catalog-read-failed'
  | 'mutation-failed'
  | 'read-back-mismatch'
  | 'cleanup-required'

export class OAuthListLifecycleProbeFailure extends Error {
  readonly code: ListLifecycleProbeFailureCode
  readonly cleanupRequired: boolean

  constructor(code: ListLifecycleProbeFailureCode, message: string, cleanupRequired = false) {
    super(message)
    this.name = 'OAuthListLifecycleProbeFailure'
    this.code = code
    this.cleanupRequired = cleanupRequired
  }
}

export interface OAuthListLifecycleProbeOptions {
  readonly fixtureName: string
  readonly visibility: 'public' | 'private'
  readonly expectedGitHubUserId: string
}

export interface NativeListCatalogEntry {
  readonly listNodeId: string
  readonly name: string
  readonly visibility: 'public' | 'private'
}

export type NativeListCatalogObservation = readonly NativeListCatalogEntry[]

export interface OAuthListLifecycleProbeDependencies {
  readonly validateExpectedOwner: (expectedGitHubUserId: string) => Promise<void>
  readonly transport: {
    createList(request: CreateNativeListRequest): Promise<CreatedNativeList>
    deleteList(request: DeleteNativeListRequest): Promise<void>
  }
  readonly readCompleteCatalog: (expectedGitHubUserId: string) => Promise<NativeListCatalogObservation>
}

export interface OAuthListLifecycleProbeResult {
  readonly githubUserId: string
  readonly proof: ListLifecycleCapabilityProof
}

export async function runOAuthListLifecycleCapabilityProbe(
  options: OAuthListLifecycleProbeOptions,
  dependencies: OAuthListLifecycleProbeDependencies
): Promise<OAuthListLifecycleProbeResult> {
  const fixtureName = canonicalName(options.fixtureName)
  const visibility = requireVisibility(options.visibility)
  const expectedGitHubUserId = requireValue(options.expectedGitHubUserId)

  await validateOwner(dependencies, expectedGitHubUserId)
  const initialCatalog = await readCatalog(dependencies, expectedGitHubUserId)
  requireCatalog(initialCatalog)
  if (initialCatalog.some((entry) => entry.name === fixtureName)) {
    throw probeFailure('fixture-invalid', 'The explicit disposable List name is already present in the complete catalog.')
  }

  let created: CreatedNativeList
  try {
    created = await dependencies.transport.createList({
      expectedGitHubUserId,
      name: fixtureName,
      visibility
    })
  } catch {
    throw probeFailure('mutation-failed', 'GitHub did not confirm creation of the disposable List fixture.')
  }

  let createdId: string
  try {
    createdId = validateCreatedList(created, fixtureName, visibility)
  } catch (error: unknown) {
    const id = validIdentifier(created?.listNodeId) ? created.listNodeId : null
    if (!id) throw safeFailure(error)
    return failAfterCleanup(dependencies, expectedGitHubUserId, id, safeFailure(error))
  }

  let primaryFailure: OAuthListLifecycleProbeFailure | null = null
  try {
    const createdCatalog = await readCatalog(dependencies, expectedGitHubUserId)
    requireCatalog(createdCatalog)
    const observed = createdCatalog.find((entry) => entry.listNodeId === createdId)
    if (!observed || observed.name !== fixtureName || observed.visibility !== visibility) {
      throw probeFailure('read-back-mismatch', 'Independent complete catalog read-back did not confirm the created disposable List.')
    }
  } catch (error: unknown) {
    primaryFailure = safeFailure(error)
  }

  return finishDeleteAndObserve(
    dependencies,
    expectedGitHubUserId,
    createdId,
    primaryFailure
  )
}

async function failAfterCleanup(
  dependencies: OAuthListLifecycleProbeDependencies,
  expectedGitHubUserId: string,
  listNodeId: string,
  primaryFailure: OAuthListLifecycleProbeFailure
): Promise<never> {
  await finishDeleteAndObserve(dependencies, expectedGitHubUserId, listNodeId, primaryFailure)
  throw primaryFailure
}

async function finishDeleteAndObserve(
  dependencies: OAuthListLifecycleProbeDependencies,
  expectedGitHubUserId: string,
  listNodeId: string,
  primaryFailure: OAuthListLifecycleProbeFailure | null
): Promise<OAuthListLifecycleProbeResult> {
  try {
    await dependencies.transport.deleteList({expectedGitHubUserId, listNodeId})
    const finalCatalog = await readCatalog(dependencies, expectedGitHubUserId)
    requireCatalog(finalCatalog)
    if (finalCatalog.some((entry) => entry.listNodeId === listNodeId)) {
      throw probeFailure('cleanup-required', cleanupMessage, true)
    }
  } catch {
    throw probeFailure('cleanup-required', cleanupMessage, true)
  }

  if (primaryFailure) throw primaryFailure
  return {
    githubUserId: expectedGitHubUserId,
    proof: {
      schema: 'available',
      oauthUserScope: 'verified',
      accountOwnership: 'verified',
      createReadBack: 'verified',
      deleteReadBack: 'verified'
    }
  }
}

function validateCreatedList(
  created: CreatedNativeList,
  fixtureName: string,
  visibility: 'public' | 'private'
): string {
  if (
    !created ||
    !validIdentifier(created.listNodeId) ||
    created.name !== fixtureName ||
    created.visibility !== visibility
  ) {
    throw probeFailure('mutation-failed', 'GitHub did not return the confirmed disposable List creation result.')
  }
  return created.listNodeId
}

async function validateOwner(
  dependencies: OAuthListLifecycleProbeDependencies,
  expectedGitHubUserId: string
): Promise<void> {
  try {
    await dependencies.validateExpectedOwner(expectedGitHubUserId)
  } catch {
    throw probeFailure('fixture-invalid', 'The confirmed GitHub owner could not be validated for the disposable List probe.')
  }
}

async function readCatalog(
  dependencies: OAuthListLifecycleProbeDependencies,
  expectedGitHubUserId: string
): Promise<NativeListCatalogObservation> {
  try {
    return await dependencies.readCompleteCatalog(expectedGitHubUserId)
  } catch (error: unknown) {
    if (error instanceof OAuthListLifecycleProbeFailure) throw error
    throw probeFailure('catalog-read-failed', 'A complete native List catalog could not be read independently.')
  }
}

function requireCatalog(catalog: NativeListCatalogObservation): void {
  if (
    !Array.isArray(catalog) ||
    catalog.some((entry) => !isCatalogEntry(entry)) ||
    new Set(catalog.map((entry) => entry.listNodeId)).size !== catalog.length
  ) {
    throw probeFailure('catalog-read-failed', 'GitHub returned malformed native List catalog data.')
  }
}

function isCatalogEntry(value: unknown): value is NativeListCatalogEntry {
  if (!isRecord(value)) return false
  return validIdentifier(value.listNodeId) && isName(value.name) && (value.visibility === 'public' || value.visibility === 'private')
}

function canonicalName(value: string): string {
  if (!isName(value)) throw probeFailure('invalid-input', 'An explicit disposable List name is required.')
  return value.normalize('NFKC').trim()
}

function requireVisibility(value: unknown): 'public' | 'private' {
  if (value !== 'public' && value !== 'private') {
    throw probeFailure('invalid-input', 'An explicit public or private disposable List visibility is required.')
  }
  return value
}

function requireValue(value: string): string {
  if (!validIdentifier(value)) throw probeFailure('invalid-input', 'A required capability probe value is invalid.')
  return value
}

function validIdentifier(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.trim() === value
}

function isName(value: unknown): value is string {
  return typeof value === 'string' && value.normalize('NFKC').trim().length > 0
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function safeFailure(error: unknown): OAuthListLifecycleProbeFailure {
  return error instanceof OAuthListLifecycleProbeFailure
    ? error
    : probeFailure('mutation-failed', 'The disposable List lifecycle probe failed safely.')
}

function probeFailure(
  code: ListLifecycleProbeFailureCode,
  message: string,
  cleanupRequired = false
): OAuthListLifecycleProbeFailure {
  return new OAuthListLifecycleProbeFailure(code, message, cleanupRequired)
}

type ProbeFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

interface CliArguments extends OAuthListLifecycleProbeOptions {}

export function parseCliArguments(arguments_: readonly string[]): CliArguments {
  const prefixes = ['--fixture-name=', '--visibility=', '--github-user-id='] as const
  const confirmationCount = arguments_.filter(
    (argument) => argument === '--confirm-disposable-list-lifecycle'
  ).length
  const unknown = arguments_.some(
    (argument) => argument !== '--confirm-disposable-list-lifecycle' && !prefixes.some((prefix) => argument.startsWith(prefix))
  )
  if (confirmationCount !== 1 || unknown) {
    throw probeFailure('invalid-input', 'Usage requires --confirm-disposable-list-lifecycle and the documented fixture arguments.')
  }
  return {
    fixtureName: canonicalName(requiredCliArgument(arguments_, '--fixture-name=')),
    visibility: requireVisibility(requiredCliArgument(arguments_, '--visibility=')),
    expectedGitHubUserId: requireValue(requiredCliArgument(arguments_, '--github-user-id='))
  }
}

function requiredCliArgument(arguments_: readonly string[], prefix: string): string {
  const matches = arguments_.filter((argument) => argument.startsWith(prefix))
  if (matches.length !== 1) throw probeFailure('invalid-input', 'Each required capability probe argument must occur exactly once.')
  return matches[0]?.slice(prefix.length) ?? ''
}

export function createCompleteCatalogReader(
  accessToken: string,
  request: ProbeFetch
): OAuthListLifecycleProbeDependencies['readCompleteCatalog'] {
  return async () => {
    const catalog: NativeListCatalogEntry[] = []
    let cursor: string | null = null
    let pages = 0
    do {
      if (++pages > 1_000) throw catalogMalformed()
      const root = await graphql(accessToken, {after: cursor}, request)
      const lists = requireRecord(requireRecord(requireRecord(root.data).viewer).lists)
      for (const node of requireArray(lists.nodes)) {
        const entry = requireRecord(node)
        const listNodeId = requireIdentifier(entry.id)
        const name = canonicalCatalogName(entry.name)
        if (typeof entry.isPrivate !== 'boolean') throw catalogMalformed()
        catalog.push({listNodeId, name, visibility: entry.isPrivate ? 'private' : 'public'})
      }
      cursor = nextCursor(lists.pageInfo)
    } while (cursor !== null)
    return catalog
  }
}

async function graphql(
  accessToken: string,
  variables: Readonly<Record<string, unknown>>,
  request: ProbeFetch
): Promise<Readonly<Record<string, unknown>>> {
  let response: Response
  try {
    response = await request(graphqlUrl, {
      method: 'POST',
      headers: authenticatedHeaders(accessToken),
      body: JSON.stringify({query: catalogDocument, variables})
    })
  } catch {
    throw probeFailure('catalog-read-failed', 'A complete native List catalog could not be loaded.')
  }
  if (!response.ok) throw httpProbeFailure(response)
  let root: Readonly<Record<string, unknown>>
  try {
    root = requireRecord(await response.json())
  } catch {
    throw catalogMalformed()
  }
  if (root.errors !== undefined) throw probeFailure('catalog-read-failed', 'GitHub rejected a native List catalog request.')
  requireRecord(root.data)
  return root
}

function nextCursor(value: unknown): string | null {
  const pageInfo = requireRecord(value)
  if (typeof pageInfo.hasNextPage !== 'boolean') throw catalogMalformed()
  if (!pageInfo.hasNextPage) {
    if (pageInfo.endCursor !== null && typeof pageInfo.endCursor !== 'string') throw catalogMalformed()
    return null
  }
  return requireIdentifier(pageInfo.endCursor)
}

function requireRecord(value: unknown): Readonly<Record<string, unknown>> {
  if (!isRecord(value)) throw catalogMalformed()
  return value
}

function requireArray(value: unknown): readonly unknown[] {
  if (!Array.isArray(value)) throw catalogMalformed()
  return value
}

function requireIdentifier(value: unknown): string {
  if (!validIdentifier(value)) throw catalogMalformed()
  return value
}

function canonicalCatalogName(value: unknown): string {
  if (!isName(value)) throw catalogMalformed()
  return value.normalize('NFKC').trim()
}

function catalogMalformed(): OAuthListLifecycleProbeFailure {
  return probeFailure('catalog-read-failed', 'GitHub returned malformed native List catalog data.')
}

function httpProbeFailure(response: Response): OAuthListLifecycleProbeFailure {
  if (response.status === 429 || (response.status === 403 && response.headers.get('x-ratelimit-remaining') === '0')) {
    return probeFailure('catalog-read-failed', 'GitHub rate-limited the capability probe.')
  }
  return probeFailure('catalog-read-failed', 'GitHub could not complete the native List catalog read.')
}

function authenticatedHeaders(accessToken: string): Readonly<Record<string, string>> {
  return {
    accept: 'application/vnd.github+json',
    authorization: `Bearer ${accessToken}`,
    'content-type': 'application/json',
    'x-github-api-version': apiVersion
  }
}

async function runCli(): Promise<void> {
  const arguments_ = parseCliArguments(Bun.argv.slice(2))
  const clientId = Bun.env.EXTENSION_PUBLIC_GITHUB_WRITE_CLIENT_ID
  if (!clientId) throw probeFailure('invalid-input', 'Set EXTENSION_PUBLIC_GITHUB_WRITE_CLIENT_ID before running the probe.')

  const signal = new AbortController().signal
  const flow = new GitHubWriteDeviceFlow({clientId})
  const grant = await flow.requestAuthorization(signal)
  console.log(`Open ${grant.verificationUri} and enter code ${grant.userCode}`)
  console.log('Waiting for GitHub OAuth authorization...')
  const state = await flow.completeAuthorization(grant, arguments_.expectedGitHubUserId, signal)
  let writeState: WriteAuthStateRecord | null = state
  const transport = new ListLifecycleWriteSession({
    authStore: {
      loadActive: () => Promise.resolve({githubUserId: state.githubUserId, identity: {githubUserId: state.identity.githubUserId}})
    },
    writeStore: {
      loadAccount: (githubUserId) => Promise.resolve(writeState?.githubUserId === githubUserId ? writeState : null),
      deleteAccount: () => {
        writeState = null
        return Promise.resolve()
      }
    },
    fetch: globalThis.fetch
  })
  await runOAuthListLifecycleCapabilityProbe(arguments_, {
    validateExpectedOwner: (expectedGitHubUserId) => {
      if (state.githubUserId !== expectedGitHubUserId || state.identity.githubUserId !== expectedGitHubUserId) {
        return Promise.reject(new Error('owner mismatch'))
      }
      return Promise.resolve()
    },
    transport,
    readCompleteCatalog: createCompleteCatalogReader(state.credential.accessToken, globalThis.fetch)
  })
  console.log('Native List lifecycle capability probe succeeded after verified creation and deletion of the disposable fixture.')
}

if (import.meta.main) {
  try {
    await runCli()
  } catch (error: unknown) {
    console.error(
      error instanceof OAuthListLifecycleProbeFailure ||
        error instanceof ListLifecycleMutationFailure ||
        error instanceof WriteDeviceAuthorizationFailure
        ? error.message
        : 'The native List lifecycle capability probe failed safely.'
    )
    process.exitCode = 1
  }
}
