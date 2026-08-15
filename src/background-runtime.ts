import type {ListRenameMutationRequest} from './github/list-rename-write-session'
import {failureResponse, successResponse} from './shared/messages'
import type {
  AppState,
  DashboardRequest,
  RuntimeResponse,
  WriteAuthorizationState
} from './shared/messages'
import {sanitizeError} from './shared/errors'

export type RenameNativeListRequest = Extract<
  DashboardRequest,
  {readonly type: 'rename-native-list'}
>

export interface NativeListRenameActiveAccount {
  readonly githubUserId: string
  readonly identity: {readonly githubUserId: string}
}

export interface NativeListRenameRuntimeServices {
  readonly authSession: {
    readonly loadActive: () => Promise<NativeListRenameActiveAccount | null>
  }
  readonly writeAuthController: {
    readonly getState: () => Promise<WriteAuthorizationState>
  }
  readonly nativeListRename: {
    readonly rename: (request: ListRenameMutationRequest) => Promise<unknown>
  }
}

export interface NativeListRenameRuntimeDependencies {
  readonly capabilityProven: boolean
  readonly getDashboardState: () => Promise<AppState>
}

export function nativeListRenameReadiness(
  capabilityProven: boolean,
  writeAuthorization: WriteAuthorizationState
): 'ready' | 'capability-unproven' | 'write-authorization-required' {
  if (!capabilityProven) return 'capability-unproven'
  return writeAuthorization.membershipReady ? 'ready' : 'write-authorization-required'
}

export async function handleNativeListRename(
  services: NativeListRenameRuntimeServices,
  request: RenameNativeListRequest,
  dependencies: NativeListRenameRuntimeDependencies
): Promise<RuntimeResponse<AppState>> {
  if (!dependencies.capabilityProven) {
    return failureResponse({
      category: 'unsupported',
      message: 'Native List rename has not passed the disposable capability probe in this build.',
      retryable: false
    })
  }

  let active: NativeListRenameActiveAccount | null
  try {
    active = await services.authSession.loadActive()
  } catch (error: unknown) {
    return failureResponse(sanitizeError(error))
  }
  if (!active) return failureResponse(renameAuthenticationRequired())
  if (!isExpectedActiveAccount(active)) return failureResponse(accountChanged())

  let writeAuthorization: WriteAuthorizationState
  try {
    writeAuthorization = await services.writeAuthController.getState()
  } catch (error: unknown) {
    return failureResponse(sanitizeError(error))
  }
  if (!writeAuthorization.membershipReady) {
    return failureResponse({
      category: 'authentication',
      message: 'Authorize GitHub native List rename before continuing.',
      retryable: true
    })
  }

  let stillActive: NativeListRenameActiveAccount | null
  try {
    stillActive = await services.authSession.loadActive()
  } catch (error: unknown) {
    return failureResponse(sanitizeError(error))
  }
  if (
    !stillActive ||
    !isExpectedActiveAccount(stillActive) ||
    stillActive.githubUserId !== active.githubUserId
  ) {
    return failureResponse(accountChanged())
  }

  try {
    await services.nativeListRename.rename({
      expectedGitHubUserId: active.githubUserId,
      listNodeId: request.listNodeId,
      name: request.name
    })
  } catch (error: unknown) {
    return failureResponse(sanitizeError(error))
  }

  try {
    return successResponse(await dependencies.getDashboardState())
  } catch {
    return failureResponse(renameCompletedRefreshFailed())
  }
}

function isExpectedActiveAccount(
  active: NativeListRenameActiveAccount
): active is NativeListRenameActiveAccount & {readonly identity: {readonly githubUserId: string}} {
  return active.identity.githubUserId === active.githubUserId
}

function renameAuthenticationRequired() {
  return {
    category: 'authentication' as const,
    message: 'Connect GitHub before renaming a native List.',
    retryable: false
  }
}

function accountChanged() {
  return {
    category: 'authentication' as const,
    message: 'The active GitHub account changed. Retry the native List rename.',
    retryable: true
  }
}

function renameCompletedRefreshFailed() {
  return {
    category: 'network' as const,
    message:
      'Native List rename succeeded, but the dashboard state could not be refreshed. Reload to view the verified result.',
    retryable: false
  }
}
