import type {AuthStateRecord, TokenPair} from '../domain/types'
import type {RefreshTokenRejectedFailure} from './device-flow'
import {AppFailure, githubHttpFailure} from '../shared/errors'
import {RefreshTokenRejectedFailure as RejectedRefresh} from './device-flow'
import type {AuthStore} from './store'

export interface CredentialRefresher {
  refreshCredentials(
    refreshToken: string,
    generation: number,
    signal: AbortSignal
  ): Promise<TokenPair>
}

export interface AuthSessionOptions {
  readonly store: AuthStore
  readonly refresher: CredentialRefresher
  readonly fetch?: HttpFetch
  readonly now?: () => number
}

export class AuthSession {
  readonly #store: AuthStore
  readonly #refresher: CredentialRefresher
  readonly #fetch: HttpFetch
  readonly #now: () => number
  #refreshFlight: RefreshFlight | null = null

  constructor(options: AuthSessionOptions) {
    this.#store = options.store
    this.#refresher = options.refresher
    this.#fetch = options.fetch ?? globalThis.fetch
    this.#now = options.now ?? Date.now
  }

  loadActive(): Promise<AuthStateRecord | null> {
    return this.#store.loadActive()
  }

  async authenticatedFetch(
    input: RequestInfo | URL,
    init: RequestInit = {}
  ): Promise<Response> {
    let state = await this.#requireActive()
    if (tokenExpiresSoon(state.credentials, this.#now())) {
      state = await this.#refresh(state)
    }

    let response = await this.#fetchWithState(input, init, state)
    if (response.status !== 401) return response

    state = await this.#refresh(state)
    response = await this.#fetchWithState(input, init, state)
    if (response.status === 401) {
      await this.#store.clearIfGeneration(
        state.githubUserId,
        state.credentials.generation
      )
      throw githubHttpFailure(response, 'GitHub credentials must be renewed.')
    }
    return response
  }

  disconnect(): Promise<void> {
    return this.#store.disconnect()
  }

  async #requireActive(): Promise<AuthStateRecord> {
    const active = await this.#store.loadActive()
    if (active) return active
    throw new AppFailure({
      category: 'authentication',
      message: 'Connect GitHub to continue.',
      retryable: false
    })
  }

  #refresh(state: AuthStateRecord): Promise<AuthStateRecord> {
    const currentFlight = this.#refreshFlight
    if (
      currentFlight?.githubUserId === state.githubUserId &&
      currentFlight.generation === state.credentials.generation
    ) {
      return currentFlight.promise
    }

    const flight: RefreshFlight = {
      githubUserId: state.githubUserId,
      generation: state.credentials.generation,
      promise: Promise.resolve(state)
    }
    flight.promise = this.#performRefresh(state).finally(() => {
      if (this.#refreshFlight === flight) this.#refreshFlight = null
    })
    this.#refreshFlight = flight
    return flight.promise
  }

  async #performRefresh(state: AuthStateRecord): Promise<AuthStateRecord> {
    const generation = state.credentials.generation
    const current = await this.#store.loadActive()
    if (
      current?.githubUserId === state.githubUserId &&
      current.credentials.generation !== generation
    ) {
      return current
    }
    if (Date.parse(state.credentials.refreshTokenExpiresAt) <= this.#now()) {
      await this.#store.clearIfGeneration(state.githubUserId, generation)
      throw new AppFailure({
        category: 'authentication',
        message: 'GitHub credentials must be renewed.',
        retryable: true
      })
    }

    let credentials: TokenPair
    try {
      credentials = await this.#refresher.refreshCredentials(
        state.credentials.refreshToken,
        generation,
        new AbortController().signal
      )
    } catch (error: unknown) {
      if (isRejectedRefresh(error)) {
        await this.#store.clearIfGeneration(state.githubUserId, generation)
      }
      throw error
    }

    const next: AuthStateRecord = {
      ...state,
      credentials,
      refreshedAt: new Date(this.#now()).toISOString()
    }
    if (await this.#store.replaceIfGeneration(generation, next)) return next

    const latest = await this.#store.loadActive()
    if (latest?.githubUserId === state.githubUserId) return latest
    throw new AppFailure({
      category: 'authentication',
      message: 'The active GitHub account changed.',
      retryable: true
    })
  }

  #fetchWithState(
    input: RequestInfo | URL,
    init: RequestInit,
    state: AuthStateRecord
  ): Promise<Response> {
    const headers = new Headers(init.headers)
    headers.set('authorization', `Bearer ${state.credentials.accessToken}`)
    const request = this.#fetch
    return request(input, {...init, headers})
  }
}

function tokenExpiresSoon(credentials: TokenPair, now: number): boolean {
  return Date.parse(credentials.accessTokenExpiresAt) <= now + 30_000
}

function isRejectedRefresh(error: unknown): error is RefreshTokenRejectedFailure {
  return error instanceof RejectedRefresh
}

type HttpFetch = (
  input: RequestInfo | URL,
  init?: RequestInit
) => Promise<Response>

interface RefreshFlight {
  readonly githubUserId: string
  readonly generation: number
  promise: Promise<AuthStateRecord>
}
