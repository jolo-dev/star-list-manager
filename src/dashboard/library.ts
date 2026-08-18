import type {
  AnnotationRecord,
  LibrarySnapshot,
  NativeListRecord,
  OperationHistoryRecord,
  RepositoryRecord,
  RepositorySort,
  TriageState
} from '../domain/types'

export type BuiltInView =
  | 'inbox'
  | 'backlog'
  | 'due'
  | 'organized'
  | 'all'
  | 'unlist'
  | 'history'
export type LibraryView =
  | {readonly kind: BuiltInView}
  | {readonly kind: 'list'; readonly listNodeId: string}
  | {readonly kind: 'tag'; readonly tag: string}
  | {readonly kind: 'operations'}
  | {readonly kind: 'settings'}

export type InclusionFilter = 'all' | 'exclude' | 'only'
export type StarFilter = 'starred' | 'unstarred' | 'all'

export interface RepositoryFilters {
  readonly triageStates: readonly TriageState[]
  readonly starState: StarFilter
  readonly listNodeId: string | null
  readonly tag: string | null
  readonly language: string | null
  readonly archived: InclusionFilter
  readonly disabled: InclusionFilter
  readonly starredAfter: string | null
  readonly starredBefore: string | null
  readonly pushedAfter: string | null
  readonly pushedBefore: string | null
}

export interface RepositoryQuery {
  readonly view: LibraryView
  readonly search: string
  readonly filters: RepositoryFilters
  readonly sort: RepositorySort
  readonly ascending: boolean
}

export interface LibraryRepository {
  readonly repository: RepositoryRecord
  readonly annotation: AnnotationRecord | null
  readonly nativeLists: readonly NativeListRecord[]
}

export interface ViewCounts {
  readonly inbox: number
  readonly backlog: number
  readonly due: number
  readonly organized: number
  readonly all: number
  readonly unlist: number
  readonly history: number
  readonly lists: Readonly<Record<string, number>>
  readonly tags: Readonly<Record<string, number>>
}

export function defaultRepositoryFilters(): RepositoryFilters {
  return {
    triageStates: [],
    starState: 'starred',
    listNodeId: null,
    tag: null,
    language: null,
    archived: 'all',
    disabled: 'all',
    starredAfter: null,
    starredBefore: null,
    pushedAfter: null,
    pushedBefore: null
  }
}

export function buildLibraryRepositories(
  snapshot: LibrarySnapshot
): readonly LibraryRepository[] {
  const annotations = new Map(
    snapshot.annotations.map((annotation) => [annotation.repositoryNodeId, annotation])
  )
  const lists = new Map(snapshot.nativeLists.map((list) => [list.listNodeId, list]))
  const listIdsByRepository = new Map<string, string[]>()
  for (const membership of snapshot.nativeMemberships) {
    const listIds = listIdsByRepository.get(membership.repositoryNodeId) ?? []
    listIds.push(membership.listNodeId)
    listIdsByRepository.set(membership.repositoryNodeId, listIds)
  }

  return snapshot.repositories.map((repository) => ({
    repository,
    annotation: annotations.get(repository.repositoryNodeId) ?? null,
    nativeLists: (listIdsByRepository.get(repository.repositoryNodeId) ?? [])
      .flatMap((listNodeId) => {
        const list = lists.get(listNodeId)
        return list ? [list] : []
      })
      .sort((left, right) => left.name.localeCompare(right.name))
  }))
}

export function queryRepositories(
  repositories: readonly LibraryRepository[],
  query: RepositoryQuery,
  now: number
): readonly LibraryRepository[] {
  const searchTerms = normalizeSearch(query.search).split(' ').filter(Boolean)
  return repositories
    .filter((item) => matchesView(item, query.view, now))
    .filter((item) => matchesFilters(item, query.filters))
    .filter((item) => matchesSearch(item, searchTerms))
    .toSorted((left, right) => compareRepositories(left, right, query))
}

export function deriveViewCounts(
  repositories: readonly LibraryRepository[],
  now: number
): ViewCounts {
  const lists: Record<string, number> = {}
  const tags: Record<string, number> = {}
  let inbox = 0
  let backlog = 0
  let due = 0
  let organized = 0
  let all = 0
  let unlist = 0
  let history = 0

  for (const item of repositories) {
    if (!item.repository.isStarred) {
      history += 1
      continue
    }
    if (item.nativeLists.length === 0) unlist += 1
    all += 1
    if (item.annotation?.triageState === 'inbox') inbox += 1
    if (item.annotation?.triageState === 'backlog') backlog += 1
    if (item.annotation?.triageState === 'reviewed') organized += 1
    if (isRepositoryDue(item, now)) due += 1
    for (const list of item.nativeLists) {
      lists[list.listNodeId] = (lists[list.listNodeId] ?? 0) + 1
    }
    for (const tag of item.annotation?.tags ?? []) {
      tags[tag] = (tags[tag] ?? 0) + 1
    }
  }
  return {inbox, backlog, due, organized, all, unlist, history, lists, tags}
}

export function operationHistoryForRepository(
  history: readonly OperationHistoryRecord[],
  repositoryNodeId: string
): readonly OperationHistoryRecord[] {
  return history
    .filter((record) => record.repositoryNodeId === repositoryNodeId)
    .toSorted(
      (left, right) =>
        right.occurredAt.localeCompare(left.occurredAt) ||
        right.historyId.localeCompare(left.historyId)
    )
}

export function isRepositoryDue(item: LibraryRepository, now: number): boolean {
  return Boolean(
    item.repository.isStarred &&
      item.annotation?.revisitAt &&
      Date.parse(item.annotation.revisitAt) <= now
  )
}

