import {describe, expect, test} from 'bun:test'
import type {LibrarySnapshot} from '../../src/domain/types'
import {
  buildLibraryRepositories,
  defaultRepositoryFilters,
  deriveViewCounts,
  nextSelectionIndex,
  operationHistoryForRepository,
  queryRepositories,
  safeGitHubUrl,
  type RepositoryQuery
} from '../../src/dashboard/library'

const now = Date.parse('2026-08-05T12:00:00Z')

describe('repository discovery queries', () => {
  test('searches metadata, Lists, tags, and notes locally', () => {
    const repositories = buildLibraryRepositories(snapshot())
    expect(search(repositories, 'typescript research')).toEqual(['R_alpha'])
    expect(search(repositories, 'browser tools')).toEqual(['R_alpha'])
    expect(search(repositories, 'queue worker')).toEqual(['R_beta'])
    expect(search(repositories, 'missing phrase')).toEqual([])
  })

  test('combines view, language, archive, star, and date filters', () => {
    const repositories = buildLibraryRepositories(snapshot())
    const filters = {
      ...defaultRepositoryFilters(),
      language: 'TypeScript',
      archived: 'exclude' as const,
      starredAfter: '2026-08-01T00:00:00Z'
    }
    const results = queryRepositories(
      repositories,
      {
        view: {kind: 'list', listNodeId: 'UL_tools'},
        search: '',
        filters,
        sort: 'name',
        ascending: true
      },
      now
    )
    expect(results.map((item) => item.repository.repositoryNodeId)).toEqual(['R_alpha'])
  })

  test('derives Unlist and native List counts within the archive scope', () => {
    const fixture = snapshot()
    const archivedUnlisted = {
      ...fixture.repositories[1]!,
      repositoryNodeId: 'R_archived-unlisted',
      name: 'archived-unlisted',
      fullName: 'octocat/archived-unlisted',
      htmlUrl: 'https://github.com/octocat/archived-unlisted',
      archived: true
    }
    const archivedListed = {
      ...fixture.repositories[0]!,
      repositoryNodeId: 'R_archived-listed',
      name: 'archived-listed',
      fullName: 'jolo-dev/archived-listed',
      htmlUrl: 'https://github.com/jolo-dev/archived-listed',
      archived: true
    }
    const repositories = buildLibraryRepositories({
      ...fixture,
      repositories: [...fixture.repositories, archivedUnlisted, archivedListed],
      nativeMemberships: [
        ...fixture.nativeMemberships,
        {
          githubUserId: '42',
          repositoryNodeId: archivedListed.repositoryNodeId,
          listNodeId: 'UL_tools',
          lastObservedAt: '2026-08-05T12:00:00Z'
        }
      ]
    })

    expect(deriveViewCounts(repositories, 'exclude')).toEqual({
      unlist: 1,
      lists: {UL_tools: 1}
    })
    expect(deriveViewCounts(repositories, 'all')).toEqual({
      unlist: 2,
      lists: {UL_tools: 2}
    })
  })

  test('returns repositories without local List membership in Unlist', () => {
    const repositories = buildLibraryRepositories(snapshot())
    const results = queryRepositories(
      repositories,
      {
        view: {kind: 'unlist'},
        search: '',
        filters: {...defaultRepositoryFilters(), starState: 'all'},
        sort: 'name',
        ascending: true
      },
      now
    )
    expect(results.map((item) => item.repository.repositoryNodeId)).toEqual([
      'R_beta',
      'R_history'
    ])
  })

  test('sorts deterministically and keeps null dates last', () => {
    const repositories = buildLibraryRepositories(snapshot())
    const query: RepositoryQuery = {
      view: {kind: 'unlist'},
      search: '',
      filters: {...defaultRepositoryFilters(), starState: 'all'},
      sort: 'pushed-at',
      ascending: false
    }
    expect(
      queryRepositories(repositories, query, now).map(
        (item) => item.repository.repositoryNodeId
      )
    ).toEqual(['R_history', 'R_beta'])
  })

  test('restricts GitHub links and keyboard selection boundaries', () => {
    expect(safeGitHubUrl('https://github.com/jolo-dev/alpha')).toBe(
      'https://github.com/jolo-dev/alpha'
    )
    expect(safeGitHubUrl('https://example.com/jolo-dev/alpha')).toBeNull()
    expect(nextSelectionIndex(0, 3, 'ArrowUp')).toBe(0)
    expect(nextSelectionIndex(0, 3, 'ArrowDown')).toBe(1)
    expect(nextSelectionIndex(1, 3, 'End')).toBe(2)
    expect(nextSelectionIndex(2, 3, 'ArrowDown')).toBe(2)
  })

  test('shows unstarred repositories with retained annotations in Unlist', () => {
    const repositories = buildLibraryRepositories(snapshot())
    const results = queryRepositories(
      repositories,
      {
        view: {kind: 'unlist'},
        search: '',
        filters: {...defaultRepositoryFilters(), starState: 'unstarred'},
        sort: 'name',
        ascending: true
      },
      now
    )
    expect(results.map((item) => item.repository.repositoryNodeId)).toEqual([
      'R_history'
    ])
    expect(results[0]?.annotation?.note).toBe('Retained after unstar')
  })

  test('filters and orders repository operation history', () => {
    const history = operationHistoryForRepository(
      [
        historyRecord('H_old', 'R_alpha', '2026-08-01T12:00:00Z'),
        historyRecord('H_other', 'R_beta', '2026-08-03T12:00:00Z'),
        historyRecord('H_new', 'R_alpha', '2026-08-04T12:00:00Z')
      ],
      'R_alpha'
    )
    expect(history.map((record) => record.historyId)).toEqual(['H_new', 'H_old'])
  })
})

