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
import type {NativeListMembershipIntent} from '../domain/native-list-membership'
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
  readonly membershipReady: boolean
  readonly previewVisible: boolean
  readonly authorization: AuthorizationPrompt | null
  readonly error: AppError | null
}

export type NativeListMembershipReadiness =
  | 'ready'
  | 'capability-unproven'
  | 'write-authorization-required'

export interface NativeListMembershipUiState {
  readonly readiness: NativeListMembershipReadiness
}

export type NativeListRenameReadiness =
  | 'ready'
  | 'capability-unproven'
  | 'write-authorization-required'

export interface NativeListRenameUiState {
  readonly readiness: NativeListRenameReadiness
}

export type MembershipOperationSelection =
  | {readonly kind: 'add'; readonly listNodeIds: readonly string[]}
  | {readonly kind: 'remove'; readonly listNodeIds: readonly string[]}
  | {
      readonly kind: 'move'
      readonly sourceListNodeId: string
      readonly destinationListNodeId: string
    }

export interface MembershipListPreviewItem {
  readonly listNodeId: string
  readonly name: string
  readonly visibility: 'public' | 'private' | 'unknown'
  readonly exists: boolean
}

export interface MembershipRepositoryPreview {
  readonly repositoryNodeId: string
  readonly fullName: string
  readonly current: readonly MembershipListPreviewItem[]
  readonly resulting: readonly MembershipListPreviewItem[]
  readonly added: readonly MembershipListPreviewItem[]
  readonly removed: readonly MembershipListPreviewItem[]
  readonly unchanged: readonly MembershipListPreviewItem[]
  readonly noOps: readonly MembershipListPreviewItem[]
  readonly createsJob: boolean
}

export interface StableMembershipPreviewResponse {
  readonly status: 'stable'
  readonly previewId: string
  readonly operation: NativeListMembershipIntent['kind']
  readonly nonAtomic: true
  readonly attempts: number
  readonly captureInterval: {
    readonly startedAt: string
    readonly completedAt: string
  }
  readonly repositories: readonly MembershipRepositoryPreview[]
  readonly refreshedFromJobId: string | null
}

export type BlockedMembershipPreviewResponse =
  | {
      readonly status:
        | 'changing'
        | 'partial'
        | 'interrupted'
        | 'unavailable'
        | 'rate-limited'
      readonly attempts: number
      readonly message: string
      readonly retryAt: string | null
    }
  | {
      readonly status: 'invalid-source'
      readonly repositoryNodeId: string
      readonly sourceListNodeId: string
      readonly message: string
    }
  | {
      readonly status: 'invalid-list'
      readonly listNodeIds: readonly string[]
      readonly message: string
    }

export type MembershipPreviewResponse =
  | StableMembershipPreviewResponse
  | BlockedMembershipPreviewResponse

export interface AppState {
  readonly phase: AppPhase
  readonly identity: GitHubIdentity | null
  readonly authorization: AuthorizationPrompt | null
  readonly writeAuthorization: WriteAuthorizationState
  readonly nativeListMembership?: NativeListMembershipUiState
  readonly nativeListRename?: NativeListRenameUiState
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
  | {
      readonly type: 'preview-native-list-membership'
      readonly repositoryNodeIds: readonly string[]
      readonly operation: MembershipOperationSelection
    }
  | {
      readonly type: 'refresh-native-list-membership-preview'
      readonly jobId: string
    }
  | {
      readonly type: 'confirm-native-list-membership-preview'
      readonly previewId: string
    }
  | {
      readonly type: 'rename-native-list'
      readonly listNodeId: string
      readonly name: string
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
  | {readonly ok: false; readonly error: AppError; readonly data?: T}

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
    case 'preview-native-list-membership': {
      const operation = decodeMembershipOperation(value.operation)
      return isUniqueNonEmptyStringArray(value.repositoryNodeIds) &&
        operation !== null &&
        hasOnlyKeys(value, ['type', 'repositoryNodeIds', 'operation'])
        ? success({
            type: value.type,
            repositoryNodeIds: value.repositoryNodeIds,
            operation
          })
        : invalidRequest()
    }
    case 'refresh-native-list-membership-preview':
    case 'confirm-native-list-membership-preview': {
      const key = value.type === 'refresh-native-list-membership-preview'
        ? 'jobId'
        : 'previewId'
      const identifier = value[key]
      return typeof identifier === 'string' &&
        identifier.length > 0 &&
        hasOnlyKeys(value, ['type', key])
        ? success(
            value.type === 'refresh-native-list-membership-preview'
              ? {type: value.type, jobId: identifier}
              : {type: value.type, previewId: identifier}
          )
        : invalidRequest()
    }
    case 'rename-native-list':
      return isNonBlankString(value.listNodeId) &&
        isNonBlankString(value.name) &&
        hasOnlyKeys(value, ['type', 'listNodeId', 'name'])
        ? success({
            type: value.type,
            listNodeId: value.listNodeId,
            name: value.name
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

export function failureResponse<T = never>(error: AppError, data?: T): RuntimeResponse<T> {
  return data === undefined ? {ok: false, error} : {ok: false, error, data}
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

function decodeMembershipOperation(
  value: unknown
): MembershipOperationSelection | null {
  if (!isRecord(value) || typeof value.kind !== 'string') return null
  if (value.kind === 'add' || value.kind === 'remove') {
    return isUniqueNonEmptyStringArray(value.listNodeIds) &&
      hasOnlyKeys(value, ['kind', 'listNodeIds'])
      ? {kind: value.kind, listNodeIds: value.listNodeIds}
      : null
  }
  if (value.kind !== 'move') return null
  return typeof value.sourceListNodeId === 'string' &&
    value.sourceListNodeId.length > 0 &&
    typeof value.destinationListNodeId === 'string' &&
    value.destinationListNodeId.length > 0 &&
    value.sourceListNodeId !== value.destinationListNodeId &&
    hasOnlyKeys(value, [
      'kind',
      'sourceListNodeId',
      'destinationListNodeId'
    ])
    ? {
        kind: value.kind,
        sourceListNodeId: value.sourceListNodeId,
        destinationListNodeId: value.destinationListNodeId
      }
    : null
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

function isNonBlankString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
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
