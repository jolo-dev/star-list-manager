import type {
  NativeListLifecycleOperationRecord,
  NativeListRecord
} from './domain/types'
import {nativeListCatalogFingerprint} from './mutations/native-list-lifecycle-runner'
import type {NativeListMutationLock} from './mutations/native-list-mutation-lock'
import {failureResponse, successResponse} from './shared/messages'
import type {
  AppState,
  DashboardRequest,
  RuntimeResponse,
  WriteAuthorizationState
} from './shared/messages'
import {AppFailure, sanitizeError} from './shared/errors'

export type NativeListLifecycleRequest = Extract<
  DashboardRequest,
  {readonly type:
    | 'preview-native-list-create'
    | 'preview-native-list-delete'
    | 'confirm-native-list-create'
    | 'confirm-native-list-delete'
    | 'refresh-native-list-lifecycle'
    | 'cancel-native-list-lifecycle'
    | 'get-native-list-lifecycle-status'}
>

export interface NativeListLifecycleActiveAccount {
  readonly githubUserId: string
  readonly identity: {readonly githubUserId: string}
}

interface CatalogListMetadata {
  readonly listNodeId: string
  readonly name: string
  readonly isPrivate: boolean
  readonly reportedItemCount: number
}

export interface NativeListLifecycleRuntimeServices {
  readonly authSession: {
    readonly loadActive: () => Promise<NativeListLifecycleActiveAccount | null>
  }
  readonly writeAuthController: {
    readonly getState: () => Promise<WriteAuthorizationState>
  }
  readonly nativeListSync: {
    readonly observeCatalog: (
      githubUserId: string,
      targetListNodeIds: readonly string[]
    ) => Promise<{readonly targets: ReadonlyMap<string, CatalogListMetadata | null>}>
    readonly synchronize: (githubUserId: string) => Promise<unknown>
  }
  readonly lifecycleStorage: {
    readonly getActive: (githubUserId: string) => Promise<NativeListLifecycleOperationRecord | null>
    readonly put: (operation: NativeListLifecycleOperationRecord) => Promise<void>
    readonly cancelPreDispatch: (
      githubUserId: string,
      operationId: string,
      cancelledAt: string
    ) => Promise<NativeListLifecycleOperationRecord | null>
    readonly listCatalog: (githubUserId: string) => Promise<readonly NativeListRecord[]>
  }
  readonly nativeListLifecycleRunner: {
    readonly run: (githubUserId: string) => Promise<void>
    readonly operation: (githubUserId: string) => Promise<NativeListLifecycleOperationRecord | null>
  }
  readonly nativeListMutationLock: Pick<NativeListMutationLock, 'run'>
}

export interface NativeListLifecycleRuntimeDependencies {
  readonly capabilityProven: boolean
  readonly getDashboardState: () => Promise<AppState>
  readonly now?: () => string
  readonly operationId?: () => string
}

export type NativeListLifecyclePreview =
  | {readonly kind: 'create'; readonly name: string; readonly visibility: 'public' | 'private'}
  | {
      readonly kind: 'delete'
      readonly listNodeId: string
      readonly name: string
      readonly visibility: 'public' | 'private'
      readonly reportedItemCount: number
      readonly importStatus: 'complete' | 'partial'
      readonly confirmationFingerprint: string
    }

export function nativeListLifecycleReadiness(
  capabilityProven: boolean,
  writeAuthorization: WriteAuthorizationState
): 'ready' | 'capability-unproven' | 'write-authorization-required' {
  if (!capabilityProven) return 'capability-unproven'
  return writeAuthorization.membershipReady ? 'ready' : 'write-authorization-required'
}

export async function handleNativeListLifecycle(
  services: NativeListLifecycleRuntimeServices,
  request: NativeListLifecycleRequest,
  dependencies: NativeListLifecycleRuntimeDependencies
): Promise<RuntimeResponse<AppState | NativeListLifecyclePreview | NativeListLifecycleOperationRecord | null>> {
  try {
    switch (request.type) {
      case 'preview-native-list-create':
        return successResponse(await previewCreate(services, request))
      case 'preview-native-list-delete':
        return successResponse(await previewDelete(services, request.listNodeId))
      case 'confirm-native-list-create':
      case 'confirm-native-list-delete':
        return await confirmLifecycle(services, request, dependencies)
      case 'refresh-native-list-lifecycle': {
        const active = await requireAccount(services)
        await services.nativeListSync.synchronize(active.githubUserId)
        return successResponse(await dependencies.getDashboardState())
      }
      case 'cancel-native-list-lifecycle':
        return await cancelLifecycle(services, dependencies)
      case 'get-native-list-lifecycle-status': {
        const active = await requireAccount(services)
        return successResponse(await services.nativeListLifecycleRunner.operation(active.githubUserId))
      }
    }
  } catch (error: unknown) {
    return failureResponse(sanitizeError(error))
  }
}

