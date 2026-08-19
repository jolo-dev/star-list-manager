import type {MutationJobRecord} from '../domain/types'
import {
  queryRepositories,
  type LibraryRepository,
  type RepositoryQuery
} from './library'

export type RepositoryQueryRunner = typeof queryRepositories

export interface DerivedRepositoryResults {
  readonly all: readonly LibraryRepository[]
  readonly visible: readonly LibraryRepository[]
  readonly count: number
  readonly inspectedRemainsVisible: boolean
}

export function indexLatestRepositoryJobs(
  jobs: readonly MutationJobRecord[],
  githubUserId: string | null
): ReadonlyMap<string, MutationJobRecord> {
  const latest = new Map<string, MutationJobRecord>()
  if (githubUserId === null) return latest
  for (const job of jobs) {
    if (job.githubUserId !== githubUserId) continue
    const current = latest.get(job.repositoryNodeId)
    if (
      current === undefined ||
      job.createdAt > current.createdAt ||
      (job.createdAt === current.createdAt && job.jobId > current.jobId)
    ) {
      latest.set(job.repositoryNodeId, job)
    }
  }
  return latest
}

export function deriveRepositoryResults(
  repositories: readonly LibraryRepository[],
  query: RepositoryQuery,
  now: number,
  inspectedRepositoryNodeId: string | null,
  limit: number,
  runQuery: RepositoryQueryRunner = queryRepositories
): DerivedRepositoryResults {
  const all = runQuery(repositories, query, now)
  return {
    all,
    visible: all.slice(0, limit),
    count: all.length,
    inspectedRemainsVisible:
      inspectedRepositoryNodeId === null ||
      all.some(
        (item) =>
          item.repository.repositoryNodeId === inspectedRepositoryNodeId
      )
  }
}
