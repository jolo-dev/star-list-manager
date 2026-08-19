import type {MutationJobRecord, RepositoryRecord} from '../src/domain/types'
import {
  deriveRepositoryResults,
  indexLatestRepositoryJobs
} from '../src/dashboard/derivations'
import {
  defaultRepositoryFilters,
  queryRepositories,
  type LibraryRepository,
  type RepositoryQuery
} from '../src/dashboard/library'

const repositoryCount = 10_000
const jobCount = 50_000
const legacyLookupSampleSize = 200
const iterations = 5

const repositories = Array.from({length: repositoryCount}, (_, index) =>
  libraryRepository(index)
)
const jobs = Array.from({length: jobCount}, (_, index) => mutationJob(index))
const query: RepositoryQuery = {
  view: {kind: 'all'},
  search: 'repository',
  filters: defaultRepositoryFilters(),
  sort: 'name',
  ascending: true
}

const legacySampleMs = measureMedian(() => {
  for (let index = 0; index < legacyLookupSampleSize; index += 1) {
    latestLegacyJob(jobs, `R_${index}`)
  }
})
const indexBuildMs = measureMedian(() => {
  indexLatestRepositoryJobs(jobs, '42')
})
const index = indexLatestRepositoryJobs(jobs, '42')
const indexedLookupMs = measureMedian(() => {
  for (let repositoryIndex = 0; repositoryIndex < repositoryCount; repositoryIndex += 1) {
    index.get(`R_${repositoryIndex}`)
  }
})
const repeatedMs = measureMedian(() => {
  queryRepositories(repositories, query, 0)
  queryRepositories(repositories, query, 0)
  queryRepositories(repositories, query, 0)
})
const sharedMs = measureMedian(() => {
  deriveRepositoryResults(repositories, query, 0, null, 200)
})
const legacyMsPerLookup = legacySampleMs / legacyLookupSampleSize
const indexedAmortizedMsPerLookup =
  (indexBuildMs + indexedLookupMs) / repositoryCount

console.log(
  JSON.stringify(
    {
      dataset: {repositories: repositoryCount, jobs: jobCount, legacyLookupSampleSize},
      jobs: {
        legacyMsPerLookup,
        indexBuildMs,
        indexedLookupMs,
        indexedAmortizedMsPerLookup,
        normalizedLookupSpeedup: legacyMsPerLookup / indexedAmortizedMsPerLookup
      },
      query: {
        repeatedMs,
        sharedMs,
        speedup: repeatedMs / sharedMs
      }
    },
    null,
    2
  )
)

function measureMedian(operation: () => void): number {
  operation()
  const durations = Array.from({length: iterations}, () => {
    const startedAt = performance.now()
    operation()
    return performance.now() - startedAt
  }).toSorted((left, right) => left - right)
  return durations[Math.floor(durations.length / 2)] ?? 0
}

function latestLegacyJob(
  records: readonly MutationJobRecord[],
  repositoryNodeId: string
): MutationJobRecord | null {
  return records
    .filter(
      (job) =>
        job.githubUserId === '42' && job.repositoryNodeId === repositoryNodeId
    )
    .toSorted(
      (left, right) =>
        right.createdAt.localeCompare(left.createdAt) ||
        right.jobId.localeCompare(left.jobId)
    )[0] ?? null
}

function mutationJob(index: number): MutationJobRecord {
  const repositoryIndex = index % repositoryCount
  const createdAt = new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString()
  return {
    githubUserId: index % 17 === 0 ? '7' : '42',
    jobId: `J_${index.toString().padStart(6, '0')}`,
    batchId: `B_${Math.floor(index / 20)}`,
    mutationKind: 'unstar',
    repositoryNodeId: `R_${repositoryIndex}`,
    ownerLogin: 'benchmark',
    repositoryName: `repository-${repositoryIndex}`,
    status: index % 5 === 0 ? 'succeeded' : 'queued',
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

function libraryRepository(index: number): LibraryRepository {
  const repository: RepositoryRecord = {
    githubUserId: '42',
    repositoryNodeId: `R_${index}`,
    ownerLogin: `owner-${index % 100}`,
    name: `repository-${index}`,
    fullName: `owner-${index % 100}/repository-${index}`,
    htmlUrl: `https://github.com/owner-${index % 100}/repository-${index}`,
    description: `Deterministic benchmark repository ${index}`,
    topics: ['benchmark', `group-${index % 20}`],
    primaryLanguage: index % 2 === 0 ? 'TypeScript' : 'Rust',
    starredAt: new Date(Date.UTC(2025, 0, 1, 0, 0, index)).toISOString(),
    pushedAt: new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString(),
    archived: false,
    disabled: false,
    isStarred: true,
    firstObservedAt: '2026-01-01T00:00:00.000Z',
    lastObservedAt: '2026-08-01T00:00:00.000Z',
    unstarredAt: null
  }
  return {repository, annotation: null, nativeLists: []}
}
