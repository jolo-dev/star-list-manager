import {
  GitHubWriteDeviceFlow,
  WriteDeviceAuthorizationFailure
} from '../src/auth/write-device-flow'
import type {WriteAuthStateRecord} from '../src/domain/types'
import {
  ListRenameMutationFailure,
  ListRenameWriteSession,
  type ListRenameMutationRequest,
  type ListRenameMutationResult
} from '../src/github/list-rename-write-session'
import type {ListRenameCapabilityProof} from '../src/github/list-rename-capability'

const apiOrigin = 'https://api.github.com'
const graphqlUrl = `${apiOrigin}/graphql`
const apiVersion = '2026-03-10'
const cleanupMessage =
  'CLEANUP REQUIRED: Manually restore the confirmed disposable List to its original name on GitHub and independently verify it before recording any capability result. The capability probe did not succeed.'

export type ListRenameProbeFailureCode =
  | 'invalid-input'
  | 'fixture-invalid'
  | 'catalog-read-failed'
  | 'mutation-failed'
  | 'read-back-mismatch'
  | 'cleanup-failed'

export class OAuthListRenameProbeFailure extends Error {
  readonly code: ListRenameProbeFailureCode
  readonly cleanupRequired: boolean

  constructor(
    code: ListRenameProbeFailureCode,
    message: string,
    cleanupRequired = false
  ) {
    super(message)
    this.name = 'OAuthListRenameProbeFailure'
    this.code = code
    this.cleanupRequired = cleanupRequired
  }
}

export interface OAuthListRenameProbeOptions {
  readonly disposableListNodeId: string
  readonly expectedOriginalName: string
  readonly temporaryName: string
  readonly expectedGitHubUserId: string
}

export interface NativeListCatalogEntry {
  readonly listNodeId: string
  readonly name: string
}

export type NativeListCatalogObservation = readonly NativeListCatalogEntry[]

export interface OAuthListRenameProbeDependencies {
  readonly validateExpectedOwner: (expectedGitHubUserId: string) => Promise<void>
  readonly transport: {
    rename(request: ListRenameMutationRequest): Promise<ListRenameMutationResult>
  }
  readonly readCompleteCatalog: (
    expectedGitHubUserId: string
  ) => Promise<NativeListCatalogObservation>
}

export interface OAuthListRenameProbeResult {
  readonly githubUserId: string
  readonly listNodeId: string
  readonly proof: ListRenameCapabilityProof
}

export async function runOAuthListRenameCapabilityProbe(
  options: OAuthListRenameProbeOptions,
  dependencies: OAuthListRenameProbeDependencies
): Promise<OAuthListRenameProbeResult> {
  const listNodeId = requireValue(options.disposableListNodeId)
  const expectedOriginalName = canonicalName(options.expectedOriginalName)
  const temporaryName = canonicalName(options.temporaryName)
  const expectedGitHubUserId = requireValue(options.expectedGitHubUserId)

  if (sameCanonicalNameKey(expectedOriginalName, temporaryName)) {
    throw probeFailure(
      'invalid-input',
      'The temporary disposable List name must differ from the original name.'
    )
  }

  await validateOwner(dependencies, expectedGitHubUserId)
  const initialCatalog = await readCatalog(dependencies, expectedGitHubUserId)
  requireCatalog(initialCatalog)
  requireFixture(initialCatalog, listNodeId, expectedOriginalName)
  requireTemporaryNameIsUnique(initialCatalog, temporaryName)

  let primaryFailure: OAuthListRenameProbeFailure | null = null
  try {
    await renameAndVerify(
      dependencies,
      expectedGitHubUserId,
      listNodeId,
      temporaryName
    )
  } catch (error: unknown) {
    primaryFailure = safeFailure(error)
  }

  try {
    await renameAndVerify(
      dependencies,
      expectedGitHubUserId,
      listNodeId,
      expectedOriginalName
    )
  } catch {
    throw probeFailure('cleanup-failed', cleanupMessage, true)
  }

  if (primaryFailure) throw primaryFailure

  return {
    githubUserId: expectedGitHubUserId,
    listNodeId,
    proof: {
      schema: 'available',
      oauthUserScope: 'verified',
      accountOwnership: 'verified',
      temporaryRenameMutation: 'verified',
      restorationMutation: 'verified',
      temporaryCatalogReadBack: 'verified',
      restorationCatalogReadBack: 'verified'
    }
  }
}

