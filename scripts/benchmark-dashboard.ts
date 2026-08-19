import type {
  LibrarySnapshot,
  MutationJobRecord,
  RepositoryRecord
} from '../src/domain/types'
import {
  deriveRepositoryResults,
  indexLatestRepositoryJobs
} from '../src/dashboard/derivations'
import {
  buildLibraryRepositories,
  defaultRepositoryFilters,
  queryRepositories,
  type LibraryRepository,
  type RepositoryQuery
} from '../src/dashboard/library'

const repositoryCount = 10_000
const jobCount = 50_000
const legacyLookupSampleSize = 200
const iterations = 5

const snapshot = librarySnapshot()
const repositories = buildLibraryRepositories(snapshot)
const jobs = Array.from({length: jobCount}, (_, index) => mutationJob(index))
const query: RepositoryQuery = {
  view: {kind: 'unlist'},
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
let indexedLookupChecksum = 0
const indexedLookupMs = measureMedian(() => {
  let checksum = 0
  for (let repositoryIndex = 0; repositoryIndex < repositoryCount; repositoryIndex += 1) {
    const job = index.get(`R_${repositoryIndex}`)
    if (job) checksum += job.jobId.length + job.repositoryNodeId.length
  }
  indexedLookupChecksum = checksum
})
let projectionChecksum = 0
const legacyRepeatedProjectionMs = measureMedian(() => {
  const first = buildLibraryRepositories(snapshot)
  const second = buildLibraryRepositories(snapshot)
  const third = buildLibraryRepositories(snapshot)
  projectionChecksum =
    projectionResultChecksum(first) +
    projectionResultChecksum(second) +
    projectionResultChecksum(third)
})
const sharedProjectionMs = measureMedian(() => {
  const shared = buildLibraryRepositories(snapshot)
  const checksum = projectionResultChecksum(shared)
  projectionChecksum = checksum * 3
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
        indexedLookupCount: repositoryCount,
        indexBuildMs,
        indexedLookupMs,
        indexedLookupChecksum,
        indexedAmortizedMsPerLookup,
        normalizedLookupSpeedup: legacyMsPerLookup / indexedAmortizedMsPerLookup
      },
      projection: {
        legacyRepeatedProjectionMs,
        sharedProjectionMs,
        projectionChecksum,
        speedup: legacyRepeatedProjectionMs / sharedProjectionMs
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

function librarySnapshot(): LibrarySnapshot {
  const nativeLists = Array.from({length: 100}, (_, index) => ({
    githubUserId: '42',
    listNodeId: `L_${index}`,
    name: `List ${index.toString().padStart(3, '0')}`,
    description: index % 2 === 0 ? `Benchmark list ${index}` : null,
    visibility: index % 7 === 0 ? 'private' as const : 'public' as const,
    slug: `list-${index}`,
    createdAt: '2025-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    lastAddedAt: '2026-01-01T00:00:00.000Z',
    reportedItemCount: 300,
    importedItemCount: 300,
    importStatus: 'complete' as const,
    lastObservedAt: '2026-08-01T00:00:00.000Z'
  }))
  return {
    repositories: Array.from({length: repositoryCount}, (_, index) =>
      repository(index)
    ),
    nativeLists,
    nativeMemberships: Array.from(
      {length: repositoryCount * 3},
      (_, membershipIndex) => {
        const repositoryIndex = Math.floor(membershipIndex / 3)
        return {
          githubUserId: '42',
          repositoryNodeId: `R_${repositoryIndex}`,
          listNodeId: `L_${(repositoryIndex + membershipIndex % 3) % nativeLists.length}`,
          lastObservedAt: '2026-08-01T00:00:00.000Z'
        }
      }
    ),
    annotations: Array.from({length: repositoryCount}, (_, index) => ({
      githubUserId: '42',
      repositoryNodeId: `R_${index}`,
      triageState: index % 2 === 0 ? 'inbox' as const : 'backlog' as const,
      tags: ['benchmark', `group-${index % 20}`],
      note: `Deterministic annotation ${index}`,
      favorite: index % 11 === 0,
      revisitAt: index % 13 === 0 ? '2026-12-01T09:00:00.000Z' : null,
      reviewedAt: null,
      localModifiedAt: '2026-08-01T00:00:00.000Z'
    }))
  }
}

function projectionResultChecksum(
  projected: readonly LibraryRepository[]
): number {
  return projected.reduce(
    (checksum, item) =>
      checksum +
      item.repository.repositoryNodeId.length +
      (item.annotation?.note.length ?? 0) +
      item.nativeLists.reduce((length, list) => length + list.listNodeId.length, 0),
    0
  )
}

function repository(index: number): RepositoryRecord {
  return {
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
}
