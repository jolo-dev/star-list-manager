import {describe, expect, test} from 'bun:test'
import {
  decodeGitHubIdentity,
  decodeStarredRepositoryPage,
  decodeViewerListsPage,
  mapNativeList,
  mapStarredRepository
} from '../../src/github/decoders'
import {
  nativeListResponseFixture,
  starredRepositoryResponseFixture
} from '../fixtures/github'

const observedAt = '2026-08-03T12:00:00Z'

describe('GitHub payload decoders', () => {
  test('decodes and maps a public starred repository', () => {
    const decoded = decodeStarredRepositoryPage([starredRepositoryResponseFixture])
    expect(decoded.ok).toBe(true)
    if (!decoded.ok) return

    const repository = mapStarredRepository('42', decoded.value[0]!, observedAt)
    expect(repository).toMatchObject({
      githubUserId: '42',
      repositoryNodeId: 'R_fixture',
      ownerLogin: 'jolo-dev',
      isStarred: true
    })
  })

  test('keeps private repositories out of the domain map', () => {
    const decoded = decodeStarredRepositoryPage([
      {
        ...starredRepositoryResponseFixture,
        repo: {...starredRepositoryResponseFixture.repo, private: true}
      }
    ])
    expect(decoded.ok).toBe(true)
    if (!decoded.ok) return
    expect(mapStarredRepository('42', decoded.value[0]!, observedAt)).toBeNull()
  })

  test('rejects malformed REST payloads', () => {
    const decoded = decodeStarredRepositoryPage([
      {...starredRepositoryResponseFixture, starred_at: 'not-a-date'}
    ])
    expect(decoded.ok).toBe(false)
    if (decoded.ok) return
    expect(decoded.error.category).toBe('validation')
  })

  test('decodes identity and native List pagination', () => {
    const identity = decodeGitHubIdentity({
      id: 42,
      node_id: 'U_fixture',
      login: 'jolo-dev',
      avatar_url: 'https://avatars.githubusercontent.com/u/42'
    })
    expect(identity).toEqual({
      ok: true,
      value: {
        githubUserId: '42',
        userNodeId: 'U_fixture',
        login: 'jolo-dev',
        avatarUrl: 'https://avatars.githubusercontent.com/u/42'
      }
    })

    const lists = decodeViewerListsPage({
      data: {
        viewer: {
          lists: {
            totalCount: 1,
            pageInfo: {hasNextPage: false, endCursor: null},
            nodes: [
              {
                ...nativeListResponseFixture,
                items: {
                  ...nativeListResponseFixture.items,
                  pageInfo: {hasNextPage: false, endCursor: null}
                }
              }
            ]
          }
        }
      }
    })
    expect(lists.ok).toBe(true)
    if (!lists.ok) return
    expect(mapNativeList('42', lists.value.lists[0]!, observedAt)).toMatchObject({
      listNodeId: 'UL_fixture',
      importedItemCount: 1,
      importStatus: 'complete'
    })
  })
})
