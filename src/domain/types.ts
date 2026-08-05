import type {AppError} from '../shared/errors'

export type IsoDateTime = string
export type GitHubUserId = string
export type GitHubNodeId = string
export type RepositoryNodeId = GitHubNodeId
export type NativeListNodeId = GitHubNodeId

export interface AccountScopedRecord {
  readonly githubUserId: GitHubUserId
}

export type MutationBatchId = string
export type MutationJobId = string
export type MutationAttemptId = string
export type OperationHistoryId = string
export type MutationKind = 'unstar'
export type MutationOrigin = 'single' | 'bulk' | 'manual-retry'

export type MutationJobStatus =
  | 'queued'
  | 'checking'
  | 'deleting'
  | 'verifying'
  | 'succeeded'
  | 'succeeded-external'
  | 'failed'
  | 'blocked-unknown'
  | 'retry-waiting'
  | 'cancelled'

export type MutationTerminalStatus = Extract<
  MutationJobStatus,
  'succeeded' | 'succeeded-external' | 'failed' | 'blocked-unknown' | 'cancelled'
>

export type MutationRecoveryStatus =
  | 'none'
  | 'owner-recovery-pending'
  | 'account-suspended'

export type MutationErrorCategory =
  | 'network'
  | 'rate-limit'
  | 'authentication'
  | 'permission'
  | 'validation'
  | 'verification-mismatch'
  | 'github-server'
  | 'unknown'

export type MutationRetryEligibility =
  | 'automatic'
  | 'manual'
  | 'after-refresh'
  | 'after-reauthentication'
  | 'not-retryable'

export interface SanitizedMutationError {
  readonly category: MutationErrorCategory
  readonly message: string
  readonly statusCode: number | null
  readonly occurredAt: IsoDateTime
}

export interface MutationBatchSummary {
  readonly total: number
  readonly succeeded: number
  readonly failed: number
  readonly blockedUnknown: number
  readonly queued: number
  readonly cancelled: number
  readonly pending: number
  readonly retryEligible: number
}

export type MutationBatchStatus =
  | 'queued'
  | 'in-progress'
  | 'completed'
  | 'partially-completed'
  | 'cancelled'

export interface MutationBatchRecord extends AccountScopedRecord {
  readonly batchId: MutationBatchId
  readonly mutationKind: MutationKind
  readonly origin: MutationOrigin
  readonly repositoryNodeIds: readonly RepositoryNodeId[]
  readonly jobIds: readonly MutationJobId[]
  readonly status: MutationBatchStatus
  readonly summary: MutationBatchSummary
  readonly createdAt: IsoDateTime
  readonly updatedAt: IsoDateTime
}

export interface MutationJobRecord extends AccountScopedRecord {
  readonly jobId: MutationJobId
  readonly batchId: MutationBatchId
  readonly mutationKind: MutationKind
  readonly repositoryNodeId: RepositoryNodeId
  readonly ownerLogin: string
  readonly repositoryName: string
  readonly status: MutationJobStatus
  readonly recoveryStatus: MutationRecoveryStatus
  readonly retryEligibility: MutationRetryEligibility
  readonly attemptCount: number
  readonly nextEligibleExecutionAt: IsoDateTime | null
  readonly claimedAt: IsoDateTime | null
  readonly completedAt: IsoDateTime | null
  readonly lastError: SanitizedMutationError | null
  readonly createdAt: IsoDateTime
  readonly updatedAt: IsoDateTime
}

export type MutationAttemptOutcome =
  | 'continued'
  | 'retry-scheduled'
  | 'terminal'

export interface MutationAttemptRecord extends AccountScopedRecord {
  readonly attemptId: MutationAttemptId
  readonly jobId: MutationJobId
  readonly batchId: MutationBatchId
  readonly repositoryNodeId: RepositoryNodeId
  readonly attemptNumber: number
  readonly outcome: MutationAttemptOutcome
  readonly startedAt: IsoDateTime
  readonly completedAt: IsoDateTime
  readonly error: SanitizedMutationError | null
  readonly retryEligibility: MutationRetryEligibility
  readonly nextEligibleExecutionAt: IsoDateTime | null
}

export type MutationVerificationResult =
  | 'verified-absent'
  | 'already-absent'
  | 'not-verified'
  | 'cancelled-before-execution'

export interface OperationHistoryRecord extends AccountScopedRecord {
  readonly historyId: OperationHistoryId
  readonly jobId: MutationJobId
  readonly batchId: MutationBatchId
  readonly mutationKind: MutationKind
  readonly origin: MutationOrigin
  readonly repositoryNodeId: RepositoryNodeId
  readonly ownerLogin: string
  readonly repositoryName: string
  readonly finalStatus: MutationTerminalStatus
  readonly verificationResult: MutationVerificationResult
  readonly attemptCount: number
  readonly error: SanitizedMutationError | null
  readonly retryEligibility: MutationRetryEligibility
  readonly occurredAt: IsoDateTime
}

export interface RepositoryRecord extends AccountScopedRecord {
  readonly repositoryNodeId: RepositoryNodeId
  readonly ownerLogin: string
  readonly name: string
  readonly fullName: string
  readonly htmlUrl: string
  readonly description: string | null
  readonly topics: readonly string[]
  readonly primaryLanguage: string | null
  readonly starredAt: IsoDateTime
  readonly pushedAt: IsoDateTime | null
  readonly archived: boolean
  readonly disabled: boolean
  readonly isStarred: boolean
  readonly firstObservedAt: IsoDateTime
  readonly lastObservedAt: IsoDateTime
  readonly unstarredAt: IsoDateTime | null
}

