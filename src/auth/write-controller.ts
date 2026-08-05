import type {GitHubUserId, WriteAuthStateRecord} from '../domain/types'
import {AppFailure, sanitizeError} from '../shared/errors'
import type {WriteAuthorizationState} from '../shared/messages'
import type {
  WriteDeviceAuthorizationGrant,
  PublicWriteDeviceAuthorization
} from './write-device-flow'
import {
  WriteDeviceAuthorizationFailure,
  toPublicWriteDeviceAuthorization
} from './write-device-flow'
import type {AuthStore} from './store'
import type {WriteAuthStore} from './write-store'

export interface WriteDeviceAuthorizationClient {
  requestAuthorization(signal: AbortSignal): Promise<WriteDeviceAuthorizationGrant>
  completeAuthorization(
    grant: WriteDeviceAuthorizationGrant,
    expectedGitHubUserId: GitHubUserId,
    signal: AbortSignal
  ): Promise<WriteAuthStateRecord>
}

export class WriteAuthController {
  readonly #client: WriteDeviceAuthorizationClient
  readonly #readStore: Pick<AuthStore, 'loadActive'>
  readonly #writeStore: WriteAuthStore
  #state: WriteAuthorizationState = signedOutState()
  #stateAccountId: GitHubUserId | null = null
  #authorizationController: AbortController | null = null

  constructor(
    client: WriteDeviceAuthorizationClient,
    readStore: Pick<AuthStore, 'loadActive'>,
    writeStore: WriteAuthStore
  ) {
    this.#client = client
    this.#readStore = readStore
    this.#writeStore = writeStore
  }

  async getState(): Promise<WriteAuthorizationState> {
    const active = await this.#readStore.loadActive()
    if (!active) {
      this.#cancelPending()
      this.#stateAccountId = null
      this.#state = signedOutState()
      return this.#state
    }

    if (this.#stateAccountId && this.#stateAccountId !== active.githubUserId) {
      this.#cancelPending()
      this.#stateAccountId = active.githubUserId
      this.#state = authorizationRequiredState({
        category: 'authentication',
        message: 'The active GitHub account changed. Review write authorization again.',
        retryable: true
      })
    }
    if (this.#stateAccountId === active.githubUserId && this.#state.readiness === 'pending') {
      return this.#state
    }

    const stored = await this.#writeStore.loadAccount(active.githubUserId)
    if (stored && validStoredState(stored, active.githubUserId)) {
      this.#stateAccountId = active.githubUserId
      this.#state = readyState(stored.lastFailure)
      return this.#state
    }
    if (stored) await this.#writeStore.deleteAccount(active.githubUserId)

    if (this.#stateAccountId !== active.githubUserId) {
      this.#stateAccountId = active.githubUserId
      this.#state = authorizationRequiredState(null)
    }
    return this.#state
  }

  async showPreview(): Promise<WriteAuthorizationState> {
    const active = await this.#requireActive()
    this.#cancelPending()
    this.#stateAccountId = active.githubUserId
    this.#state = {
      readiness: 'authorization-required',
      previewVisible: true,
      authorization: null,
      error: null
    }
    return this.#state
  }

  async startAuthorization(): Promise<WriteAuthorizationState> {
    const active = await this.#requireActive()
    this.#cancelPending()
    const controller = new AbortController()
    this.#authorizationController = controller
    this.#stateAccountId = active.githubUserId
    this.#state = {
      readiness: 'pending',
      previewVisible: false,
      authorization: null,
      error: null
    }

    try {
      const grant = await this.#client.requestAuthorization(controller.signal)
      if (this.#authorizationController !== controller) return this.#state
      this.#state = pendingState(toPublicWriteDeviceAuthorization(grant))
      void this.#completeAuthorization(grant, active.githubUserId, controller)
      return this.#state
    } catch (error: unknown) {
      if (this.#authorizationController !== controller) return this.#state
      this.#authorizationController = null
      this.#state = failureState(error)
      return this.#state
    }
  }

  async cancelAuthorization(): Promise<WriteAuthorizationState> {
    this.#cancelPending()
    const active = await this.#readStore.loadActive()
    this.#stateAccountId = active?.githubUserId ?? null
    this.#state = active ? authorizationRequiredState(null) : signedOutState()
    return this.#state
  }

  async disconnectCurrent(): Promise<WriteAuthorizationState> {
    this.#cancelPending()
    const active = await this.#readStore.loadActive()
    if (active) await this.#writeStore.deleteAccount(active.githubUserId)
    this.#stateAccountId = active?.githubUserId ?? null
    this.#state = active ? authorizationRequiredState(null) : signedOutState()
    return this.#state
  }

  resetAfterCompleteRemoval(): WriteAuthorizationState {
    this.#cancelPending()
    this.#stateAccountId = null
    this.#state = signedOutState()
    return this.#state
  }

  async #completeAuthorization(
    grant: WriteDeviceAuthorizationGrant,
    expectedGitHubUserId: GitHubUserId,
    controller: AbortController
  ): Promise<void> {
    try {
      const completed = await this.#client.completeAuthorization(
        grant,
        expectedGitHubUserId,
        controller.signal
      )
      if (this.#authorizationController !== controller) return
      const active = await this.#readStore.loadActive()
      if (active?.githubUserId !== expectedGitHubUserId) {
        throw new WriteDeviceAuthorizationFailure('account-mismatch')
      }
      await this.#writeStore.save(completed)
      if (this.#authorizationController !== controller) return
      this.#authorizationController = null
      this.#stateAccountId = expectedGitHubUserId
      this.#state = readyState(null)
    } catch (error: unknown) {
      if (this.#authorizationController !== controller) return
      this.#authorizationController = null
      this.#state = failureState(error)
    }
  }

  async #requireActive() {
    const active = await this.#readStore.loadActive()
    if (!active) {
      throw new AppFailure({
        category: 'authentication',
        message: 'Connect GitHub before authorizing Starring access.',
        retryable: false
      })
    }
    return active
  }

  #cancelPending(): void {
    this.#authorizationController?.abort()
    this.#authorizationController = null
  }
}