async function previewCreate(
  services: NativeListLifecycleRuntimeServices,
  request: Extract<NativeListLifecycleRequest, {readonly type: 'preview-native-list-create'}>
): Promise<NativeListLifecyclePreview> {
  const active = await requireAccount(services)
  // A preview is deliberately read-only, but still proves the catalog endpoint is fresh and complete.
  await services.nativeListSync.observeCatalog(active.githubUserId, [])
  return {kind: 'create', name: request.name, visibility: request.visibility}
}

async function previewDelete(
  services: NativeListLifecycleRuntimeServices,
  listNodeId: string
): Promise<NativeListLifecyclePreview> {
  const active = await requireAccount(services)
  return freshDeletePreview(services, active.githubUserId, listNodeId)
}

async function confirmLifecycle(
  services: NativeListLifecycleRuntimeServices,
  request: Extract<NativeListLifecycleRequest, {readonly type: 'confirm-native-list-create' | 'confirm-native-list-delete'}>,
  dependencies: NativeListLifecycleRuntimeDependencies
): Promise<RuntimeResponse<AppState>> {
  if (!dependencies.capabilityProven) return failureResponse(capabilityRequired())
  const active = await requireAccount(services)
  const writeAuthorization = await services.writeAuthController.getState()
  if (!writeAuthorization.membershipReady) return failureResponse(writeAuthorizationRequired())
  if (!(await hasExpectedActiveAccount(services, active))) {
    return failureResponse(accountChanged())
  }
  if (await services.lifecycleStorage.getActive(active.githubUserId)) {
    return failureResponse(activeOperationConflict())
  }

  const timestamp = (dependencies.now ?? (() => new Date().toISOString()))()
  let operation: NativeListLifecycleOperationRecord
  if (request.type === 'confirm-native-list-create') {
    operation = newCreateOperation(active.githubUserId, request.name, request.visibility, timestamp, dependencies.operationId)
  } else {
    const preview = await freshDeletePreview(services, active.githubUserId, request.listNodeId)
    if (!(await hasExpectedActiveAccount(services, active))) {
      return failureResponse(accountChanged())
    }
    if (preview.kind !== 'delete' || preview.confirmationFingerprint !== request.confirmationFingerprint) {
      return failureResponse(confirmationExpired())
    }
    operation = newDeleteOperation(active.githubUserId, preview, timestamp, dependencies.operationId)
  }

  // Persisted queued work is the only state the runner may dispatch.
  if (!(await hasExpectedActiveAccount(services, active))) {
    return failureResponse(accountChanged())
  }
  await services.lifecycleStorage.put(operation)
  await services.nativeListLifecycleRunner.run(active.githubUserId)
  return successResponse(await dependencies.getDashboardState())
}

async function cancelLifecycle(
  services: NativeListLifecycleRuntimeServices,
  dependencies: NativeListLifecycleRuntimeDependencies
): Promise<RuntimeResponse<AppState>> {
  const active = await requireAccount(services)
  return services.nativeListMutationLock.run(async () => {
    const operation = await services.lifecycleStorage.getActive(active.githubUserId)
    if (!operation) return failureResponse(cancellationUnavailable())
    const now = (dependencies.now ?? (() => new Date().toISOString()))()
    const cancelled = await services.lifecycleStorage.cancelPreDispatch(
      active.githubUserId,
      operation.operationId,
      now
    )
    if (!cancelled) return failureResponse(cancellationUnavailable())
    return successResponse(await dependencies.getDashboardState())
  })
}

