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
        view: {kind: 'all'},
        search: '',
        filters,
        sort: 'name',
        ascending: true
      },
      now
    )
    expect(results.map((item) => item.repository.repositoryNodeId)).toEqual(['R_alpha'])
  })

  test('derives fixed view, List, tag, and due counts', () => {
    const counts = deriveViewCounts(buildLibraryRepositories(snapshot()), now)
    expect(counts).toEqual({
      inbox: 1,
      backlog: 1,
      due: 1,
      organized: 0,
      all: 2,
      history: 1,
      lists: {UL_tools: 1},
      tags: {Research: 1, Queue: 1}
    })
  })

  test('sorts deterministically and keeps null dates last', () => {
    const repositories = buildLibraryRepositories(snapshot())
    const query: RepositoryQuery = {
      view: {kind: 'all'},
      search: '',
      filters: defaultRepositoryFilters(),
      sort: 'pushed-at',
      ascending: false
    }
    expect(
      queryRepositories(repositories, query, now).map(
        (item) => item.repository.repositoryNodeId
      )
    ).toEqual(['R_alpha', 'R_beta'])
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

  test('shows unstarred repositories with retained annotations in history', () => {
    const repositories = buildLibraryRepositories(snapshot())
    const results = queryRepositories(
      repositories,
      {
        view: {kind: 'history'},
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
      view: {kind: 'all'},
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
