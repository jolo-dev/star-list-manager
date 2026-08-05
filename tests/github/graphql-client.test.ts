import {describe, expect, test} from 'bun:test'
import {GitHubGraphqlClient} from '../../src/github/graphql-client'

describe('GitHub GraphQL client', () => {
  test('uses the documented endpoint for capability, catalog, and item pages', async () => {
    const requests: Array<{readonly url: string; readonly init: RequestInit}> = []
    const responses = [
      jsonResponse({data: {viewer: {lists: {totalCount: 1}}}}),
      jsonResponse({
        data: {
          viewer: {
            lists: {
              totalCount: 1,
              pageInfo: {hasNextPage: false, endCursor: null},
              nodes: [listMetadata('UL_fixture', 1)]
            }
          }
        }
      }),
      jsonResponse({
        data: {
          node: {
            items: {
              totalCount: 1,
              pageInfo: {hasNextPage: false, endCursor: null},
              nodes: [{id: 'R_fixture'}]
            }
          }
        }
      })
    ]
    const client = new GitHubGraphqlClient({
      authenticatedFetch: async (input, init) => {
        requests.push({url: String(input), init: init ?? {}})
        return responses.shift() ?? jsonResponse({}, 500)
      }
    })

    expect((await client.probeNativeLists()).available).toBe(true)
    expect((await client.fetchNativeListCatalogPage(null)).lists[0]?.listNodeId).toBe(
      'UL_fixture'
    )
    expect(
      (await client.fetchNativeListItemsPage('UL_fixture', null)).repositoryNodeIds
    ).toEqual(['R_fixture'])
    expect(requests.every((request) => request.url === 'https://api.github.com/graphql')).toBe(
      true
    )
    expect(new Headers(requests[0]?.init.headers).get('x-github-api-version')).toBe(
      '2026-03-10'
    )
    expect(requests.every((request) => request.init.method === 'POST')).toBe(true)
  })

  test('marks GraphQL schema errors as unavailable without exposing error text', async () => {
    const client = new GitHubGraphqlClient({
      authenticatedFetch: async () =>
        jsonResponse({errors: [{message: 'viewer.lists no longer exists'}]})
    })
    expect(await client.probeNativeLists()).toEqual({
      available: false,
      rateLimit: {limit: null, remaining: null, resetAt: null}
    })
  })

  test('rejects malformed catalog data before domain mapping', async () => {
    const client = new GitHubGraphqlClient({
      authenticatedFetch: async () =>
        jsonResponse({
          data: {
            viewer: {
              lists: {
                totalCount: 1,
                pageInfo: {hasNextPage: false, endCursor: null},
                nodes: [{name: 'Missing ID', items: {totalCount: 0}}]
              }
            }
          }
        })
    })
    await expect(client.fetchNativeListCatalogPage(null)).rejects.toMatchObject({
      publicError: {category: 'validation'}
    })
  })
})

function listMetadata(id: string, totalCount: number) {
  return {
    id,
    name: 'Browser tools',
    description: 'Useful browser projects',
    isPrivate: false,
    slug: 'browser-tools',
    createdAt: '2026-07-01T10:00:00Z',
    updatedAt: '2026-08-01T10:00:00Z',
    lastAddedAt: '2026-08-01T09:00:00Z',
    items: {totalCount}
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {'content-type': 'application/json'}
  })
}
