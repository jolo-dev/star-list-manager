import type {
  AnnotationRecord,
  LibraryExportDocument,
  NativeListRecord,
  NativeMembershipRecord,
  RepositoryRecord,
  SettingsRecord,
  SyncStateRecord
} from '../domain/types'
import type {AppError, ErrorCategory} from '../shared/errors'
import type {Result} from '../shared/result'
import {
  DecodeFailure,
  decodeValue,
  requireArray,
  requireBoolean,
  requireEnum,
  requireIsoDateTime,
  requireLiteral,
  requireNonEmptyString,
  requireNonNegativeInteger,
  requireNullableIsoDateTime,
  requireNullableString,
  requireOnlyKeys,
  requireRecord,
  requireString,
  requireStringArray
} from '../shared/validation'

export function decodeLibraryExportDocument(
  value: unknown
): Result<LibraryExportDocument, AppError> {
  return decodeValue(() => {
    const root = requireRecord(value, 'import')
    requireOnlyKeys(root, exportKeys, 'import')
    requireLiteral(root, 'format', 'star-list-manager', 'import')
    requireLiteral(root, 'version', 1, 'import')
    const githubUserId = requireNonEmptyString(root, 'githubUserId', 'import')

    return {
      format: 'star-list-manager',
      version: 1,
      exportedAt: requireIsoDateTime(root, 'exportedAt', 'import'),
      githubUserId,
      repositories: decodeArray(root, 'repositories', decodeRepository).map((record) =>
        requireMatchingAccount(record, githubUserId, 'import.repositories')
      ),
      nativeLists: decodeArray(root, 'nativeLists', decodeNativeList).map((record) =>
        requireMatchingAccount(record, githubUserId, 'import.nativeLists')
      ),
      nativeMemberships: decodeArray(
        root,
        'nativeMemberships',
        decodeNativeMembership
      ).map((record) =>
        requireMatchingAccount(record, githubUserId, 'import.nativeMemberships')
      ),
      annotations: decodeArray(root, 'annotations', decodeAnnotation).map((record) =>
        requireMatchingAccount(record, githubUserId, 'import.annotations')
      ),
      syncState: decodeArray(root, 'syncState', decodeSyncState).map((record) =>
        requireMatchingAccount(record, githubUserId, 'import.syncState')
      ),
      settings: requireMatchingAccount(
        decodeSettings(root.settings, 'import.settings'),
        githubUserId,
        'import.settings'
      )
    }
  })
}

function decodeRepository(value: unknown, path: string): RepositoryRecord {
  const record = requireRecord(value, path)
  requireOnlyKeys(record, repositoryKeys, path)
  return {
    githubUserId: requireNonEmptyString(record, 'githubUserId', path),
    repositoryNodeId: requireNonEmptyString(record, 'repositoryNodeId', path),
    ownerLogin: requireNonEmptyString(record, 'ownerLogin', path),
    name: requireNonEmptyString(record, 'name', path),
    fullName: requireNonEmptyString(record, 'fullName', path),
    htmlUrl: requireNonEmptyString(record, 'htmlUrl', path),
    description: requireNullableString(record, 'description', path),
    topics: requireStringArray(record, 'topics', path),
    primaryLanguage: requireNullableString(record, 'primaryLanguage', path),
    starredAt: requireIsoDateTime(record, 'starredAt', path),
    pushedAt: requireNullableIsoDateTime(record, 'pushedAt', path),
    archived: requireBoolean(record, 'archived', path),
    disabled: requireBoolean(record, 'disabled', path),
    isStarred: requireBoolean(record, 'isStarred', path),
    firstObservedAt: requireIsoDateTime(record, 'firstObservedAt', path),
    lastObservedAt: requireIsoDateTime(record, 'lastObservedAt', path),
    unstarredAt: requireNullableIsoDateTime(record, 'unstarredAt', path)
  }
}

function decodeNativeList(value: unknown, path: string): NativeListRecord {
  const record = requireRecord(value, path)
  requireOnlyKeys(record, nativeListKeys, path)
  return {
    githubUserId: requireNonEmptyString(record, 'githubUserId', path),
    listNodeId: requireNonEmptyString(record, 'listNodeId', path),
    name: requireNonEmptyString(record, 'name', path),
    description: requireNullableString(record, 'description', path),
    visibility: requireEnum(record, 'visibility', nativeListVisibilities, path),
    slug: requireNullableString(record, 'slug', path),
    createdAt: requireNullableIsoDateTime(record, 'createdAt', path),
    updatedAt: requireNullableIsoDateTime(record, 'updatedAt', path),
    lastAddedAt: requireNullableIsoDateTime(record, 'lastAddedAt', path),
    reportedItemCount: requireNonNegativeInteger(record, 'reportedItemCount', path),
    importedItemCount: requireNonNegativeInteger(record, 'importedItemCount', path),
    importStatus: requireEnum(record, 'importStatus', nativeListStatuses, path),
    lastObservedAt: requireIsoDateTime(record, 'lastObservedAt', path)
  }
}

