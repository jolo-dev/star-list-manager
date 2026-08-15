import type {GitHubUserId, NativeListNodeId, NativeListRecord} from '../domain/types'
import {
  canonicalNativeListName,
  nativeListNamesEquivalent,
  validateNativeListRename
} from '../domain/native-list-rename'
import type {
  ListRenameMutationRequest,
  ListRenameWriteSession
} from '../github/list-rename-write-session'
import type {NativeListCatalogPage} from '../github/graphql-client'
import type {NativeListReader} from './native-list-sync'
import {AppFailure, sanitizeError} from '../shared/errors'
import {isIsoDateTime} from '../shared/validation'

const defaultMaxCatalogPages = 1_000

export type NativeListRenameServiceFailureReason =
  | 'invalid-request'
  | 'local-target-missing'
  | 'local-account-mismatch'
  | 'local-empty-name'
  | 'local-duplicate-name'
  | 'catalog-reader-failed'
  | 'catalog-invalid'
  | 'catalog-bound-exceeded'
  | 'catalog-incomplete'
  | 'catalog-duplicate'
  | 'read-back-target-missing'
  | 'read-back-name-mismatch'
  | 'read-back-duplicate-name'

export class NativeListRenameServiceFailure extends AppFailure {
  readonly reason: NativeListRenameServiceFailureReason

  constructor(
    reason: NativeListRenameServiceFailureReason,
    publicError: ConstructorParameters<typeof AppFailure>[0]
  ) {
    super(publicError)
    this.name = 'NativeListRenameServiceFailure'
    this.reason = reason
  }
}

export interface NativeListRenameStorage {
  readonly getNativeList: (
    database: IDBDatabase,
    githubUserId: GitHubUserId,
    listNodeId: NativeListNodeId
  ) => Promise<NativeListRecord | null>
  readonly listNativeLists: (
    database: IDBDatabase,
    githubUserId: GitHubUserId
  ) => Promise<readonly NativeListRecord[]>
  readonly putNativeList: (database: IDBDatabase, list: NativeListRecord) => Promise<void>
}

export interface NativeListRenameServiceOptions {
  readonly database: IDBDatabase
  readonly storage: NativeListRenameStorage
  readonly writer: Pick<ListRenameWriteSession, 'rename'>
  readonly reader: Pick<NativeListReader, 'fetchNativeListCatalogPage'>
  readonly now?: () => number
  readonly maxCatalogPages?: number
}

export class NativeListRenameService {
  readonly #database: IDBDatabase
  readonly #storage: NativeListRenameStorage
  readonly #writer: Pick<ListRenameWriteSession, 'rename'>
  readonly #reader: Pick<NativeListReader, 'fetchNativeListCatalogPage'>
  readonly #now: () => number
  readonly #maxCatalogPages: number

  constructor(options: NativeListRenameServiceOptions) {
    this.#database = options.database
    this.#storage = options.storage
    this.#writer = options.writer
    this.#reader = options.reader
    this.#now = options.now ?? Date.now
    this.#maxCatalogPages = validateMaxCatalogPages(options.maxCatalogPages)
  }

  async rename(request: ListRenameMutationRequest): Promise<NativeListRecord> {
    const canonicalRequest = validateRequest(request)
    const localTarget = await this.#storage.getNativeList(
      this.#database,
      canonicalRequest.expectedGitHubUserId,
      canonicalRequest.listNodeId
    )
    if (!localTarget) {
      throw failure(
        'local-target-missing',
        'validation',
        'The native List is no longer available in the local catalog.',
        false
      )
    }
    if (localTarget.githubUserId !== canonicalRequest.expectedGitHubUserId) {
      throw failure(
        'local-account-mismatch',
        'authentication',
        'The local native List does not belong to the active GitHub account.',
        true
      )
    }
    if (localTarget.listNodeId !== canonicalRequest.listNodeId) {
      throw failure(
        'local-target-missing',
        'validation',
        'The native List is no longer available in the local catalog.',
        false
      )
    }