async function renameAndVerify(
  dependencies: OAuthListRenameProbeDependencies,
  expectedGitHubUserId: string,
  listNodeId: string,
  expectedName: string
): Promise<void> {
  let mutation: ListRenameMutationResult
  try {
    mutation = await dependencies.transport.rename({
      expectedGitHubUserId,
      listNodeId,
      name: expectedName
    })
  } catch {
    throw probeFailure(
      'mutation-failed',
      'GitHub did not accept the confirmed disposable List rename mutation.'
    )
  }
  if (
    mutation.listNodeId !== listNodeId ||
    !isName(mutation.name) ||
    !sameName(canonicalName(mutation.name), expectedName)
  ) {
    throw probeFailure(
      'mutation-failed',
      'GitHub did not return the confirmed disposable List rename result.'
    )
  }

  const catalog = await readCatalog(dependencies, expectedGitHubUserId)
  requireCatalog(catalog)
  const fixture = catalog.find((entry) => entry.listNodeId === listNodeId)
  if (!fixture || !sameName(canonicalName(fixture.name), expectedName)) {
    throw probeFailure(
      'read-back-mismatch',
      'Independent complete List catalog read-back did not confirm the expected disposable List name.'
    )
  }
}

async function validateOwner(
  dependencies: OAuthListRenameProbeDependencies,
  expectedGitHubUserId: string
): Promise<void> {
  try {
    await dependencies.validateExpectedOwner(expectedGitHubUserId)
  } catch {
    throw probeFailure(
      'fixture-invalid',
      'The confirmed GitHub owner could not be validated for the disposable List probe.'
    )
  }
}

async function readCatalog(
  dependencies: OAuthListRenameProbeDependencies,
  expectedGitHubUserId: string
): Promise<NativeListCatalogObservation> {
  try {
    return await dependencies.readCompleteCatalog(expectedGitHubUserId)
  } catch (error: unknown) {
    if (error instanceof OAuthListRenameProbeFailure) throw error
    throw probeFailure(
      'catalog-read-failed',
      'A complete native List catalog could not be read independently.'
    )
  }
}

function requireFixture(
  catalog: NativeListCatalogObservation,
  listNodeId: string,
  expectedOriginalName: string
): void {
  const fixture = catalog.find((entry) => entry.listNodeId === listNodeId)
  if (!fixture || !sameName(canonicalName(fixture.name), expectedOriginalName)) {
    throw probeFailure(
      'fixture-invalid',
      'The confirmed disposable List ID and original name did not match the complete catalog.'
    )
  }
}

function requireTemporaryNameIsUnique(
  catalog: NativeListCatalogObservation,
  temporaryName: string
): void {
  if (
    catalog.some((entry) => sameCanonicalNameKey(entry.name, temporaryName))
  ) {
    throw probeFailure(
      'fixture-invalid',
      'The confirmed temporary disposable List name is already present in the complete catalog.'
    )
  }
}

function requireCatalog(catalog: NativeListCatalogObservation): void {
  if (
    !Array.isArray(catalog) ||
    catalog.some(
      (entry) =>
        !isRecord(entry) ||
        !isValue(entry.listNodeId) ||
        !isName(entry.name)
    ) ||
    new Set(catalog.map((entry) => entry.listNodeId)).size !== catalog.length
  ) {
    throw probeFailure(
      'catalog-read-failed',
      'GitHub returned malformed native List catalog data.'
    )
  }
}

function canonicalName(value: string): string {
  if (!isName(value)) {
    throw probeFailure('invalid-input', 'A confirmed disposable List name is invalid.')
  }
  return value.normalize('NFKC').trim()
}

function sameName(left: string, right: string): boolean {
  return left === right
}

function sameCanonicalNameKey(left: string, right: string): boolean {
  return canonicalNameKey(left) === canonicalNameKey(right)
}

