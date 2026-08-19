import type {MutationJobRecord} from '../domain/types'
import type {AppPhase, AppState} from '../shared/messages'
import {
  queryRepositories,
  type LibraryRepository,
  type LibraryView,
  type RepositoryQuery
} from './library'

export type RepositoryQueryRunner = typeof queryRepositories

export type DashboardWorkspace = AppPhase | 'library' | 'operations' | 'settings'

export interface DashboardSliceFingerprints {
  readonly phase: AppPhase
  readonly identity: string
  readonly authorization: string
  readonly writeAuthorization: string
  readonly sync: string
  readonly nativeListSync: string
  readonly nativeListMembership: string
  readonly nativeListRename: string
  readonly triageCounts: string
  readonly library: string
  readonly mutations: string
  readonly error: string
}

export function materialFingerprint(value: unknown): string {
  return JSON.stringify(value) ?? 'undefined'
}

export function dashboardSliceFingerprints(
  state: AppState
): DashboardSliceFingerprints {
  return {
    phase: state.phase,
    identity: materialFingerprint(state.identity),
    authorization: materialFingerprint(state.authorization),
    writeAuthorization: materialFingerprint(state.writeAuthorization),
    sync: materialFingerprint(state.sync),
    nativeListSync: materialFingerprint(state.nativeListSync),
    nativeListMembership: materialFingerprint(state.nativeListMembership),
    nativeListRename: materialFingerprint(state.nativeListRename),
    triageCounts: materialFingerprint(state.triageCounts),
    library: materialFingerprint(state.library),
    mutations: materialFingerprint(state.mutations),
    error: materialFingerprint(state.error)
  }
}

export function classifyWorkspace(
  phase: AppPhase,
  view: LibraryView
): DashboardWorkspace {
  if (phase !== 'ready') return phase
  if (view.kind === 'operations' || view.kind === 'settings') return view.kind
  return 'library'
}

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
  return projectRepositoryResults(
    runQuery(repositories, query, now),
    inspectedRepositoryNodeId,
    limit
  )
}

export function projectRepositoryResults(
  all: readonly LibraryRepository[],
  inspectedRepositoryNodeId: string | null,
  limit: number
): DerivedRepositoryResults {
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
