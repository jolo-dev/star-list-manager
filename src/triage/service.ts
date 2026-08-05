import type {
  AnnotationRecord,
  GitHubUserId,
  NativeMembershipRecord,
  RepositoryRecord,
  SyncStateRecord,
  TriageCounts,
  TriageState
} from '../domain/types'
import {setToolbarBadge} from '../platform/browser'
import {validationFailure} from '../shared/errors'
import type {AnnotationPatch} from '../shared/messages'
import {
  getAnnotation,
  listAnnotations,
  listNativeMemberships,
  listRepositories,
  putAnnotation,
  putAnnotations
} from '../storage/library'

export interface TriageServiceOptions {
  readonly database: IDBDatabase
  readonly now?: () => number
  readonly setBadge?: (text: string) => Promise<void>
}

export class TriageService {
  readonly #database: IDBDatabase
  readonly #now: () => number
  readonly #setBadge: (text: string) => Promise<void>

  constructor(options: TriageServiceOptions) {
    this.#database = options.database
    this.#now = options.now ?? Date.now
    this.#setBadge = options.setBadge ?? ((text) => setToolbarBadge(text))
  }

  async classifyAfterSynchronization(
    githubUserId: GitHubUserId,
    starSync: SyncStateRecord,
    nativeListSync: SyncStateRecord
  ): Promise<readonly AnnotationRecord[]> {
    if (
      starSync.phase !== 'complete' ||
      !starSync.baselineCompletedAt ||
      !isTerminalNativeListPhase(nativeListSync.phase)
    ) {
      return []
    }

    const [repositories, annotations, memberships] = await Promise.all([
      listRepositories(this.#database, githubUserId),
      listAnnotations(this.#database, githubUserId),
      listNativeMemberships(this.#database, githubUserId)
    ])
    const annotatedNodeIds = new Set(
      annotations.map((annotation) => annotation.repositoryNodeId)
    )
    const listedNodeIds = new Set(
      memberships.map((membership) => membership.repositoryNodeId)
    )
    const baselineTime = Date.parse(starSync.baselineCompletedAt)
    const classifiedAt = this.#timestamp()
    const additions = repositories.flatMap((repository) => {
      if (!repository.isStarred || annotatedNodeIds.has(repository.repositoryNodeId)) {
        return []
      }
      const historical = Date.parse(repository.firstObservedAt) <= baselineTime
      const listed = listedNodeIds.has(repository.repositoryNodeId)
      return [
        createAnnotation(
          githubUserId,
          repository.repositoryNodeId,
          historical ? (listed ? 'reviewed' : 'backlog') : 'inbox',
          classifiedAt,
          historical && listed ? classifiedAt : null
        )
      ]
    })
    await putAnnotations(this.#database, additions)
    await this.refreshBadge(githubUserId)
    return additions
  }

  async updateAnnotation(
    githubUserId: GitHubUserId,
    repositoryNodeId: string,
    patch: AnnotationPatch
  ): Promise<AnnotationRecord> {
    const timestamp = this.#timestamp()
    const existing =
      (await getAnnotation(this.#database, githubUserId, repositoryNodeId)) ??
      createAnnotation(githubUserId, repositoryNodeId, 'inbox', timestamp, null)
    const triageState = patch.triageState ?? existing.triageState
    const revisitAt =
      patch.revisitAt === undefined ? existing.revisitAt : patch.revisitAt
    if (
      patch.triageState === 'snoozed' &&
      (!revisitAt || Date.parse(revisitAt) <= this.#now())
    ) {
      throw validationFailure('A snoozed repository requires a future revisit date.')
    }

    const updated: AnnotationRecord = {
      ...existing,
      triageState,
      tags: patch.tags === undefined ? existing.tags : normalizeTags(patch.tags),
      note: patch.note ?? existing.note,
      favorite: patch.favorite ?? existing.favorite,
      revisitAt,
      reviewedAt:
        triageState === 'reviewed' ? timestamp : existing.reviewedAt,
      localModifiedAt: timestamp
    }
    await putAnnotation(this.#database, updated)
    await this.refreshBadge(githubUserId)
    return updated
  }

  async counts(githubUserId: GitHubUserId): Promise<TriageCounts> {
    const [repositories, annotations, memberships] = await Promise.all([
      listRepositories(this.#database, githubUserId),
      listAnnotations(this.#database, githubUserId),
      listNativeMemberships(this.#database, githubUserId)
    ])
    return deriveTriageCounts(repositories, annotations, memberships, this.#now())
  }

  async refreshBadge(githubUserId: GitHubUserId): Promise<TriageCounts> {
    const counts = await this.counts(githubUserId)
    const actionable = counts.inbox + counts.due
    await this.#setBadge(actionable > 0 ? String(actionable) : '')
    return counts
  }

  #timestamp(): string {
    return new Date(this.#now()).toISOString()
  }
}

export function deriveTriageCounts(
  repositories: readonly RepositoryRecord[],
  annotations: readonly AnnotationRecord[],
  _memberships: readonly NativeMembershipRecord[],
  now: number
): TriageCounts {
  const starredNodeIds = new Set(
    repositories
      .filter((repository) => repository.isStarred)
      .map((repository) => repository.repositoryNodeId)
  )
  let inbox = 0
  let backlog = 0
  let due = 0
  let organized = 0

  for (const annotation of annotations) {
    if (!starredNodeIds.has(annotation.repositoryNodeId)) continue
    if (annotation.triageState === 'inbox') inbox += 1
    if (annotation.triageState === 'backlog') backlog += 1
    if (annotation.triageState === 'reviewed') organized += 1
    if (annotation.revisitAt && Date.parse(annotation.revisitAt) <= now) due += 1
  }
  return {inbox, backlog, due, organized}
}

function createAnnotation(
  githubUserId: GitHubUserId,
  repositoryNodeId: string,
  triageState: TriageState,
  localModifiedAt: string,
  reviewedAt: string | null
): AnnotationRecord {
  return {
    githubUserId,
    repositoryNodeId,
    triageState,
    tags: [],
    note: '',
    favorite: false,
    revisitAt: null,
    reviewedAt,
    localModifiedAt
  }
}

function normalizeTags(tags: readonly string[]): readonly string[] {
  const normalized = new Map<string, string>()
  for (const tag of tags) {
    const trimmed = tag.trim()
    if (trimmed.length === 0) continue
    const key = trimmed.toLocaleLowerCase()
    if (!normalized.has(key)) normalized.set(key, trimmed)
  }
  return [...normalized.values()]
}

function isTerminalNativeListPhase(phase: SyncStateRecord['phase']): boolean {
  return phase === 'complete' || phase === 'partial' || phase === 'unavailable'
}
