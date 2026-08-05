import type {RateLimitState} from '../domain/types'
import type {AuthSession} from '../auth/session'
import {githubHttpFailure, validationFailure} from '../shared/errors'
import {requireNonNegativeInteger, requireRecord} from '../shared/validation'
import {
  decodeNativeListCatalogPage,
  decodeNativeListItemsPage,
  type DecodedNativeListCatalogPage,
  type DecodedNativeListItemsPage
} from './decoders'

const graphqlUrl = 'https://api.github.com/graphql'

export interface NativeListCapability {
  readonly available: boolean
  readonly rateLimit: RateLimitState
}

export interface NativeListCatalogPage extends DecodedNativeListCatalogPage {
  readonly rateLimit: RateLimitState
}

export interface NativeListItemsPage extends DecodedNativeListItemsPage {
  readonly rateLimit: RateLimitState
}

export class GitHubGraphqlClient {
  readonly #auth: Pick<AuthSession, 'authenticatedFetch'>

  constructor(auth: Pick<AuthSession, 'authenticatedFetch'>) {
    this.#auth = auth
  }

  async probeNativeLists(): Promise<NativeListCapability> {
    const response = await this.#execute(
      `query StarListManagerCapability {
        viewer { lists(first: 1) { totalCount } }
      }`,
      {}
    )
    if (hasGraphqlErrors(response.value)) {
      return {available: false, rateLimit: response.rateLimit}
    }

    try {
      const root = requireRecord(response.value, 'github.graphql')
      const data = requireRecord(root.data, 'github.graphql.data')
      const viewer = requireRecord(data.viewer, 'github.graphql.data.viewer')
      const lists = requireRecord(viewer.lists, 'github.graphql.data.viewer.lists')
      requireNonNegativeInteger(lists, 'totalCount', 'github.graphql.data.viewer.lists')
      return {available: true, rateLimit: response.rateLimit}
    } catch {
      return {available: false, rateLimit: response.rateLimit}
    }
  }

  async fetchNativeListCatalogPage(
    after: string | null
  ): Promise<NativeListCatalogPage> {
    const response = await this.#execute(
      `query StarListManagerLists($after: String) {
        viewer {
          lists(first: 100, after: $after) {
            totalCount
            pageInfo { hasNextPage endCursor }
            nodes {
              id
              name
              description
              isPrivate
              slug
              createdAt
              updatedAt
              lastAddedAt
              items(first: 1) { totalCount }
            }
          }
        }
      }`,
      {after}
    )
    const decoded = decodeNativeListCatalogPage(response.value)
    if (!decoded.ok) throw validationFailure(decoded.error.message)
    return {...decoded.value, rateLimit: response.rateLimit}
  }

  async fetchNativeListItemsPage(
    listNodeId: string,
    after: string | null
  ): Promise<NativeListItemsPage> {
    const response = await this.#execute(
      `query StarListManagerListItems($listId: ID!, $after: String) {
        node(id: $listId) {
          ... on UserList {
            items(first: 100, after: $after) {
              totalCount
              pageInfo { hasNextPage endCursor }
              nodes { ... on Repository { id } }
            }
          }
        }
      }`,
      {listId: listNodeId, after}
    )
    const decoded = decodeNativeListItemsPage(response.value)
    if (!decoded.ok) throw validationFailure(decoded.error.message)
    return {...decoded.value, rateLimit: response.rateLimit}
  }

  async #execute(
    query: string,
    variables: Readonly<Record<string, unknown>>
  ): Promise<{readonly value: unknown; readonly rateLimit: RateLimitState}> {
    const response = await this.#auth.authenticatedFetch(graphqlUrl, {
      method: 'POST',
      headers: {
        accept: 'application/vnd.github+json',
        'content-type': 'application/json',
        'x-github-api-version': '2026-03-10'
      },
      body: JSON.stringify({query, variables})
    })
    if (!response.ok) {
      throw githubHttpFailure(response, 'GitHub native Lists could not be loaded.')
    }
    return {
      value: await readJson(response),
      rateLimit: readRateLimit(response.headers)
    }
  }
}

function hasGraphqlErrors(value: unknown): boolean {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return true
  const errors = (value as Readonly<Record<string, unknown>>).errors
  return Array.isArray(errors) && errors.length > 0
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