function validStoredState(
  state: WriteAuthStateRecord,
  githubUserId: GitHubUserId
): boolean {
  return (
    state.githubUserId === githubUserId &&
    state.identity.githubUserId === githubUserId &&
    state.credential.tokenType === 'bearer' &&
    state.credential.accessToken.length > 0 &&
    state.credential.grantedScopes.includes('public_repo')
  )
}

function signedOutState(): WriteAuthorizationState {
  return {
    readiness: 'signed-out',
    previewVisible: false,
    authorization: null,
    error: null
  }
}

function authorizationRequiredState(
  error: WriteAuthorizationState['error']
): WriteAuthorizationState {
  return {
    readiness: 'authorization-required',
    previewVisible: false,
    authorization: null,
    error
  }
}

function pendingState(
  authorization: PublicWriteDeviceAuthorization
): WriteAuthorizationState {
  return {
    readiness: 'pending',
    previewVisible: false,
    authorization,
    error: null
  }
}

function readyState(error: WriteAuthorizationState['error']): WriteAuthorizationState {
  return {
    readiness: 'ready',
    previewVisible: false,
    authorization: null,
    error
  }
}

function failureState(error: unknown): WriteAuthorizationState {
  const readiness =
    error instanceof WriteDeviceAuthorizationFailure
      ? error.reason === 'scope-denied'
        ? 'scope-denied'
        : error.reason === 'account-mismatch'
          ? 'account-mismatch'
          : error.reason === 'credential-rejected'
            ? 'credential-rejected'
            : 'authorization-required'
      : 'authorization-required'
  return {
    readiness,
    previewVisible: false,
    authorization: null,
    error: sanitizeError(error)
  }
}