    const localCatalog = await this.#storage.listNativeLists(
      this.#database,
      canonicalRequest.expectedGitHubUserId
    )
    const matchingLocalTargets = localCatalog.filter(
      (list) =>
        list.githubUserId === canonicalRequest.expectedGitHubUserId &&
        list.listNodeId === canonicalRequest.listNodeId
    )
    if (matchingLocalTargets.length !== 1) {
      const targetForAnotherAccount = localCatalog.some(
        (list) =>
          list.listNodeId === canonicalRequest.listNodeId &&
          list.githubUserId !== canonicalRequest.expectedGitHubUserId
      )
      throw failure(
        targetForAnotherAccount ? 'local-account-mismatch' : 'local-target-missing',
        targetForAnotherAccount ? 'authentication' : 'validation',
        targetForAnotherAccount
          ? 'The local native List does not belong to the active GitHub account.'
          : 'The native List is no longer available in the local catalog.',
        targetForAnotherAccount
      )
    }
    const validation = validateNativeListRename(
      canonicalRequest.name,
      canonicalRequest.listNodeId,
      localCatalog
    )
    if (!validation.ok) {
      throw failure(
        validation.error.code === 'empty' ? 'local-empty-name' : 'local-duplicate-name',
        'validation',
        validation.error.message,
        false
      )
    }

    await this.#writer.rename(canonicalRequest)

    const catalog = await this.#readCompleteCatalog()
    const verifiedTarget = catalog.get(canonicalRequest.listNodeId)
    if (!verifiedTarget) {
      throw failure(
        'read-back-target-missing',
        'validation',
        'GitHub no longer reports the renamed native List.',
        true
      )
    }
    if (canonicalNativeListName(verifiedTarget.name) !== canonicalRequest.name) {
      throw failure(
        'read-back-name-mismatch',
        'validation',
        'GitHub did not verify the requested native List name.',
        true
      )
    }
    for (const list of catalog.values()) {
      if (
        list.listNodeId !== canonicalRequest.listNodeId &&
        nativeListNamesEquivalent(list.name, canonicalRequest.name)
      ) {
        throw failure(
          'read-back-duplicate-name',
          'validation',
          'GitHub reported another native List with the requested name.',
          true
        )
      }
    }

    const updated = verifiedRecord(
      localTarget,
      canonicalRequest.expectedGitHubUserId,
      verifiedTarget,
      canonicalRequest.name,
      this.#timestamp()
    )
    await this.#storage.putNativeList(this.#database, updated)
    return updated
  }

  async #readCompleteCatalog(): Promise<Map<NativeListNodeId, NativeListCatalogPage['lists'][number]>> {
    const catalog = new Map<NativeListNodeId, NativeListCatalogPage['lists'][number]>()
    const cursors = new Set<string>()
    let cursor: string | null = null
    let catalogTotal: number | null = null
    let pagesRead = 0

    do {
      if (pagesRead >= this.#maxCatalogPages) {
        throw failure(
          'catalog-bound-exceeded',
          'validation',
          'GitHub native List catalog exceeded the safe pagination limit.',
          true
        )
      }
      const page = await this.#fetchCatalogPage(cursor)
      pagesRead += 1
      if (catalogTotal !== null && catalogTotal !== page.totalCount) {
        throw failure(
          'catalog-incomplete',
          'validation',
          'GitHub native List catalog changed during pagination.',
          true
        )
      }
      catalogTotal = page.totalCount
      for (const list of page.lists) {
        if (catalog.has(list.listNodeId)) {
          throw failure(
            'catalog-duplicate',
            'validation',
            'GitHub native List catalog contained duplicate List IDs.',
            true
          )
        }
        catalog.set(list.listNodeId, list)
      }
      cursor = nextCursor(page.pageInfo.hasNextPage, page.pageInfo.endCursor)
      if (cursor !== null) {
        if (cursors.has(cursor)) {
          throw failure(
            'catalog-invalid',
            'validation',
            'GitHub native List catalog repeated a pagination cursor.',
            true
          )
        }
        cursors.add(cursor)
      }
    } while (cursor !== null)

    if (catalog.size !== catalogTotal) {
      throw failure(
        'catalog-incomplete',
        'validation',
        'GitHub native List catalog pagination was incomplete.',
        true
      )
    }
    return catalog
  }

  async #fetchCatalogPage(after: string | null): Promise<NativeListCatalogPage> {
    try {
      const page = await this.#reader.fetchNativeListCatalogPage(after)
      return validateCatalogPage(page)
    } catch (error: unknown) {
      if (error instanceof NativeListRenameServiceFailure) throw error
      const safeError = sanitizeError(error)
      throw failure(
        'catalog-reader-failed',
        safeError.category,
        'GitHub native List catalog could not be read back.',
        safeError.retryable
      )
    }
  }

  #timestamp(): string {
    return new Date(this.#now()).toISOString()
  }
}

function validateRequest(request: ListRenameMutationRequest): ListRenameMutationRequest {
  const record = asRecord(request)
  const allowedKeys = new Set(['expectedGitHubUserId', 'listNodeId', 'name'])
  if (
    !record ||
    Reflect.ownKeys(record).some((key) => typeof key !== 'string' || !allowedKeys.has(key)) ||
    !isIdentifier(record.expectedGitHubUserId) ||
    !isIdentifier(record.listNodeId) ||
    typeof record.name !== 'string'
  ) {
    throw failure(
      'invalid-request',
      'validation',
      'A GitHub account, native List ID, and name are required.',
      false
    )
  }
  const name = canonicalNativeListName(record.name)
  if (name.length === 0) {
    throw failure('local-empty-name', 'validation', 'A native List name is required.', false)
  }
  return {
    expectedGitHubUserId: record.expectedGitHubUserId,
    listNodeId: record.listNodeId,
    name
  }
}

