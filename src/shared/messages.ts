import type {AppError} from './errors'
import type {
  GitHubIdentity,
  LibrarySnapshot,
  MutationBatchRecord,
  MutationJobRecord,
  OperationHistoryRecord,
  SyncStateRecord,
  TriageCounts,
  TriageState,
  WriteReadiness
} from '../domain/types'
import {failure, success, type Result} from './result'
import {isIsoDateTime} from './validation'

export type AppPhase =
  | 'first-run'
  | 'loading'
  | 'signed-out'
  | 'authorization-pending'
  | 'authorization-expired'
  | 'authorization-denied'
  | 'reauthentication'
  | 'ready'

export interface AuthorizationPrompt {
  readonly userCode: string
  readonly verificationUri: string
  readonly expiresAt: string
  readonly intervalSeconds: number
}

export interface WriteAuthorizationState {
  readonly readiness: WriteReadiness
  readonly previewVisible: boolean
  readonly authorization: AuthorizationPrompt | null
  readonly error: AppError | null
}

export interface AppState {
  readonly phase: AppPhase
  readonly identity: GitHubIdentity | null
  readonly authorization: AuthorizationPrompt | null
  readonly writeAuthorization: WriteAuthorizationState
  readonly sync: SyncStateRecord | null
  readonly nativeListSync: SyncStateRecord | null
  readonly triageCounts: TriageCounts | null
  readonly library: LibrarySnapshot | null
  readonly mutations?: MutationDashboardState | null
  readonly error: AppError | null
}

export interface MutationDashboardState {
  readonly batches: readonly MutationBatchRecord[]
  readonly jobs: readonly MutationJobRecord[]
  readonly history: readonly OperationHistoryRecord[]
}

export interface AnnotationPatch {
  readonly triageState?: TriageState
  readonly tags?: readonly string[]
  readonly note?: string
  readonly favorite?: boolean
  readonly revisitAt?: string | null
}

export type DashboardRequest =
  | {readonly type: 'get-app-state'}
  | {readonly type: 'start-device-auth'}
  | {readonly type: 'cancel-device-auth'}
  | {readonly type: 'show-write-auth-preview'}
  | {readonly type: 'start-write-device-auth'}
  | {readonly type: 'cancel-write-device-auth'}
  | {readonly type: 'disconnect-write-auth'}
  | {readonly type: 'disconnect'}
  | {readonly type: 'start-sync'; readonly force: boolean}
  | {
      readonly type: 'enqueue-confirmed-unstars'
      readonly repositoryNodeIds: readonly string[]
    }
  | {readonly type: 'cancel-mutation-job'; readonly jobId: string}
  | {
      readonly type: 'update-annotation'
      readonly repositoryNodeId: string
      readonly patch: AnnotationPatch
    }
  | {readonly type: 'export-data'}
  | {
      readonly type: 'preview-import'
      readonly document: unknown
      readonly replaceSettings: boolean
    }
  | {
      readonly type: 'apply-import'
      readonly document: unknown
      readonly replaceSettings: boolean
    }
  | {readonly type: 'clear-all-data'}

export type RuntimeMessage = DashboardRequest

export type RuntimeResponse<T = unknown> =
  | {readonly ok: true; readonly data: T}
  | {readonly ok: false; readonly error: AppError}

