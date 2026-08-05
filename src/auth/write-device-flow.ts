import type {
  GitHubUserId,
  OAuthWriteCredential,
  WriteAuthStateRecord
} from '../domain/types'
import {decodeGitHubIdentity, mapGitHubIdentity} from '../github/decoders'
import {AppFailure, type ErrorCategory} from '../shared/errors'
import {
  DecodeFailure,
  requireNonEmptyString,
  requireNonNegativeInteger,
  requireRecord
} from '../shared/validation'

export interface PublicWriteDeviceAuthorization {
  readonly userCode: string
  readonly verificationUri: string
  readonly expiresAt: string
  readonly intervalSeconds: number
}

export interface WriteDeviceAuthorizationGrant
  extends PublicWriteDeviceAuthorization {
  readonly deviceCode: string
}

export type WriteDeviceAuthorizationFailureReason =
  | 'cancelled'
  | 'denied'
  | 'expired'
  | 'scope-denied'
  | 'account-mismatch'
  | 'credential-rejected'
  | 'failed'

const FAILURE_DETAILS: Readonly<
  Record<
    WriteDeviceAuthorizationFailureReason,
    {readonly category: ErrorCategory; readonly message: string; readonly retryable: boolean}
  >
> = {
  cancelled: {
    category: 'authentication',
    message: 'GitHub write authorization was cancelled.',
    retryable: true
  },
  denied: {
    category: 'authentication',
    message: 'GitHub write authorization was denied.',
    retryable: true
  },
  expired: {
    category: 'authentication',
    message: 'The GitHub write authorization code expired.',
    retryable: true
  },
  'scope-denied': {
    category: 'permission',
    message: 'GitHub write authorization did not grant the required public_repo scope.',
    retryable: true
  },
  'account-mismatch': {
    category: 'authentication',
    message: 'GitHub write authorization used a different account.',
    retryable: true
  },
  'credential-rejected': {
    category: 'authentication',
    message: 'GitHub rejected the write authorization credential.',
    retryable: true
  },
  failed: {
    category: 'authentication',
    message: 'GitHub write authorization could not be completed.',
    retryable: true
  }
}

export class WriteDeviceAuthorizationFailure extends AppFailure {
  readonly reason: WriteDeviceAuthorizationFailureReason

  constructor(
    reason: WriteDeviceAuthorizationFailureReason,
    status?: number,
    category?: ErrorCategory
  ) {
    const details = FAILURE_DETAILS[reason]
    super({
      category: category ?? details.category,
      message: details.message,
      retryable: details.retryable,
      ...(status === undefined ? {} : {status})
    })
    this.name = 'WriteDeviceAuthorizationFailure'
    this.reason = reason
  }
}

export interface WriteDeviceFlowOptions {
  readonly clientId: string
  readonly fetch?: HttpFetch
  readonly now?: () => number
  readonly sleep?: (milliseconds: number, signal: AbortSignal) => Promise<void>
}

export class GitHubWriteDeviceFlow {
  readonly #clientId: string
  readonly #fetch: HttpFetch
  readonly #now: () => number
  readonly #sleep: (milliseconds: number, signal: AbortSignal) => Promise<void>

  constructor(options: WriteDeviceFlowOptions) {
    this.#clientId = options.clientId
    this.#fetch = options.fetch ?? globalThis.fetch
    this.#now = options.now ?? Date.now
    this.#sleep = options.sleep ?? abortableSleep
  }

