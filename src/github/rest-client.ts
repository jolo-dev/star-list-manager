import type {
  GitHubUserId,
  IsoDateTime,
  RateLimitState,
  RepositoryRecord
} from '../domain/types'
import {githubHttpFailure, validationFailure} from '../shared/errors'
import type {AuthSession} from '../auth/session'
import {
  decodeStarredRepositoryPage,
  mapStarredRepository,
  type DecodedStarredRepository
} from './decoders'

const apiOrigin = 'https://api.github.com'
const starredPath = '/user/starred'
const apiVersion = '2026-03-10'
const starAccept = 'application/vnd.github.star+json'

export interface StarredPage {
  readonly repositories: readonly DecodedStarredRepository[]
  readonly nextUrl: string | null
  readonly etag: string | null
  readonly rateLimit: RateLimitState
  readonly notModified: boolean
}

export interface PublicStarObservation {
  readonly repositories: readonly RepositoryRecord[]
  readonly pagesProcessed: number
  readonly skippedPrivateRepositories: number
  readonly rateLimit: RateLimitState
  readonly etag: string | null
}

export interface StarredPageOptions {
  readonly url?: string
  readonly etag?: string
}

export class GitHubRestClient {
  readonly #auth: Pick<AuthSession, 'authenticatedFetch'>

  constructor(auth: Pick<AuthSession, 'authenticatedFetch'>) {
    this.#auth = auth
  }

  async fetchStarredPage(options: StarredPageOptions = {}): Promise<StarredPage> {
    const url = validateStarredUrl(
      options.url ?? `${apiOrigin}${starredPath}?per_page=100&page=1`
    )
    const headers = new Headers({
      accept: starAccept,
      'x-github-api-version': apiVersion
    })
    if (options.etag) headers.set('if-none-match', options.etag)

    const response = await this.#auth.authenticatedFetch(url, {headers})
    const rateLimit = readRateLimit(response.headers)
    if (response.status === 304) {
      return {
        repositories: [],
        nextUrl: null,
        etag: response.headers.get('etag'),
        rateLimit,
        notModified: true
      }
    }
    if (!response.ok) throw githubHttpFailure(response, 'GitHub stars could not be loaded.')

    const decoded = decodeStarredRepositoryPage(await readJson(response))
    if (!decoded.ok) throw validationFailure(decoded.error.message)
    return {
      repositories: decoded.value,
      nextUrl: parseNextUrl(response.headers.get('link')),
      etag: response.headers.get('etag'),
      rateLimit,
      notModified: false
    }
  }

  async observePublicStars(
    githubUserId: GitHubUserId,
    observedAt: IsoDateTime
  ): Promise<PublicStarObservation> {
    const repositories = new Map<string, RepositoryRecord>()
    let nextUrl: string | null = undefinedUrl()
    let pagesProcessed = 0
    let skippedPrivateRepositories = 0
    let rateLimit = emptyRateLimit()
    let etag: string | null = null

    while (nextUrl) {
      if (pagesProcessed >= 1000) {
        throw validationFailure('GitHub star pagination exceeded the safety limit.')
      }
      const page = await this.fetchStarredPage({url: nextUrl})
      pagesProcessed += 1
      rateLimit = mergeRateLimit(rateLimit, page.rateLimit)
      if (pagesProcessed === 1) etag = page.etag

      for (const decoded of page.repositories) {
        const repository = mapStarredRepository(githubUserId, decoded, observedAt)
        if (!repository) {
          skippedPrivateRepositories += 1
          continue
        }
        repositories.set(repository.repositoryNodeId, repository)
      }
      nextUrl = page.nextUrl
    }

    return {
      repositories: [...repositories.values()],
      pagesProcessed,
      skippedPrivateRepositories,
      rateLimit,
      etag
    }
  }
}

function validateStarredUrl(value: string): string {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw validationFailure('GitHub returned an invalid pagination URL.')
  }
  if (url.origin !== apiOrigin || url.pathname !== starredPath) {
    throw validationFailure('GitHub returned an unexpected pagination URL.')
  }
  return url.toString()
}

function parseNextUrl(link: string | null): string | null {
  if (!link) return null
  for (const part of link.split(',')) {
    const match = part.trim().match(/^<([^>]+)>;\s*rel="([^"]+)"$/)
    if (match?.[2]?.split(/\s+/).includes('next')) {
      return validateStarredUrl(match[1] ?? '')
    }
  }
  return null
}

function readRateLimit(headers: Headers): RateLimitState {
  return {
    limit: parseInteger(headers.get('x-ratelimit-limit')),
    remaining: parseInteger(headers.get('x-ratelimit-remaining')),
    resetAt: parseResetAt(headers.get('x-ratelimit-reset'))
  }
}

function parseInteger(value: string | null): number | null {
  if (value === null || !/^\d+$/.test(value)) return null
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) ? parsed : null
}

function parseResetAt(value: string | null): string | null {
  const seconds = parseInteger(value)
  return seconds === null ? null : new Date(seconds * 1000).toISOString()
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return (await response.json()) as unknown
  } catch {
    throw validationFailure('GitHub returned an invalid JSON response.')
  }
}

function emptyRateLimit(): RateLimitState {
  return {limit: null, remaining: null, resetAt: null}
}

function mergeRateLimit(
  previous: RateLimitState,
  current: RateLimitState
): RateLimitState {
  return {
    limit: current.limit ?? previous.limit,
    remaining: current.remaining ?? previous.remaining,
    resetAt: current.resetAt ?? previous.resetAt
  }
}

function undefinedUrl(): string {
  return `${apiOrigin}${starredPath}?per_page=100&page=1`
}