function canonicalNameKey(value: string): string {
  return canonicalName(value).toLocaleLowerCase()
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isName(value: unknown): value is string {
  return typeof value === 'string' && value.normalize('NFKC').trim().length > 0
}

function requireValue(value: string): string {
  if (!isValue(value)) {
    throw probeFailure('invalid-input', 'A required capability probe value is invalid.')
  }
  return value
}

function isValue(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.trim() === value
}

function safeFailure(error: unknown): OAuthListRenameProbeFailure {
  return error instanceof OAuthListRenameProbeFailure
    ? error
    : probeFailure('mutation-failed', 'The disposable List rename probe failed safely.')
}

function probeFailure(
  code: ListRenameProbeFailureCode,
  message: string,
  cleanupRequired = false
): OAuthListRenameProbeFailure {
  return new OAuthListRenameProbeFailure(code, message, cleanupRequired)
}

type ProbeFetch = (
  input: RequestInfo | URL,
  init?: RequestInit
) => Promise<Response>

interface CliArguments extends OAuthListRenameProbeOptions {}

export function parseCliArguments(arguments_: readonly string[]): CliArguments {
  const prefixes = [
    '--list-node-id=',
    '--original-name=',
    '--temporary-name=',
    '--github-user-id='
  ] as const
  const confirmationCount = arguments_.filter(
    (argument) => argument === '--confirm-disposable-list-rename'
  ).length
  const unknown = arguments_.some(
    (argument) =>
      argument !== '--confirm-disposable-list-rename' &&
      !prefixes.some((prefix) => argument.startsWith(prefix))
  )
  if (confirmationCount !== 1 || unknown) {
    throw probeFailure(
      'invalid-input',
      'Usage requires --confirm-disposable-list-rename and the documented fixture arguments.'
    )
  }
  return {
    disposableListNodeId: requiredCliArgument(arguments_, '--list-node-id='),
    expectedOriginalName: requiredCliArgument(arguments_, '--original-name='),
    temporaryName: requiredCliArgument(arguments_, '--temporary-name='),
    expectedGitHubUserId: requiredCliArgument(arguments_, '--github-user-id=')
  }
}

function requiredCliArgument(arguments_: readonly string[], prefix: string): string {
  const matches = arguments_.filter((argument) => argument.startsWith(prefix))
  if (matches.length !== 1) {
    throw probeFailure(
      'invalid-input',
      'Each required capability probe argument must occur exactly once.'
    )
  }
  return requireValue(matches[0]?.slice(prefix.length) ?? '')
}

export function createCompleteCatalogReader(
  accessToken: string,
  request: ProbeFetch
): OAuthListRenameProbeDependencies['readCompleteCatalog'] {
  return async (_expectedGitHubUserId) => {
    const catalog: NativeListCatalogEntry[] = []
    let cursor: string | null = null
    let pages = 0
    do {
      pages += 1
      if (pages > 1_000) throw catalogMalformed()
      const root = await graphql(
        accessToken,
        `query NativeListRenameProbeCatalog($after: String) {
          viewer { lists(first: 100, after: $after) {
            pageInfo { hasNextPage endCursor }
            nodes { id name }
          } }
        }`,
        {after: cursor},
        request
      )
      const viewer = requireRecord(requireRecord(root.data).viewer)
      const lists = requireRecord(viewer.lists)
      for (const node of requireArray(lists.nodes)) {
        const entry = requireRecord(node)
        const listNodeId = requireIdentifier(entry.id)
        const name = requireName(entry.name)
        catalog.push({listNodeId, name})
      }
      cursor = nextCursor(lists.pageInfo)
    } while (cursor !== null)
    return catalog
  }
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
      headers: authenticatedHeaders(accessToken),
      body: JSON.stringify({query, variables})
    },
    'A complete native List catalog could not be loaded.'
  )
  if (!response.ok) throw httpProbeFailure(response)
  const root = requireRecord(await readJson(response))
  if (root.errors !== undefined) {
    throw probeFailure('catalog-read-failed', 'GitHub rejected a native List catalog request.')
  }
  requireRecord(root.data)
  return root
}

function nextCursor(value: unknown): string | null {
  const pageInfo = requireRecord(value)
  if (typeof pageInfo.hasNextPage !== 'boolean') throw catalogMalformed()
  if (!pageInfo.hasNextPage) {
    if (pageInfo.endCursor !== null && typeof pageInfo.endCursor !== 'string') {
      throw catalogMalformed()
    }
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
  if (!isValue(value)) throw catalogMalformed()
  return value
}

function requireName(value: unknown): string {
  if (!isName(value)) throw catalogMalformed()
  return value.normalize('NFKC').trim()
}

function catalogMalformed(): OAuthListRenameProbeFailure {
  return probeFailure('catalog-read-failed', 'GitHub returned malformed native List catalog data.')
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return (await response.json()) as unknown
  } catch {
    throw catalogMalformed()
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
    throw probeFailure('catalog-read-failed', message)
  }
}

function httpProbeFailure(response: Response): OAuthListRenameProbeFailure {
  if (
    response.status === 429 ||
    (response.status === 403 && response.headers.get('x-ratelimit-remaining') === '0')
  ) {
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

  let writeState: WriteAuthStateRecord | null = state
  const transport = new ListRenameWriteSession({
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
    fetch: globalThis.fetch
  })
  await runOAuthListRenameCapabilityProbe(arguments_, {
    validateExpectedOwner: async (expectedGitHubUserId) => {
      if (
        state.githubUserId !== expectedGitHubUserId ||
        state.identity.githubUserId !== expectedGitHubUserId
      ) {
        throw new Error('The device authorization owner did not match the confirmed account.')
      }
    },
    transport,
    readCompleteCatalog: createCompleteCatalogReader(
      state.credential.accessToken,
      globalThis.fetch
    )
  })
  console.log('Native List rename capability probe succeeded for the confirmed disposable List.')
}

if (import.meta.main) {
  try {
    await runCli()
  } catch (error: unknown) {
    console.error(
      error instanceof OAuthListRenameProbeFailure ||
        error instanceof ListRenameMutationFailure ||
        error instanceof WriteDeviceAuthorizationFailure
        ? error.message
        : 'The native List rename capability probe failed safely.'
    )
    process.exitCode = 1
  }
}
