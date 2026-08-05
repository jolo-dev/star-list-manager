import {describe, expect, test} from 'bun:test'
import {GitHubRestClient} from '../../src/github/rest-client'
import {starredRepositoryResponseFixture} from '../fixtures/github'

describe('GitHub REST client', () => {
  test('paginates star responses with required headers and excludes private repositories', async () => {
    const requests: Array<{readonly url: string; readonly headers: Headers}> = []
    const responses = [
      jsonResponse([starredRepositoryResponseFixture], {
        headers: {
          link: '<https://api.github.com/user/starred?per_page=100&page=2>; rel="next"',
          etag: '"page-one"',
          'x-ratelimit-limit': '5000',
          'x-ratelimit-remaining': '4999',
          'x-ratelimit-reset': '1785762000'
        }
      }),
      jsonResponse([
        {
          ...starredRepositoryResponseFixture,
          repo: {
            ...starredRepositoryResponseFixture.repo,
            node_id: 'R_private',
            full_name: 'jolo-dev/private-fixture',
            name: 'private-fixture',
            private: true
          }
        }
      ])
    ]
    const client = new GitHubRestClient({
      authenticatedFetch: async (input, init) => {
        requests.push({url: String(input), headers: new Headers(init?.headers)})
        return responses.shift() ?? jsonResponse({}, {status: 500})
      }
    })

    const observation = await client.observePublicStars(
      '42',
      '2026-08-03T12:00:00Z'
    )

    expect(requests).toHaveLength(2)
    expect(requests[0]?.headers.get('accept')).toBe('application/vnd.github.star+json')
    expect(requests[0]?.headers.get('x-github-api-version')).toBe('2026-03-10')
    expect(observation.repositories.map((repository) => repository.repositoryNodeId)).toEqual([
      'R_fixture'
    ])
    expect(observation.pagesProcessed).toBe(2)
    expect(observation.skippedPrivateRepositories).toBe(1)
    expect(observation.etag).toBe('"page-one"')
    expect(observation.rateLimit).toEqual({
      limit: 5000,
      remaining: 4999,
      resetAt: '2026-08-03T13:00:00.000Z'
    })
  })

  test('supports conditional page requests and typed rate-limit metadata', async () => {
    let requestHeaders = new Headers()
    const client = new GitHubRestClient({
      authenticatedFetch: async (_input, init) => {
        requestHeaders = new Headers(init?.headers)
        return new Response(null, {
          status: 304,
          headers: {
            etag: '"page-one"',
            'x-ratelimit-limit': '5000',
            'x-ratelimit-remaining': '4998',
            'x-ratelimit-reset': '1785762000'
          }
        })
      }
    })

    const page = await client.fetchStarredPage({etag: '"page-one"'})
    expect(requestHeaders.get('if-none-match')).toBe('"page-one"')
    expect(page.notModified).toBe(true)
    expect(page.rateLimit).toEqual({
      limit: 5000,
      remaining: 4998,
      resetAt: '2026-08-03T13:00:00.000Z'
    })
  })

  test('rejects pagination links outside the documented stars endpoint', async () => {
    const client = new GitHubRestClient({
      authenticatedFetch: async () =>
        jsonResponse([starredRepositoryResponseFixture], {
          headers: {link: '<https://example.com/steal>; rel="next"'}
        })
    })

    await expect(
      client.observePublicStars('42', '2026-08-03T12:00:00Z')
    ).rejects.toMatchObject({publicError: {category: 'validation'}})
  })
})

function jsonResponse(
  body: unknown,
  options: {readonly status?: number; readonly headers?: HeadersInit} = {}
): Response {
  return new Response(JSON.stringify(body), {
    status: options.status ?? 200,
    headers: {'content-type': 'application/json', ...headersObject(options.headers)}
  })
}

function headersObject(headers: HeadersInit | undefined): Record<string, string> {
  return Object.fromEntries(new Headers(headers).entries())
}
