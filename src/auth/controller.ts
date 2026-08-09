import type {AuthStateRecord} from '../domain/types'
import type {AppState} from '../shared/messages'
import {sanitizeError} from '../shared/errors'
import type {
  CompletedDeviceAuthorization,
  DeviceAuthorizationGrant,
  PublicDeviceAuthorization
} from './device-flow'
import {DeviceAuthorizationFailure, toPublicDeviceAuthorization} from './device-flow'
import type {AuthStore} from './store'

export interface DeviceAuthorizationClient {
  requestAuthorization(signal: AbortSignal): Promise<DeviceAuthorizationGrant>
  completeAuthorization(
    grant: DeviceAuthorizationGrant,
    signal: AbortSignal
  ): Promise<CompletedDeviceAuthorization>
}

export class AuthController {
  readonly #client: DeviceAuthorizationClient
  readonly #store: AuthStore
  readonly #now: () => number
  #state: AppState = loadingState()
  #initialization: Promise<void> | null = null
  #authorizationController: AbortController | null = null

  constructor(client: DeviceAuthorizationClient, store: AuthStore, now = Date.now) {
    this.#client = client
    this.#store = store
    this.#now = now
  }

  async getState(): Promise<AppState> {
    await this.#initialize()
    return this.#state
  }

  async startAuthorization(): Promise<AppState> {
    await this.#initialize()
    this.#authorizationController?.abort()
    const controller = new AbortController()
    this.#authorizationController = controller
    const previousIdentity = this.#state.identity
    this.#state = {
      phase: previousIdentity ? 'reauthentication' : 'loading',
      identity: previousIdentity,
      authorization: null,
      writeAuthorization: unavailableWriteAuthorization(),
      sync: null,
      nativeListSync: null,
      triageCounts: null,
      library: null,
      error: null
    }

    try {
      const grant = await this.#client.requestAuthorization(controller.signal)
      if (this.#authorizationController !== controller) return this.#state
      this.#state = {
        phase: 'authorization-pending',
        identity: previousIdentity,
        authorization: publicAuthorization(grant),
        writeAuthorization: unavailableWriteAuthorization(),
        sync: null,
        nativeListSync: null,
        triageCounts: null,
        library: null,
        error: null
      }
      void this.#completeAuthorization(grant, controller)
      return this.#state
    } catch (error: unknown) {
      if (this.#authorizationController !== controller) return this.#state
      this.#authorizationController = null
      this.#state = await this.#restoredState(sanitizeError(error))
      return this.#state
    }
  }

  async cancelAuthorization(): Promise<AppState> {
    this.#authorizationController?.abort()
    this.#authorizationController = null
    this.#state = await this.#restoredState(null)
    return this.#state
  }

  async disconnect(): Promise<AppState> {
    this.#authorizationController?.abort()
    this.#authorizationController = null
    await this.#store.disconnect()
    this.#state = {
      phase: 'signed-out',
      identity: null,
      authorization: null,
      writeAuthorization: unavailableWriteAuthorization(),
      sync: null,
      nativeListSync: null,
      triageCounts: null,
      library: null,
      error: null
    }
    return this.#state
  }

  resetAfterCompleteRemoval(): AppState {
    this.#authorizationController?.abort()
    this.#authorizationController = null
    this.#state = {
      ...loadingState(),
      phase: 'first-run'
    }
    return this.#state
  }

  async #initialize(): Promise<void> {
    if (!this.#initialization) {
      this.#initialization = this.#loadInitialState()
    }
    await this.#initialization
  }

  async #loadInitialState(): Promise<void> {
    const active = await this.#store.loadActive()
    this.#state = active ? readyState(active) : await this.#signedOutState(null)
  }

  async #completeAuthorization(
    grant: DeviceAuthorizationGrant,
    controller: AbortController
  ): Promise<void> {
    try {
      const completed = await this.#client.completeAuthorization(
        grant,
        controller.signal
      )
      if (this.#authorizationController !== controller) return
      const timestamp = new Date(this.#now()).toISOString()
      const state: AuthStateRecord = {
        githubUserId: completed.identity.githubUserId,
        identity: completed.identity,
        credentials: completed.credentials,
        authenticatedAt: timestamp,
        refreshedAt: timestamp
      }
      await this.#store.saveActive(state)
      if (this.#authorizationController !== controller) return
      this.#authorizationController = null
      this.#state = readyState(state)
    } catch (error: unknown) {
      if (this.#authorizationController !== controller) return
      this.#authorizationController = null
      if (error instanceof DeviceAuthorizationFailure) {
        this.#state = {
          phase:
            error.reason === 'expired'
              ? 'authorization-expired'
              : error.reason === 'denied'
                ? 'authorization-denied'
                : 'signed-out',
          identity: this.#state.identity,
          authorization: null,
          writeAuthorization: unavailableWriteAuthorization(),
          sync: null,
          nativeListSync: null,
          triageCounts: null,
          library: null,
          error: sanitizeError(error)
        }
        return
      }
      this.#state = await this.#restoredState(sanitizeError(error))
    }
  }

  async #signedOutState(error: AppState['error']): Promise<AppState> {
    return {
      phase: (await this.#store.hasRetainedData()) ? 'signed-out' : 'first-run',
      identity: null,
      authorization: null,
      writeAuthorization: unavailableWriteAuthorization(),
      sync: null,
      nativeListSync: null,
      triageCounts: null,
      library: null,
      error
    }
  }

  async #restoredState(error: AppState['error']): Promise<AppState> {
    const active = await this.#store.loadActive()
    if (!active) return this.#signedOutState(error)
    return {...readyState(active), error}
  }
}

function loadingState(): AppState {
  return {
    phase: 'loading',
    identity: null,
    authorization: null,
    writeAuthorization: unavailableWriteAuthorization(),
    sync: null,
    nativeListSync: null,
    triageCounts: null,
    library: null,
    error: null
  }
}

function readyState(state: AuthStateRecord): AppState {
  return {
    phase: 'ready',
    identity: state.identity,
    authorization: null,
    writeAuthorization: unavailableWriteAuthorization(),
    sync: null,
    nativeListSync: null,
    triageCounts: null,
    library: null,
    error: null
  }
}

function publicAuthorization(
  grant: DeviceAuthorizationGrant
): PublicDeviceAuthorization {
  return toPublicDeviceAuthorization(grant)
}

function unavailableWriteAuthorization(): AppState['writeAuthorization'] {
  return {
    readiness: 'signed-out',
    membershipReady: false,
    previewVisible: false,
    authorization: null,
    error: null
  }
}