function search(
  repositories: ReturnType<typeof buildLibraryRepositories>,
  value: string
): readonly string[] {
  return queryRepositories(
    repositories,
    {
      view: value.includes('queue') || value.includes('missing')
        ? {kind: 'unlist'}
        : {kind: 'list', listNodeId: 'UL_tools'},
      search: value,
      filters: defaultRepositoryFilters(),
      sort: 'name',
      ascending: true
    },
    now
  ).map((item) => item.repository.repositoryNodeId)
}

function snapshot(): LibrarySnapshot {
  return {
    repositories: [
      {
        githubUserId: '42',
        repositoryNodeId: 'R_alpha',
        ownerLogin: 'jolo-dev',
        name: 'alpha',
        fullName: 'jolo-dev/alpha',
        htmlUrl: 'https://github.com/jolo-dev/alpha',
        description: 'A browser extension toolkit',
        topics: ['extension', 'catalog'],
        primaryLanguage: 'TypeScript',
        starredAt: '2026-08-02T12:00:00Z',
        pushedAt: '2026-08-04T12:00:00Z',
        archived: false,
        disabled: false,
        isStarred: true,
        firstObservedAt: '2026-08-02T12:00:00Z',
        lastObservedAt: '2026-08-05T12:00:00Z',
        unstarredAt: null
      },
      {
        githubUserId: '42',
        repositoryNodeId: 'R_beta',
        ownerLogin: 'octocat',
        name: 'beta',
        fullName: 'octocat/beta',
        htmlUrl: 'https://github.com/octocat/beta',
        description: 'A queue worker',
        topics: ['worker'],
        primaryLanguage: 'Go',
        starredAt: '2026-07-01T12:00:00Z',
        pushedAt: null,
        archived: false,
        disabled: false,
        isStarred: true,
        firstObservedAt: '2026-07-01T12:00:00Z',
        lastObservedAt: '2026-08-05T12:00:00Z',
        unstarredAt: null
      },
      {
        githubUserId: '42',
        repositoryNodeId: 'R_history',
        ownerLogin: 'octocat',
        name: 'history',
        fullName: 'octocat/history',
        htmlUrl: 'https://github.com/octocat/history',
        description: null,
        topics: [],
        primaryLanguage: 'TypeScript',
        starredAt: '2026-06-01T12:00:00Z',
        pushedAt: '2026-06-02T12:00:00Z',
        archived: true,
        disabled: false,
        isStarred: false,
        firstObservedAt: '2026-06-01T12:00:00Z',
        lastObservedAt: '2026-07-01T12:00:00Z',
        unstarredAt: '2026-07-01T12:00:00Z'
      }
    ],
    nativeLists: [
      {
        githubUserId: '42',
        listNodeId: 'UL_tools',
        name: 'Browser tools',
        description: null,
        visibility: 'public',
        slug: 'browser-tools',
        createdAt: null,
        updatedAt: null,
        lastAddedAt: null,
        reportedItemCount: 1,
        importedItemCount: 1,
        importStatus: 'complete',
        lastObservedAt: '2026-08-05T12:00:00Z'
      }
    ],
    nativeMemberships: [
      {
        githubUserId: '42',
        listNodeId: 'UL_tools',
        repositoryNodeId: 'R_alpha',
        lastObservedAt: '2026-08-05T12:00:00Z'
      }
    ],
    annotations: [
      {
        githubUserId: '42',
        repositoryNodeId: 'R_alpha',
        triageState: 'inbox',
        tags: ['Research'],
        note: 'Read the TypeScript API',
        favorite: true,
        revisitAt: null,
        reviewedAt: null,
        localModifiedAt: '2026-08-05T12:00:00Z'
      },
      {
        githubUserId: '42',
        repositoryNodeId: 'R_beta',
        triageState: 'backlog',
        tags: ['Queue'],
        note: 'Worker patterns',
        favorite: false,
        revisitAt: '2026-08-04T12:00:00Z',
        reviewedAt: null,
        localModifiedAt: '2026-08-05T12:00:00Z'
      },
      {
        githubUserId: '42',
        repositoryNodeId: 'R_history',
        triageState: 'reviewed',
        tags: ['Archive'],
        note: 'Retained after unstar',
        favorite: true,
        revisitAt: null,
        reviewedAt: '2026-07-01T12:00:00Z',
        localModifiedAt: '2026-08-05T12:00:00Z'
      }
    ]
  }
}

function historyRecord(
  historyId: string,
  repositoryNodeId: string,
  occurredAt: string
) {
  return {
    githubUserId: '42',
    historyId,
    jobId: `job-${historyId}`,
    batchId: `batch-${historyId}`,
    mutationKind: 'unstar' as const,
    origin: 'single' as const,
    repositoryNodeId,
    ownerLogin: 'octocat',
    repositoryName: repositoryNodeId,
    finalStatus: 'succeeded' as const,
    verificationResult: 'verified-absent' as const,
    attemptCount: 1,
    error: null,
    retryEligibility: 'not-retryable' as const,
    membershipDetails: null,
    occurredAt
  }
}