export type NativeListVisibility = 'public' | 'private' | 'unknown'
export type NativeListImportStatus = 'complete' | 'partial'

export interface NativeListRecord extends AccountScopedRecord {
  readonly listNodeId: NativeListNodeId
  readonly name: string
  readonly description: string | null
  readonly visibility: NativeListVisibility
  readonly slug: string | null
  readonly createdAt: IsoDateTime | null
  readonly updatedAt: IsoDateTime | null
  readonly lastAddedAt: IsoDateTime | null
  readonly reportedItemCount: number
  readonly importedItemCount: number
  readonly importStatus: NativeListImportStatus
  readonly lastObservedAt: IsoDateTime
}

export interface NativeMembershipRecord extends AccountScopedRecord {
  readonly listNodeId: NativeListNodeId
  readonly repositoryNodeId: RepositoryNodeId
  readonly lastObservedAt: IsoDateTime
}

export type TriageState = 'inbox' | 'backlog' | 'reviewed' | 'snoozed'

export interface TriageCounts {
  readonly inbox: number
  readonly backlog: number
  readonly due: number
  readonly organized: number
}

export interface LibrarySnapshot {
  readonly repositories: readonly RepositoryRecord[]
  readonly nativeLists: readonly NativeListRecord[]
  readonly nativeMemberships: readonly NativeMembershipRecord[]
  readonly annotations: readonly AnnotationRecord[]
}

export interface AnnotationRecord extends AccountScopedRecord {
  readonly repositoryNodeId: RepositoryNodeId
  readonly triageState: TriageState
  readonly tags: readonly string[]
  readonly note: string
  readonly favorite: boolean
  readonly revisitAt: IsoDateTime | null
  readonly reviewedAt: IsoDateTime | null
  readonly localModifiedAt: IsoDateTime
}

export interface GitHubIdentity {
  readonly githubUserId: GitHubUserId
  readonly userNodeId: GitHubNodeId
  readonly login: string
  readonly avatarUrl: string
}

export interface TokenPair {
  readonly accessToken: string
  readonly refreshToken: string
  readonly accessTokenExpiresAt: IsoDateTime
  readonly refreshTokenExpiresAt: IsoDateTime
  readonly generation: number
}

export interface AuthStateRecord extends AccountScopedRecord {
  readonly identity: GitHubIdentity
  readonly credentials: TokenPair
  readonly authenticatedAt: IsoDateTime
  readonly refreshedAt: IsoDateTime
}

export interface OAuthWriteCredential {
  readonly accessToken: string
  readonly tokenType: 'bearer'
  readonly grantedScopes: readonly string[]
}

export interface WriteAuthStateRecord extends AccountScopedRecord {
  readonly identity: GitHubIdentity
  readonly credential: OAuthWriteCredential
  readonly authorizedAt: IsoDateTime
  readonly lastFailure: AppError | null
}

export type WriteAuthorizationPhase =
  | 'idle'
  | 'requesting-device-code'
  | 'authorization-pending'

export type WriteReadiness =
  | 'signed-out'
  | 'authorization-required'
  | 'pending'
  | 'ready'
  | 'scope-denied'
  | 'account-mismatch'
  | 'credential-rejected'

export type SyncKind = 'stars' | 'native-lists'
export type SyncPhase =
  | 'idle'
  | 'running'
  | 'complete'
  | 'partial'
  | 'stale'
  | 'unavailable'
  | 'error'

export interface RateLimitState {
  readonly limit: number | null
  readonly remaining: number | null
  readonly resetAt: IsoDateTime | null
}

export interface SyncStateRecord extends AccountScopedRecord {
  readonly kind: SyncKind
  readonly phase: SyncPhase
  readonly attempt: number
  readonly pagesProcessed: number
  readonly itemsObserved: number
  readonly skippedItems: number
  readonly convergenceAttempt: number
  readonly baselineCompletedAt: IsoDateTime | null
  readonly lastStartedAt: IsoDateTime | null
  readonly lastCompletedAt: IsoDateTime | null
  readonly lastSuccessfulAt: IsoDateTime | null
  readonly rateLimit: RateLimitState
  readonly lastError: AppError | null
}

export type RepositorySort = 'name' | 'starred-at' | 'pushed-at' | 'reviewed-at'

export interface SettingsRecord extends AccountScopedRecord {
  readonly repositorySort: RepositorySort
  readonly sortAscending: boolean
  readonly staleAfterMinutes: number
  readonly exportSchemaVersion: 1
  readonly localModifiedAt: IsoDateTime
}

export interface LibraryExportV1 {
  readonly format: 'star-list-manager'
  readonly version: 1
  readonly exportedAt: IsoDateTime
  readonly githubUserId: GitHubUserId
  readonly repositories: readonly RepositoryRecord[]
  readonly nativeLists: readonly NativeListRecord[]
  readonly nativeMemberships: readonly NativeMembershipRecord[]
  readonly annotations: readonly AnnotationRecord[]
  readonly syncState: readonly SyncStateRecord[]
  readonly settings: SettingsRecord
}

export type LibraryExportDocument = LibraryExportV1

export interface ImportImpact {
  readonly added: number
  readonly updated: number
  readonly unchanged: number
  readonly skippedConflict: number
  readonly metadataFilled: number
  readonly settingsSelected: number
}

export interface ExportPayload {
  readonly filename: string
  readonly content: string
}
