import type {GitHubIdentity, TokenPair} from '../domain/types'
import {decodeGitHubIdentity, mapGitHubIdentity} from '../github/decoders'
import {
  AppFailure,
  githubHttpFailure,
  sanitizeError,
  validationFailure
} from '../shared/errors'
import {
  DecodeFailure,
  requireNonEmptyString,
  requireNonNegativeInteger,
  requireRecord
} from '../shared/validation'

export interface PublicDeviceAuthorization {
  readonly userCode: string
  readonly verificationUri: string
  readonly expiresAt: string
  readonly intervalSeconds: number
}

export interface DeviceAuthorizationGrant extends PublicDeviceAuthorization {
  readonly deviceCode: string
}

export interface CompletedDeviceAuthorization {
  readonly identity: GitHubIdentity
  readonly credentials: TokenPair
}

export type DeviceAuthorizationFailureReason =
  | 'cancelled'
  | 'denied'
  | 'expired'
  | 'failed'

export class DeviceAuthorizationFailure extends AppFailure {
  readonly reason: DeviceAuthorizationFailureReason

  constructor(reason: DeviceAuthorizationFailureReason, message: string, retryable: boolean) {
    super({category: 'authentication', message, retryable})
    this.name = 'DeviceAuthorizationFailure'
    this.reason = reason
  }
}

export class RefreshTokenRejectedFailure extends AppFailure {
  constructor() {
    super({
      category: 'authentication',
      message: 'GitHub credentials must be renewed.',
      retryable: true
    })
    this.name = 'RefreshTokenRejectedFailure'
  }
}

export interface DeviceFlowOptions {
  readonly clientId: string
  readonly fetch?: HttpFetch
  readonly now?: () => number
  readonly sleep?: (milliseconds: number, signal: AbortSignal) => Promise<void>
}

export class GitHubDeviceFlow {
  readonly #clientId: string
  readonly #fetch: HttpFetch
  readonly #now: () => number
  readonly #sleep: (milliseconds: number, signal: AbortSignal) => Promise<void>

  constructor(options: DeviceFlowOptions) {
    this.#clientId = options.clientId
    this.#fetch = options.fetch ?? globalThis.fetch
    this.#now = options.now ?? Date.now
    this.#sleep = options.sleep ?? abortableSleep
  }

  async requestAuthorization(signal: AbortSignal): Promise<DeviceAuthorizationGrant> {
    const response = await this.#postForm(
      'https://github.com/login/device/code',
      {client_id: this.#clientId},
      signal
    )
    try {
      const record = requireRecord(response, 'github.deviceCode')
      const expiresInSeconds = requireNonNegativeInteger(
        record,
        'expires_in',
        'github.deviceCode'
      )
      const intervalSeconds = requireNonNegativeInteger(
        record,
        'interval',
        'github.deviceCode'
      )

      return {
        deviceCode: requireNonEmptyString(record, 'device_code', 'github.deviceCode'),
        userCode: requireNonEmptyString(record, 'user_code', 'github.deviceCode'),
        verificationUri: requireNonEmptyString(
          record,
          'verification_uri',
          'github.deviceCode'
        ),
        expiresAt: new Date(this.#now() + expiresInSeconds * 1000).toISOString(),
        intervalSeconds
      }
    } catch (error: unknown) {
      if (error instanceof DecodeFailure) throw validationFailure(error.message)
      throw error
    }
  }

  async completeAuthorization(
    grant: DeviceAuthorizationGrant,
    signal: AbortSignal
  ): Promise<CompletedDeviceAuthorization> {
    let intervalSeconds = grant.intervalSeconds
    const expiresAt = Date.parse(grant.expiresAt)

    while (this.#now() < expiresAt) {
      await this.#sleep(intervalSeconds * 1000, signal).catch((error: unknown) => {
        if (signal.aborted) {
          throw new DeviceAuthorizationFailure(
            'cancelled',
            'GitHub sign-in was cancelled.',
            true
          )
        }
        throw error
      })

      const response = await this.#postForm(
        'https://github.com/login/oauth/access_token',
        {
          client_id: this.#clientId,
          device_code: grant.deviceCode,
          grant_type: 'urn:ietf:params:oauth:grant-type:device_code'
        },
        signal
      )
      const record = requireRecord(response, 'github.deviceToken')
      const accessToken = record.access_token
      if (typeof accessToken === 'string' && accessToken.length > 0) {
        const credentials = decodeTokenPair(record, accessToken, this.#now(), 1)
        const identity = await this.#loadIdentity(credentials.accessToken, signal)
        return {identity, credentials}
      }

      const error = requireNonEmptyString(record, 'error', 'github.deviceToken')
      if (error === 'authorization_pending') continue
      if (error === 'slow_down') {
        intervalSeconds += 5
        continue
      }
      if (error === 'access_denied') {
        throw new DeviceAuthorizationFailure(
          'denied',
          'GitHub authorization was denied.',
          true
        )
      }
      if (error === 'expired_token') {
        throw new DeviceAuthorizationFailure(
          'expired',
          'The GitHub device code expired.',
          true
        )
      }
      throw new DeviceAuthorizationFailure(
        'failed',
        'GitHub sign-in could not be completed.',
        true
      )
    }