function decodeNativeMembership(
  value: unknown,
  path: string
): NativeMembershipRecord {
  const record = requireRecord(value, path)
  requireOnlyKeys(record, nativeMembershipKeys, path)
  return {
    githubUserId: requireNonEmptyString(record, 'githubUserId', path),
    listNodeId: requireNonEmptyString(record, 'listNodeId', path),
    repositoryNodeId: requireNonEmptyString(record, 'repositoryNodeId', path),
    lastObservedAt: requireIsoDateTime(record, 'lastObservedAt', path)
  }
}

function decodeAnnotation(value: unknown, path: string): AnnotationRecord {
  const record = requireRecord(value, path)
  requireOnlyKeys(record, annotationKeys, path)
  return {
    githubUserId: requireNonEmptyString(record, 'githubUserId', path),
    repositoryNodeId: requireNonEmptyString(record, 'repositoryNodeId', path),
    triageState: requireEnum(record, 'triageState', triageStates, path),
    tags: requireStringArray(record, 'tags', path),
    note: requireString(record, 'note', path),
    favorite: requireBoolean(record, 'favorite', path),
    revisitAt: requireNullableIsoDateTime(record, 'revisitAt', path),
    reviewedAt: requireNullableIsoDateTime(record, 'reviewedAt', path),
    localModifiedAt: requireIsoDateTime(record, 'localModifiedAt', path)
  }
}

function decodeSyncState(value: unknown, path: string): SyncStateRecord {
  const record = requireRecord(value, path)
  requireOnlyKeys(record, syncStateKeys, path)
  const rateLimit = requireRecord(record.rateLimit, `${path}.rateLimit`)
  requireOnlyKeys(rateLimit, rateLimitKeys, `${path}.rateLimit`)

  return {
    githubUserId: requireNonEmptyString(record, 'githubUserId', path),
    kind: requireEnum(record, 'kind', syncKinds, path),
    phase: requireEnum(record, 'phase', syncPhases, path),
    attempt: requireNonNegativeInteger(record, 'attempt', path),
    pagesProcessed: requireNonNegativeInteger(record, 'pagesProcessed', path),
    itemsObserved: requireNonNegativeInteger(record, 'itemsObserved', path),
    skippedItems: requireNonNegativeInteger(record, 'skippedItems', path),
    convergenceAttempt: requireNonNegativeInteger(record, 'convergenceAttempt', path),
    baselineCompletedAt: requireNullableIsoDateTime(record, 'baselineCompletedAt', path),
    lastStartedAt: requireNullableIsoDateTime(record, 'lastStartedAt', path),
    lastCompletedAt: requireNullableIsoDateTime(record, 'lastCompletedAt', path),
    lastSuccessfulAt: requireNullableIsoDateTime(record, 'lastSuccessfulAt', path),
    rateLimit: {
      limit: requireNullableInteger(rateLimit, 'limit', `${path}.rateLimit`),
      remaining: requireNullableInteger(rateLimit, 'remaining', `${path}.rateLimit`),
      resetAt: requireNullableIsoDateTime(rateLimit, 'resetAt', `${path}.rateLimit`)
    },
    lastError:
      record.lastError === null
        ? null
        : decodeAppError(record.lastError, `${path}.lastError`)
  }
}

function decodeSettings(value: unknown, path: string): SettingsRecord {
  const record = requireRecord(value, path)
  requireOnlyKeys(record, settingsKeys, path)
  return {
    githubUserId: requireNonEmptyString(record, 'githubUserId', path),
    repositorySort: requireEnum(record, 'repositorySort', repositorySorts, path),
    sortAscending: requireBoolean(record, 'sortAscending', path),
    staleAfterMinutes: requireNonNegativeInteger(record, 'staleAfterMinutes', path),
    exportSchemaVersion: requireLiteral(record, 'exportSchemaVersion', 1, path),
    localModifiedAt: requireIsoDateTime(record, 'localModifiedAt', path)
  }
}

