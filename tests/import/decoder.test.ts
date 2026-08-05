import {describe, expect, test} from 'bun:test'
import {decodeLibraryExportDocument} from '../../src/import/decoder'

const timestamp = '2026-08-03T12:00:00Z'

describe('library import decoder', () => {
  test('validates a complete account-scoped export document', () => {
    const decoded = decodeLibraryExportDocument(exportFixture())
    expect(decoded.ok).toBe(true)
    if (!decoded.ok) return
    expect(decoded.value.githubUserId).toBe('42')
    expect(decoded.value.repositories[0]?.repositoryNodeId).toBe('R_fixture')
    expect(decoded.value.annotations[0]?.tags).toEqual(['Research'])
  })

  test('rejects records from a different account namespace', () => {
    const fixture = exportFixture()
    const decoded = decodeLibraryExportDocument({
      ...fixture,
      annotations: [{...fixture.annotations[0], githubUserId: '99'}]
    })
    expect(decoded.ok).toBe(false)
    if (decoded.ok) return
    expect(decoded.error.message).toContain('githubUserId')
  })

  test('rejects unknown credential-bearing fields', () => {
    const decoded = decodeLibraryExportDocument({
      ...exportFixture(),
      accessToken: 'secret'
    })
    expect(decoded.ok).toBe(false)
  })
})

function exportFixture() {
  return {
    format: 'star-list-manager',
    version: 1,
    exportedAt: timestamp,
    githubUserId: '42',
    repositories: [
      {
        githubUserId: '42',
        repositoryNodeId: 'R_fixture',
        ownerLogin: 'jolo-dev',
        name: 'star-list-manager',
        fullName: 'jolo-dev/star-list-manager',
        htmlUrl: 'https://github.com/jolo-dev/star-list-manager',
        description: 'A fixture repository',
        topics: ['browser-extension'],
        primaryLanguage: 'TypeScript',
        starredAt: timestamp,
        pushedAt: timestamp,
        archived: false,
        disabled: false,
        isStarred: true,
        firstObservedAt: timestamp,
        lastObservedAt: timestamp,
        unstarredAt: null
      }
    ],
    nativeLists: [
      {
        githubUserId: '42',
        listNodeId: 'UL_fixture',
        name: 'Browser tools',
        description: 'Useful browser projects',
        visibility: 'public',
        slug: 'browser-tools',
        createdAt: timestamp,
        updatedAt: timestamp,
        lastAddedAt: timestamp,
        reportedItemCount: 1,
        importedItemCount: 1,
        importStatus: 'complete',
        lastObservedAt: timestamp
      }
    ],
    nativeMemberships: [
      {
        githubUserId: '42',
        listNodeId: 'UL_fixture',
        repositoryNodeId: 'R_fixture',
        lastObservedAt: timestamp
      }
    ],
    annotations: [
      {
        githubUserId: '42',
        repositoryNodeId: 'R_fixture',
        triageState: 'backlog',
        tags: ['Research'],
        note: 'Review later.',
        favorite: false,
        revisitAt: null,
        reviewedAt: null,
        localModifiedAt: timestamp
      }
    ],
    syncState: [
      {
        githubUserId: '42',
        kind: 'stars',
        phase: 'complete',
        attempt: 1,
        pagesProcessed: 1,
        itemsObserved: 1,
        skippedItems: 0,
        convergenceAttempt: 2,
        baselineCompletedAt: timestamp,
        lastStartedAt: timestamp,
        lastCompletedAt: timestamp,
        lastSuccessfulAt: timestamp,
        rateLimit: {limit: 5000, remaining: 4999, resetAt: timestamp},
        lastError: null
      }
    ],
    settings: {
      githubUserId: '42',
      repositorySort: 'starred-at',
      sortAscending: false,
      staleAfterMinutes: 60,
      exportSchemaVersion: 1,
      localModifiedAt: timestamp
    }
  } as const
}