function validateCatalogPage(value: unknown): NativeListCatalogPage {
  const page = asRecord(value)
  const pageInfo = page ? asRecord(page.pageInfo) : null
  if (
    !page ||
    !Array.isArray(page.lists) ||
    !isNonNegativeInteger(page.totalCount) ||
    !pageInfo ||
    typeof pageInfo.hasNextPage !== 'boolean' ||
    (pageInfo.endCursor !== null && typeof pageInfo.endCursor !== 'string')
  ) {
    throw failure(
      'catalog-invalid',
      'validation',
      'GitHub returned an invalid native List catalog page.',
      true
    )
  }
  const lists: NativeListCatalogPage['lists'][number][] = []
  for (const value of page.lists) {
    const list = asRecord(value)
    if (
      !list ||
      !isIdentifier(list.listNodeId) ||
      typeof list.name !== 'string' ||
      list.name.normalize('NFKC').trim().length === 0 ||
      (list.description !== null && typeof list.description !== 'string') ||
      typeof list.isPrivate !== 'boolean' ||
      (list.slug !== null && typeof list.slug !== 'string') ||
      !isNullableIsoDateTime(list.createdAt) ||
      !isNullableIsoDateTime(list.updatedAt) ||
      !isNullableIsoDateTime(list.lastAddedAt) ||
      !isNonNegativeInteger(list.reportedItemCount)
    ) {
      throw failure(
        'catalog-invalid',
        'validation',
        'GitHub returned invalid native List catalog metadata.',
        true
      )
    }
    lists.push({
      listNodeId: list.listNodeId,
      name: list.name,
      description: list.description,
      isPrivate: list.isPrivate,
      slug: list.slug,
      createdAt: list.createdAt,
      updatedAt: list.updatedAt,
      lastAddedAt: list.lastAddedAt,
      reportedItemCount: list.reportedItemCount
    })
  }
  return {
    lists,
    totalCount: page.totalCount,
    pageInfo: {hasNextPage: pageInfo.hasNextPage, endCursor: pageInfo.endCursor},
    rateLimit: validateRateLimit(page.rateLimit)
  }
}

function validateRateLimit(value: unknown): NativeListCatalogPage['rateLimit'] {
  const rateLimit = asRecord(value)
  if (
    !rateLimit ||
    !isNullableNonNegativeInteger(rateLimit.limit) ||
    !isNullableNonNegativeInteger(rateLimit.remaining) ||
    !isNullableIsoDateTime(rateLimit.resetAt)
  ) {
    throw failure(
      'catalog-invalid',
      'validation',
      'GitHub returned invalid native List catalog rate-limit metadata.',
      true
    )
  }
  return {limit: rateLimit.limit, remaining: rateLimit.remaining, resetAt: rateLimit.resetAt}
}

function verifiedRecord(
  localTarget: NativeListRecord,
  githubUserId: GitHubUserId,
  remoteTarget: NativeListCatalogPage['lists'][number],
  canonicalName: string,
  observedAt: string
): NativeListRecord {
  return {
    ...localTarget,
    githubUserId,
    listNodeId: remoteTarget.listNodeId,
    name: canonicalName,
    description: remoteTarget.description,
    visibility: remoteTarget.isPrivate ? 'private' : 'public',
    slug: remoteTarget.slug,
    createdAt: remoteTarget.createdAt,
    updatedAt: remoteTarget.updatedAt,
    lastAddedAt: remoteTarget.lastAddedAt,
    reportedItemCount: remoteTarget.reportedItemCount,
    lastObservedAt: observedAt
  }
}

function nextCursor(hasNextPage: boolean, endCursor: string | null): string | null {
  if (!hasNextPage) return null
  if (endCursor && endCursor.trim() === endCursor) return endCursor
  throw failure(
    'catalog-invalid',
    'validation',
    'GitHub native List catalog omitted the next cursor.',
    true
  )
}

function validateMaxCatalogPages(value: number | undefined): number {
  const maxCatalogPages = value ?? defaultMaxCatalogPages
  if (
    !Number.isSafeInteger(maxCatalogPages) ||
    maxCatalogPages < 1 ||
    maxCatalogPages > defaultMaxCatalogPages
  ) {
    throw new RangeError(
      `Native List rename catalog pages must be an integer from 1 to ${defaultMaxCatalogPages}.`
    )
  }
  return maxCatalogPages
}

function failure(
  reason: NativeListRenameServiceFailureReason,
  category: ConstructorParameters<typeof AppFailure>[0]['category'],
  message: string,
  retryable: boolean
): NativeListRenameServiceFailure {
  return new NativeListRenameServiceFailure(reason, {category, message, retryable})
}

function asRecord(value: unknown): Readonly<Record<string, unknown>> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : null
}

function isIdentifier(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.trim() === value
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

function isNullableNonNegativeInteger(value: unknown): value is number | null {
  return value === null || isNonNegativeInteger(value)
}

function isNullableIsoDateTime(value: unknown): value is string | null {
  return value === null || (typeof value === 'string' && isIsoDateTime(value))
}