function decodeAppError(value: unknown, path: string): AppError {
  const record = requireRecord(value, path)
  requireOnlyKeys(record, appErrorKeys, path)
  const status = record.status
  if (status !== undefined && (!Number.isSafeInteger(status) || Number(status) < 100)) {
    throw new DecodeFailure(`${path}.status`, 'a valid HTTP status')
  }
  const retryAt = record.retryAt
  if (retryAt !== undefined) {
    const wrapper = {retryAt}
    requireIsoDateTime(wrapper, 'retryAt', path)
  }

  const rateLimit = record.rateLimit
  const decodedRateLimit =
    rateLimit === undefined ? undefined : decodeErrorRateLimit(rateLimit, `${path}.rateLimit`)

  return {
    category: requireEnum(record, 'category', errorCategories, path),
    message: requireString(record, 'message', path),
    retryable: requireBoolean(record, 'retryable', path),
    ...(status === undefined ? {} : {status: Number(status)}),
    ...(retryAt === undefined ? {} : {retryAt: String(retryAt)}),
    ...(decodedRateLimit === undefined ? {} : {rateLimit: decodedRateLimit})
  }
}

function decodeErrorRateLimit(value: unknown, path: string): NonNullable<AppError['rateLimit']> {
  const record = requireRecord(value, path)
  requireOnlyKeys(record, rateLimitKeys, path)
  return {
    limit: requireNullableInteger(record, 'limit', path),
    remaining: requireNullableInteger(record, 'remaining', path),
    resetAt: requireNullableIsoDateTime(record, 'resetAt', path)
  }
}

function decodeArray<T>(
  record: Readonly<Record<string, unknown>>,
  key: string,
  decoder: (value: unknown, path: string) => T
): readonly T[] {
  return requireArray(record[key], `import.${key}`).map((value, index) =>
    decoder(value, `import.${key}[${index}]`)
  )
}

function requireMatchingAccount<T extends {readonly githubUserId: string}>(
  record: T,
  githubUserId: string,
  path: string
): T {
  if (record.githubUserId !== githubUserId) {
    throw new DecodeFailure(`${path}.githubUserId`, 'the export account identifier')
  }
  return record
}

function requireNullableInteger(
  record: Readonly<Record<string, unknown>>,
  key: string,
  path: string
): number | null {
  if (record[key] === null) return null
  return requireNonNegativeInteger(record, key, path)
}

const exportKeys = [
  'format',
  'version',
  'exportedAt',
  'githubUserId',
  'repositories',
  'nativeLists',
  'nativeMemberships',
  'annotations',
  'syncState',
  'settings'
] as const
const repositoryKeys = [
  'githubUserId',
  'repositoryNodeId',
  'ownerLogin',
  'name',
  'fullName',
  'htmlUrl',
  'description',
  'topics',
  'primaryLanguage',
  'starredAt',
  'pushedAt',
  'archived',
  'disabled',
  'isStarred',
  'firstObservedAt',
  'lastObservedAt',
  'unstarredAt'
] as const
const nativeListKeys = [
  'githubUserId',
  'listNodeId',
  'name',
  'description',
  'visibility',
  'slug',
  'createdAt',
  'updatedAt',
  'lastAddedAt',
  'reportedItemCount',
  'importedItemCount',
  'importStatus',
  'lastObservedAt'
] as const
const nativeMembershipKeys = [
  'githubUserId',
  'listNodeId',
  'repositoryNodeId',
  'lastObservedAt'
] as const
const annotationKeys = [
  'githubUserId',
  'repositoryNodeId',
  'triageState',
  'tags',
  'note',
  'favorite',
  'revisitAt',
  'reviewedAt',
  'localModifiedAt'
] as const
const syncStateKeys = [
  'githubUserId',
  'kind',
  'phase',
  'attempt',
  'pagesProcessed',
  'itemsObserved',
  'skippedItems',
  'convergenceAttempt',
  'baselineCompletedAt',
  'lastStartedAt',
  'lastCompletedAt',
  'lastSuccessfulAt',
  'rateLimit',
  'lastError'
] as const
const settingsKeys = [
  'githubUserId',
  'repositorySort',
  'sortAscending',
  'staleAfterMinutes',
  'exportSchemaVersion',
  'localModifiedAt'
] as const
const appErrorKeys = [
  'category',
  'message',
  'retryable',
  'status',
  'retryAt',
  'rateLimit'
] as const
const rateLimitKeys = ['limit', 'remaining', 'resetAt'] as const
const nativeListVisibilities = ['public', 'private', 'unknown'] as const
const nativeListStatuses = ['complete', 'partial'] as const
const triageStates = ['inbox', 'backlog', 'reviewed', 'snoozed'] as const
const syncKinds = ['stars', 'native-lists'] as const
const syncPhases = [
  'idle',
  'running',
  'complete',
  'partial',
  'stale',
  'unavailable',
  'error'
] as const
const repositorySorts = ['name', 'starred-at', 'pushed-at', 'reviewed-at'] as const
const errorCategories: readonly ErrorCategory[] = [
  'authentication',
  'network',
  'permission',
  'rate-limit',
  'storage',
  'unsupported',
  'validation'
]