export function decodeDashboardRequest(
  value: unknown
): Result<DashboardRequest, AppError> {
  if (!isRecord(value) || typeof value.type !== 'string') {
    return invalidRequest()
  }

  switch (value.type) {
    case 'get-app-state':
    case 'start-device-auth':
    case 'cancel-device-auth':
    case 'show-write-auth-preview':
    case 'start-write-device-auth':
    case 'cancel-write-device-auth':
    case 'disconnect-write-auth':
    case 'disconnect':
    case 'export-data':
    case 'clear-all-data':
      return hasOnlyKeys(value, ['type'])
        ? success({type: value.type})
        : invalidRequest()
    case 'start-sync':
      return typeof value.force === 'boolean' && hasOnlyKeys(value, ['type', 'force'])
        ? success({type: value.type, force: value.force})
        : invalidRequest()
    case 'enqueue-confirmed-unstars':
      return isUniqueNonEmptyStringArray(value.repositoryNodeIds) &&
        hasOnlyKeys(value, ['type', 'repositoryNodeIds'])
        ? success({
            type: value.type,
            repositoryNodeIds: value.repositoryNodeIds
          })
        : invalidRequest()
    case 'cancel-mutation-job':
      return typeof value.jobId === 'string' &&
        value.jobId.length > 0 &&
        hasOnlyKeys(value, ['type', 'jobId'])
        ? success({type: value.type, jobId: value.jobId})
        : invalidRequest()
    case 'update-annotation': {
      const patch = decodeAnnotationPatch(value.patch)
      return typeof value.repositoryNodeId === 'string' &&
        value.repositoryNodeId.length > 0 &&
        patch !== null &&
        hasOnlyKeys(value, ['type', 'repositoryNodeId', 'patch'])
        ? success({type: value.type, repositoryNodeId: value.repositoryNodeId, patch})
        : invalidRequest()
    }
    case 'preview-import':
    case 'apply-import':
      return typeof value.replaceSettings === 'boolean' &&
        hasOnlyKeys(value, ['type', 'document', 'replaceSettings'])
        ? success({
            type: value.type,
            document: value.document,
            replaceSettings: value.replaceSettings
          })
        : invalidRequest()
    default:
      return invalidRequest()
  }
}

export function successResponse<T>(data: T): RuntimeResponse<T> {
  return {ok: true, data}
}

export function failureResponse(error: AppError): RuntimeResponse<never> {
  return {ok: false, error}
}

function invalidRequest(): Result<never, AppError> {
  return failure({
    category: 'validation',
    message: 'The extension received an invalid request.',
    retryable: false
  })
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function decodeAnnotationPatch(value: unknown): AnnotationPatch | null {
  if (!isRecord(value)) return null
  const keys = Object.keys(value)
  if (keys.length === 0 || !hasOnlyKeys(value, annotationPatchKeys)) return null

  const triageState = value.triageState
  if (
    triageState !== undefined &&
    (typeof triageState !== 'string' || !triageStates.includes(triageState as TriageState))
  ) {
    return null
  }

  const tags = value.tags
  if (
    tags !== undefined &&
    (!Array.isArray(tags) || !tags.every((tag) => typeof tag === 'string'))
  ) {
    return null
  }

  const note = value.note
  if (note !== undefined && typeof note !== 'string') return null
  const favorite = value.favorite
  if (favorite !== undefined && typeof favorite !== 'boolean') return null
  const revisitAt = value.revisitAt
  if (
    revisitAt !== undefined &&
    revisitAt !== null &&
    (typeof revisitAt !== 'string' || !isIsoDateTime(revisitAt))
  ) {
    return null
  }

  return {
    ...(triageState === undefined ? {} : {triageState: triageState as TriageState}),
    ...(tags === undefined ? {} : {tags: tags as readonly string[]}),
    ...(note === undefined ? {} : {note}),
    ...(favorite === undefined ? {} : {favorite}),
    ...(revisitAt === undefined ? {} : {revisitAt})
  }
}

function hasOnlyKeys(
  value: Readonly<Record<string, unknown>>,
  keys: readonly string[]
): boolean {
  return Object.keys(value).every((key) => keys.includes(key))
}

function isUniqueNonEmptyStringArray(value: unknown): value is readonly string[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((item) => typeof item === 'string' && item.length > 0) &&
    new Set(value).size === value.length
  )
}

const triageStates: readonly TriageState[] = [
  'inbox',
  'backlog',
  'reviewed',
  'snoozed'
]
const annotationPatchKeys = [
  'triageState',
  'tags',
  'note',
  'favorite',
  'revisitAt'
] as const