    throw new DeviceAuthorizationFailure(
      'expired',
      'The GitHub device code expired.',
      true
    )
  }

  async refreshCredentials(
    refreshToken: string,
    generation: number,
    signal: AbortSignal
  ): Promise<TokenPair> {
    const response = await this.#postForm(
      'https://github.com/login/oauth/access_token',
      {
        client_id: this.#clientId,
        grant_type: 'refresh_token',
        refresh_token: refreshToken
      },
      signal
    )
    const record = requireRecord(response, 'github.refreshToken')
    const error = record.error
    if (typeof error === 'string') {
      throw new RefreshTokenRejectedFailure()
    }
    const accessToken = requireNonEmptyString(
      record,
      'access_token',
      'github.refreshToken'
    )
    return decodeTokenPair(record, accessToken, this.#now(), generation + 1)
  }

  async #loadIdentity(accessToken: string, signal: AbortSignal): Promise<GitHubIdentity> {
    const request = this.#fetch
    const response = await request('https://api.github.com/user', {
      signal,
      headers: {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${accessToken}`,
        'x-github-api-version': '2026-03-10'
      }
    })
    if (!response.ok) throw githubHttpFailure(response, 'GitHub identity validation failed.')
    const decoded = decodeGitHubIdentity(await readJson(response))
    if (!decoded.ok) throw validationFailure(decoded.error.message)
    return mapGitHubIdentity(decoded.value)
  }

  async #postForm(
    url: string,
    values: Readonly<Record<string, string>>,
    signal: AbortSignal
  ): Promise<unknown> {
    let response: Response
    try {
      const request = this.#fetch
      response = await request(url, {
        method: 'POST',
        signal,
        headers: {
          accept: 'application/json',
          'content-type': 'application/x-www-form-urlencoded'
        },
        body: new URLSearchParams(values)
      })
    } catch (error: unknown) {
      if (signal.aborted) {
        throw new DeviceAuthorizationFailure(
          'cancelled',
          'GitHub sign-in was cancelled.',
          true
        )
      }
      throw new AppFailure(sanitizeError(error))
    }
    if (!response.ok) throw githubHttpFailure(response)
    return readJson(response)
  }
}

type HttpFetch = (
  input: RequestInfo | URL,
  init?: RequestInit
) => Promise<Response>

export function toPublicDeviceAuthorization(
  grant: DeviceAuthorizationGrant
): PublicDeviceAuthorization {
  return {
    userCode: grant.userCode,
    verificationUri: grant.verificationUri,
    expiresAt: grant.expiresAt,
    intervalSeconds: grant.intervalSeconds
  }
}

function decodeTokenPair(
  record: Readonly<Record<string, unknown>>,
  accessToken: string,
  now: number,
  generation: number
): TokenPair {
  const refreshToken = requireNonEmptyString(
    record,
    'refresh_token',
    'github.token'
  )
  const expiresInSeconds = requireNonNegativeInteger(
    record,
    'expires_in',
    'github.token'
  )
  const refreshExpiresInSeconds = requireNonNegativeInteger(
    record,
    'refresh_token_expires_in',
    'github.token'
  )

  return {
    accessToken,
    refreshToken,
    accessTokenExpiresAt: new Date(now + expiresInSeconds * 1000).toISOString(),
    refreshTokenExpiresAt: new Date(now + refreshExpiresInSeconds * 1000).toISOString(),
    generation
  }
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return (await response.json()) as unknown
  } catch {
    throw validationFailure('GitHub returned an invalid JSON response.')
  }
}

function abortableSleep(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason)
      return
    }
    const timer = setTimeout(resolve, milliseconds)
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer)
        reject(signal.reason)
      },
      {once: true}
    )
  })
}