async function freshDeletePreview(
  services: NativeListLifecycleRuntimeServices,
  githubUserId: string,
  listNodeId: string
): Promise<Extract<NativeListLifecyclePreview, {readonly kind: 'delete'}>> {
  const observation = await services.nativeListSync.observeCatalog(githubUserId, [listNodeId])
  const current = observation.targets.get(listNodeId) ?? null
  if (!current) {
    throw new AppFailure({
      category: 'validation',
      message: 'The selected native List is no longer available. Refresh before confirming deletion.',
      retryable: true
    })
  }
  const local = (await services.lifecycleStorage.listCatalog(githubUserId)).find(
    (list) => list.listNodeId === listNodeId
  )
  const visibility = current.isPrivate ? 'private' : 'public'
  const importStatus = local?.importStatus ?? 'partial'
  const snapshot: NativeListRecord = {
    githubUserId,
    listNodeId: current.listNodeId,
    name: current.name,
    description: null,
    visibility,
    slug: null,
    createdAt: null,
    updatedAt: null,
    lastAddedAt: null,
    reportedItemCount: current.reportedItemCount,
    importedItemCount: local?.importedItemCount ?? 0,
    importStatus,
    lastObservedAt: ''
  }
  return {
    kind: 'delete',
    listNodeId: current.listNodeId,
    name: current.name,
    visibility,
    reportedItemCount: current.reportedItemCount,
    importStatus,
    confirmationFingerprint: nativeListCatalogFingerprint(snapshot)
  }
}

function newCreateOperation(
  githubUserId: string,
  name: string,
  visibility: 'public' | 'private',
  timestamp: string,
  operationId: (() => string) | undefined
): NativeListLifecycleOperationRecord {
  return {
    githubUserId,
    operationId: operationId?.() ?? `native-list-lifecycle-${crypto.randomUUID()}`,
    intent: {kind: 'create', name, visibility},
    phase: 'queued',
    attemptCount: 0,
    candidateListNodeId: null,
    confirmationFingerprint: null,
    lastError: null,
    createdAt: timestamp,
    updatedAt: timestamp,
    completedAt: null
  }
}

function newDeleteOperation(
  githubUserId: string,
  preview: Extract<NativeListLifecyclePreview, {readonly kind: 'delete'}>,
  timestamp: string,
  operationId: (() => string) | undefined
): NativeListLifecycleOperationRecord {
  return {
    githubUserId,
    operationId: operationId?.() ?? `native-list-lifecycle-${crypto.randomUUID()}`,
    intent: {
      kind: 'delete',
      listNodeId: preview.listNodeId,
      name: preview.name,
      visibility: preview.visibility,
      reportedItemCount: preview.reportedItemCount,
      importStatus: preview.importStatus
    },
    phase: 'queued',
    attemptCount: 0,
    candidateListNodeId: null,
    confirmationFingerprint: preview.confirmationFingerprint,
    lastError: null,
    createdAt: timestamp,
    updatedAt: timestamp,
    completedAt: null
  }
}

async function requireAccount(services: NativeListLifecycleRuntimeServices): Promise<NativeListLifecycleActiveAccount> {
  const active = await services.authSession.loadActive()
  if (!active) throw lifecycleAuthenticationRequired()
  if (active.identity.githubUserId !== active.githubUserId) throw accountChanged()
  return active
}

async function hasExpectedActiveAccount(
  services: NativeListLifecycleRuntimeServices,
  expected: NativeListLifecycleActiveAccount
): Promise<boolean> {
  const active = await services.authSession.loadActive()
  return active?.githubUserId === expected.githubUserId &&
    active.identity.githubUserId === expected.identity.githubUserId
}

function lifecycleAuthenticationRequired() {
  return {category: 'authentication' as const, message: 'Connect GitHub before managing native Lists.', retryable: false}
}
function accountChanged() {
  return {category: 'authentication' as const, message: 'The active GitHub account changed. Retry the native List action.', retryable: true}
}
function capabilityRequired() {
  return {category: 'unsupported' as const, message: 'Native List lifecycle has not passed the disposable capability probe in this build.', retryable: false}
}
function writeAuthorizationRequired() {
  return {category: 'authentication' as const, message: 'Authorize GitHub native List lifecycle changes before continuing.', retryable: true}
}
function activeOperationConflict() {
  return {category: 'validation' as const, message: 'Another native List lifecycle operation is still active.', retryable: true}
}
function confirmationExpired() {
  return {category: 'validation' as const, message: 'The native List changed since preview. Refresh and confirm again.', retryable: true}
}
function cancellationUnavailable() {
  return {category: 'validation' as const, message: 'Only a queued or preflight native List lifecycle operation can be cancelled before remote execution.', retryable: false}
}