  async requestAuthorization(signal: AbortSignal): Promise<WriteDeviceAuthorizationGrant> {
    const response = await this.#postForm(
      'https://github.com/login/device/code',
      {client_id: this.#clientId, scope: 'public_repo'},
      signal
    )

    try {
      const record = requireRecord(response, 'github.writeDeviceCode')
      const expiresInSeconds = requireNonNegativeInteger(
        record,
        'expires_in',
        'github.writeDeviceCode'
      )
      return {
        deviceCode: requireNonEmptyString(
          record,
          'device_code',
          'github.writeDeviceCode'
        ),
        userCode: requireNonEmptyString(record, 'user_code', 'github.writeDeviceCode'),
        verificationUri: requireNonEmptyString(
          record,
          'verification_uri',
          'github.writeDeviceCode'
        ),
        expiresAt: new Date(this.#now() + expiresInSeconds * 1000).toISOString(),
        intervalSeconds: requireNonNegativeInteger(
          record,
          'interval',
          'github.writeDeviceCode'
        )
      }
    } catch (error: unknown) {
      if (error instanceof DecodeFailure || error instanceof RangeError) {
        throw new WriteDeviceAuthorizationFailure('failed')
      }
      throw error
    }
  }

  async completeAuthorization(
    grant: WriteDeviceAuthorizationGrant,
    expectedGitHubUserId: GitHubUserId,
    signal: AbortSignal
  ): Promise<WriteAuthStateRecord> {
    let intervalSeconds = grant.intervalSeconds
    const expiresAt = Date.parse(grant.expiresAt)

    while (this.#now() < expiresAt) {
      await this.#wait(intervalSeconds, signal)
      if (this.#now() >= expiresAt) break

      const response = await this.#postForm(
        'https://github.com/login/oauth/access_token',
        {
          client_id: this.#clientId,
          device_code: grant.deviceCode,
          grant_type: 'urn:ietf:params:oauth:grant-type:device_code'
        },
        signal
      )
      const record = decodeRecord(response)

      if (record.access_token !== undefined) {
        const credential = decodeCredential(record)
        const identity = await this.#loadIdentity(credential.accessToken, signal)
        if (identity.githubUserId !== expectedGitHubUserId) {
          throw new WriteDeviceAuthorizationFailure('account-mismatch')
        }

        return {
          githubUserId: expectedGitHubUserId,
          identity,
          credential,
          authorizedAt: new Date(this.#now()).toISOString(),
          lastFailure: null
        }
      }

      const oauthError = record.error
      if (typeof oauthError !== 'string' || oauthError.length === 0) {
        throw new WriteDeviceAuthorizationFailure('failed')
      }
      if (oauthError === 'authorization_pending') continue
      if (oauthError === 'slow_down') {
        intervalSeconds += 5
        continue
      }
      if (oauthError === 'access_denied') {
        throw new WriteDeviceAuthorizationFailure('denied')
      }
      if (oauthError === 'expired_token') {
        throw new WriteDeviceAuthorizationFailure('expired')
      }
      throw new WriteDeviceAuthorizationFailure('failed')
    }

    throw new WriteDeviceAuthorizationFailure('expired')
  }

  async #wait(intervalSeconds: number, signal: AbortSignal): Promise<void> {
    if (signal.aborted) throw new WriteDeviceAuthorizationFailure('cancelled')
    try {
      await this.#sleep(intervalSeconds * 1000, signal)
    } catch (error: unknown) {
      if (signal.aborted) throw new WriteDeviceAuthorizationFailure('cancelled')
      throw error
    }
    if (signal.aborted) throw new WriteDeviceAuthorizationFailure('cancelled')
  }

  async #loadIdentity(accessToken: string, signal: AbortSignal) {
    let response: Response
    try {
      const request = this.#fetch
      response = await request('https://api.github.com/user', {
        signal,
        headers: {
          accept: 'application/vnd.github+json',
          authorization: `Bearer ${accessToken}`,
          'x-github-api-version': '2026-03-10'
        }
      })
    } catch (error: unknown) {
      if (signal.aborted) throw new WriteDeviceAuthorizationFailure('cancelled')
      throw new WriteDeviceAuthorizationFailure('failed', undefined, 'network')
    }
    if (signal.aborted) throw new WriteDeviceAuthorizationFailure('cancelled')
    if (!response.ok) {
      throw new WriteDeviceAuthorizationFailure(
        response.status === 401 ? 'credential-rejected' : 'failed',
        response.status,
        response.status >= 500 ? 'network' : undefined
      )
    }

    const decoded = decodeGitHubIdentity(await readJson(response))
    if (!decoded.ok) throw new WriteDeviceAuthorizationFailure('failed')
    return mapGitHubIdentity(decoded.value)
  }

  async #postForm(
    url: string,
    values: Readonly<Record<string, string>>,
    signal: AbortSignal
  ): Promise<unknown> {
    if (signal.aborted) throw new WriteDeviceAuthorizationFailure('cancelled')
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
      if (signal.aborted) throw new WriteDeviceAuthorizationFailure('cancelled')
      throw new WriteDeviceAuthorizationFailure('failed', undefined, 'network')
    }
    if (signal.aborted) throw new WriteDeviceAuthorizationFailure('cancelled')
    if (!response.ok) {
      throw new WriteDeviceAuthorizationFailure(
        'failed',
        response.status,
        response.status >= 500 ? 'network' : undefined
      )
    }
    return readJson(response)
  }
}

type HttpFetch = (
  input: RequestInfo | URL,
  init?: RequestInit
) => Promise<Response>

export function toPublicWriteDeviceAuthorization(
  grant: WriteDeviceAuthorizationGrant
): PublicWriteDeviceAuthorization {
  return {
    userCode: grant.userCode,
    verificationUri: grant.verificationUri,
    expiresAt: grant.expiresAt,
    intervalSeconds: grant.intervalSeconds
  }
}

export function normalizeOAuthScopes(scope: string): readonly string[] {
  return [...new Set(scope.split(/[\s,]+/).map((value) => value.trim().toLowerCase()))]
    .filter((value) => value.length > 0)
    .sort()
}

function decodeRecord(value: unknown): Readonly<Record<string, unknown>> {
  try {
    return requireRecord(value, 'github.writeDeviceToken')
  } catch (error: unknown) {
    if (error instanceof DecodeFailure) throw new WriteDeviceAuthorizationFailure('failed')
    throw error
  }
}

function decodeCredential(
  record: Readonly<Record<string, unknown>>
): OAuthWriteCredential {
  let accessToken: string
  let tokenType: string
  try {
    accessToken = requireNonEmptyString(record, 'access_token', 'github.writeDeviceToken')
    tokenType = requireNonEmptyString(record, 'token_type', 'github.writeDeviceToken')
  } catch (error: unknown) {
    if (error instanceof DecodeFailure) throw new WriteDeviceAuthorizationFailure('failed')
    throw error
  }

  if (tokenType.trim().toLowerCase() !== 'bearer') {
    throw new WriteDeviceAuthorizationFailure('credential-rejected')
  }

  const scope = record.scope
  if (scope === undefined || scope === '') {
    throw new WriteDeviceAuthorizationFailure('scope-denied')
  }
  if (typeof scope !== 'string') throw new WriteDeviceAuthorizationFailure('failed')
  const grantedScopes = normalizeOAuthScopes(scope)
  if (!grantedScopes.includes('public_repo')) {
    throw new WriteDeviceAuthorizationFailure('scope-denied')
  }

  return {accessToken, tokenType: 'bearer', grantedScopes}
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return (await response.json()) as unknown
  } catch {
    throw new WriteDeviceAuthorizationFailure('failed')
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
