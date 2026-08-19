import {expect, test} from 'bun:test'
import type {MutationJobRecord} from '../../src/domain/types'
import {
  deriveRepositoryResults,
  indexLatestRepositoryJobs,
  type RepositoryQueryRunner
} from '../../src/dashboard/derivations'
import {
  buildLibraryRepositories,
  defaultRepositoryFilters,
  queryRepositories,
  type RepositoryQuery
} from '../../src/dashboard/library'
import type {LibrarySnapshot} from '../../src/domain/types'

test('indexes one deterministic latest job per repository for the active account', () => {
  const jobs = [
    mutationJob('42', 'R_one', '2026-08-01T10:00:00Z', 'J_1'),
    mutationJob('42', 'R_one', '2026-08-02T10:00:00Z', 'J_2'),
    mutationJob('7', 'R_one', '2026-08-03T10:00:00Z', 'J_other'),
    mutationJob('42', 'R_two', '2026-08-02T10:00:00Z', 'J_3'),
    mutationJob('42', 'R_two', '2026-08-02T10:00:00Z', 'J_4')
  ]

  const index = indexLatestRepositoryJobs(jobs, '42')

  expect(index.get('R_one')?.jobId).toBe('J_2')
  expect(index.get('R_two')?.jobId).toBe('J_4')
  expect(index.size).toBe(2)
  expect(indexLatestRepositoryJobs(jobs, null).size).toBe(0)
})

test('derives all repository result consumers from one query call', () => {
  const repositories = buildLibraryRepositories(snapshot())
  const query: RepositoryQuery = {
    view: {kind: 'unlist'},
    search: '',
    filters: defaultRepositoryFilters(),
    sort: 'name',
    ascending: true
  }
  let calls = 0
  const runner: RepositoryQueryRunner = (...args) => {
    calls += 1
    return queryRepositories(...args)
  }

  const result = deriveRepositoryResults(repositories, query, 0, 'R_two', 1, runner)

  expect(calls).toBe(1)
  expect(result.count).toBe(2)
  expect(result.visible).toEqual(result.all.slice(0, 1))
  expect(result.inspectedRemainsVisible).toBe(true)
})

function mutationJob(
  githubUserId: string,
  repositoryNodeId: string,
  createdAt: string,
  jobId: string
): MutationJobRecord {
  return {
    githubUserId,
    jobId,
    batchId: `B_${jobId}`,
    mutationKind: 'unstar',
    repositoryNodeId,
    ownerLogin: 'octocat',
    repositoryName: repositoryNodeId,
    status: 'queued',
    recoveryStatus: 'none',
    retryEligibility: 'automatic',
    attemptCount: 0,
    nextEligibleExecutionAt: null,
    claimedAt: null,
    completedAt: null,
    lastError: null,
    membershipDetails: null,
    createdAt,
    updatedAt: createdAt
  }
}

function snapshot(): LibrarySnapshot {
  const repository = (id: string, name: string) => ({
    githubUserId: '42',
    repositoryNodeId: id,
    ownerLogin: 'octocat',
    name,
    fullName: `octocat/${name}`,
    htmlUrl: `https://github.com/octocat/${name}`,
    description: null,
    topics: [],
    primaryLanguage: null,
    starredAt: '2026-08-01T00:00:00Z',
    pushedAt: null,
    archived: false,
    disabled: false,
    isStarred: true,
    firstObservedAt: '2026-08-01T00:00:00Z',
    lastObservedAt: '2026-08-01T00:00:00Z',
    unstarredAt: null
  })
  return {
    repositories: [repository('R_one', 'alpha'), repository('R_two', 'beta')],
    annotations: [],
    nativeLists: [],
    nativeMemberships: []
  }
}