export function safeGitHubUrl(value: string): string | null {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && url.hostname === 'github.com'
      ? url.toString()
      : null
  } catch {
    return null
  }
}

export function nextSelectionIndex(
  currentIndex: number,
  itemCount: number,
  key: 'ArrowDown' | 'ArrowUp' | 'Home' | 'End'
): number {
  if (itemCount <= 0) return -1
  if (key === 'Home') return 0
  if (key === 'End') return itemCount - 1
  if (key === 'ArrowDown') return Math.min(itemCount - 1, currentIndex + 1)
  return Math.max(0, currentIndex - 1)
}

export function availableLanguages(
  repositories: readonly LibraryRepository[]
): readonly string[] {
  return [...new Set(repositories.flatMap((item) => item.repository.primaryLanguage ?? []))]
    .toSorted((left, right) => left.localeCompare(right))
}

function matchesView(item: LibraryRepository, view: LibraryView, now: number): boolean {
  if (view.kind === 'settings' || view.kind === 'operations') return false
  if (view.kind === 'list') {
    return item.repository.isStarred &&
      item.nativeLists.some((list) => list.listNodeId === view.listNodeId)
  }
  if (view.kind === 'tag') {
    return item.repository.isStarred &&
      Boolean(
        item.annotation?.tags.some(
          (tag) => tag.toLocaleLowerCase() === view.tag.toLocaleLowerCase()
        )
      )
  }
  if (view.kind === 'unlist') return item.nativeLists.length === 0
  if (view.kind === 'all') return true
  if (view.kind === 'history') return !item.repository.isStarred
  if (!item.repository.isStarred) return false
  if (view.kind === 'inbox') return item.annotation?.triageState === 'inbox'
  if (view.kind === 'backlog') return item.annotation?.triageState === 'backlog'
  if (view.kind === 'due') return isRepositoryDue(item, now)
  if (view.kind === 'organized') return item.annotation?.triageState === 'reviewed'
  return false
}

function matchesFilters(
  item: LibraryRepository,
  filters: RepositoryFilters
): boolean {
  const repository = item.repository
  const annotation = item.annotation
  if (filters.starState === 'starred' && !repository.isStarred) return false
  if (filters.starState === 'unstarred' && repository.isStarred) return false
  if (
    filters.triageStates.length > 0 &&
    (!annotation || !filters.triageStates.includes(annotation.triageState))
  ) {
    return false
  }
  if (
    filters.listNodeId &&
    !item.nativeLists.some((list) => list.listNodeId === filters.listNodeId)
  ) {
    return false
  }
  if (
    filters.tag &&
    !annotation?.tags.some(
      (tag) => tag.toLocaleLowerCase() === filters.tag?.toLocaleLowerCase()
    )
  ) {
    return false
  }
  if (filters.language && repository.primaryLanguage !== filters.language) return false
  if (!matchesInclusion(repository.archived, filters.archived)) return false
  if (!matchesInclusion(repository.disabled, filters.disabled)) return false
  if (!matchesDate(repository.starredAt, filters.starredAfter, filters.starredBefore)) {
    return false
  }
  if (!matchesDate(repository.pushedAt, filters.pushedAfter, filters.pushedBefore)) {
    return false
  }
  return true
}

function matchesSearch(item: LibraryRepository, terms: readonly string[]): boolean {
  if (terms.length === 0) return true
  const searchable = normalizeSearch(
    [
      item.repository.ownerLogin,
      item.repository.name,
      item.repository.fullName,
      item.repository.description ?? '',
      item.repository.topics.join(' '),
      item.repository.primaryLanguage ?? '',
      item.annotation?.tags.join(' ') ?? '',
      item.annotation?.note ?? '',
      item.nativeLists.map((list) => list.name).join(' ')
    ].join(' ')
  )
  return terms.every((term) => searchable.includes(term))
}

function compareRepositories(
  left: LibraryRepository,
  right: LibraryRepository,
  query: RepositoryQuery
): number {
  const direction = query.ascending ? 1 : -1
  let comparison = 0
  if (query.sort === 'name') {
    comparison = left.repository.fullName.localeCompare(right.repository.fullName)
  } else if (query.sort === 'starred-at') {
    comparison = compareDates(
      left.repository.starredAt,
      right.repository.starredAt,
      query.ascending
    )
  } else if (query.sort === 'pushed-at') {
    comparison = compareDates(
      left.repository.pushedAt,
      right.repository.pushedAt,
      query.ascending
    )
  } else {
    comparison = compareDates(
      left.annotation?.reviewedAt ?? null,
      right.annotation?.reviewedAt ?? null,
      query.ascending
    )
  }
  if (comparison !== 0) {
    return query.sort === 'name' ? comparison * direction : comparison
  }
  return left.repository.repositoryNodeId.localeCompare(
    right.repository.repositoryNodeId
  )
}

function compareDates(
  left: string | null,
  right: string | null,
  ascending: boolean
): number {
  if (left === right) return 0
  if (left === null) return 1
  if (right === null) return -1
  const comparison = Date.parse(left) - Date.parse(right)
  return ascending ? comparison : -comparison
}

function matchesInclusion(value: boolean, filter: InclusionFilter): boolean {
  if (filter === 'all') return true
  return filter === 'only' ? value : !value
}

function matchesDate(
  value: string | null,
  after: string | null,
  before: string | null
): boolean {
  if (!after && !before) return true
  if (!value) return false
  const timestamp = Date.parse(value)
  if (after && timestamp < Date.parse(after)) return false
  if (before && timestamp > Date.parse(before)) return false
  return true
}

function normalizeSearch(value: string): string {
  return value.trim().toLocaleLowerCase().replace(/\s+/g, ' ')
}
