import type {
  GitHubIdentity,
  GitHubUserId,
  IsoDateTime,
  NativeListRecord,
  RepositoryRecord
} from '../domain/types'
import type {AppError} from '../shared/errors'
import type {Result} from '../shared/result'
import {
  DecodeFailure,
  decodeValue,
  optionalNullableIsoDateTime,
  optionalNullableString,
  requireArray,
  requireBoolean,
  requireIsoDateTime,
  requireNonEmptyString,
  requireNonNegativeInteger,
  requireNullableIsoDateTime,
  requireNullableString,
  requireRecord,
  requireStringArray
} from '../shared/validation'

export interface DecodedStarredRepository {
  readonly starredAt: IsoDateTime
  readonly repositoryNodeId: string
  readonly ownerLogin: string
  readonly name: string
  readonly fullName: string
  readonly htmlUrl: string
  readonly description: string | null
  readonly topics: readonly string[]
  readonly primaryLanguage: string | null
  readonly pushedAt: IsoDateTime | null
  readonly archived: boolean
  readonly disabled: boolean
  readonly private: boolean
}

export interface DecodedGitHubIdentity {
  readonly githubUserId: GitHubUserId
  readonly userNodeId: string
  readonly login: string
  readonly avatarUrl: string
}

export interface DecodedPublicRepositoryRoute {
  readonly repositoryNodeId: string
  readonly owner: string
  readonly repositoryName: string
  readonly private: boolean
}

export interface DecodedPageInfo {
  readonly hasNextPage: boolean
  readonly endCursor: string | null
}

export interface DecodedNativeList {
  readonly listNodeId: string
  readonly name: string
  readonly description: string | null
  readonly isPrivate: boolean
  readonly slug: string | null
  readonly createdAt: IsoDateTime | null
  readonly updatedAt: IsoDateTime | null
  readonly lastAddedAt: IsoDateTime | null
  readonly reportedItemCount: number
  readonly repositoryNodeIds: readonly string[]
  readonly itemPageInfo: DecodedPageInfo
}

export interface DecodedViewerListsPage {
  readonly totalCount: number
  readonly pageInfo: DecodedPageInfo
  readonly lists: readonly DecodedNativeList[]
}

export interface DecodedNativeListMetadata {
  readonly listNodeId: string
  readonly name: string
  readonly description: string | null
  readonly isPrivate: boolean
  readonly slug: string | null
  readonly createdAt: IsoDateTime | null
  readonly updatedAt: IsoDateTime | null
  readonly lastAddedAt: IsoDateTime | null
  readonly reportedItemCount: number
}

export interface DecodedNativeListCatalogPage {
  readonly totalCount: number
  readonly pageInfo: DecodedPageInfo
  readonly lists: readonly DecodedNativeListMetadata[]
}

export interface DecodedNativeListItemsPage {
  readonly totalCount: number
  readonly pageInfo: DecodedPageInfo
  readonly repositoryNodeIds: readonly string[]
}

export function decodeStarredRepositoryPage(
  value: unknown
): Result<readonly DecodedStarredRepository[], AppError> {
  return decodeValue(() =>
    requireArray(value, 'github.stars').map((item, index) =>
      decodeStarredRepository(item, `github.stars[${index}]`)
    )
  )
}

export function decodeGitHubIdentity(
  value: unknown
): Result<DecodedGitHubIdentity, AppError> {
  return decodeValue(() => {
    const record = requireRecord(value, 'github.user')
    const databaseId = record.id
    if (
      (typeof databaseId !== 'number' || !Number.isSafeInteger(databaseId)) &&
      typeof databaseId !== 'string'
    ) {
      throw new DecodeFailure('github.user.id', 'a stable numeric identifier')
    }

    return {
      githubUserId: String(databaseId),
      userNodeId: requireNonEmptyString(record, 'node_id', 'github.user'),
      login: requireNonEmptyString(record, 'login', 'github.user'),
      avatarUrl: requireNonEmptyString(record, 'avatar_url', 'github.user')
    }
  })
}

export function decodePublicRepositoryRoute(
  value: unknown
): Result<DecodedPublicRepositoryRoute, AppError> {
  return decodeValue(() => {
    const repository = requireRecord(value, 'github.repository')
    const owner = requireRecord(repository.owner, 'github.repository.owner')
    return {
      repositoryNodeId: requireNonEmptyString(
        repository,
        'node_id',
        'github.repository'
      ),
      owner: requireNonEmptyString(owner, 'login', 'github.repository.owner'),
      repositoryName: requireNonEmptyString(repository, 'name', 'github.repository'),
      private: requireBoolean(repository, 'private', 'github.repository')
    }
  })
}

export function decodeViewerListsPage(
  value: unknown
): Result<DecodedViewerListsPage, AppError> {
  return decodeValue(() => {
    const root = requireRecord(value, 'github.graphql')
    if (Array.isArray(root.errors) && root.errors.length > 0) {
      throw new DecodeFailure('github.graphql', 'a successful native List response')
    }
    const data = requireRecord(root.data, 'github.graphql.data')
    const viewer = requireRecord(data.viewer, 'github.graphql.data.viewer')
    const lists = requireRecord(viewer.lists, 'github.graphql.data.viewer.lists')
    const nodes = requireArray(lists.nodes, 'github.graphql.data.viewer.lists.nodes')

    return {
      totalCount: requireNonNegativeInteger(
        lists,
        'totalCount',
        'github.graphql.data.viewer.lists'
      ),
      pageInfo: decodePageInfo(
        lists.pageInfo,
        'github.graphql.data.viewer.lists.pageInfo'
      ),
      lists: nodes.map((node, index) =>
        decodeNativeList(node, `github.graphql.data.viewer.lists.nodes[${index}]`)
      )
    }
  })
}

export function decodeNativeListCatalogPage(
  value: unknown
): Result<DecodedNativeListCatalogPage, AppError> {
  return decodeValue(() => {
    const lists = decodeViewerListsConnection(value)
    const nodes = requireArray(lists.nodes, 'github.graphql.data.viewer.lists.nodes')
    return {
      totalCount: requireNonNegativeInteger(
        lists,
        'totalCount',
        'github.graphql.data.viewer.lists'
      ),
      pageInfo: decodePageInfo(
        lists.pageInfo,
        'github.graphql.data.viewer.lists.pageInfo'
      ),
      lists: nodes.map((node, index) =>
        decodeNativeListMetadata(
          node,
          `github.graphql.data.viewer.lists.nodes[${index}]`
        )
      )
    }
  })
}

export function decodeNativeListItemsPage(
  value: unknown
): Result<DecodedNativeListItemsPage, AppError> {
  return decodeValue(() => {
    const root = requireSuccessfulGraphqlRoot(value)
    const node = requireRecord(root.node, 'github.graphql.data.node')
    const items = requireRecord(node.items, 'github.graphql.data.node.items')
    const nodes = requireArray(items.nodes, 'github.graphql.data.node.items.nodes')
    const repositoryNodeIds = nodes.flatMap((item) => {
      if (item === null || typeof item !== 'object' || Array.isArray(item)) return []
      const id = (item as Readonly<Record<string, unknown>>).id
      return typeof id === 'string' && id.length > 0 ? [id] : []
    })
    return {
      totalCount: requireNonNegativeInteger(
        items,
        'totalCount',
        'github.graphql.data.node.items'
      ),
      pageInfo: decodePageInfo(
        items.pageInfo,
        'github.graphql.data.node.items.pageInfo'
      ),
      repositoryNodeIds
    }
  })
}

export function mapStarredRepository(
  githubUserId: GitHubUserId,
  repository: DecodedStarredRepository,
  observedAt: IsoDateTime
): RepositoryRecord | null {
  if (repository.private) return null

  return {
    githubUserId,
    repositoryNodeId: repository.repositoryNodeId,
    ownerLogin: repository.ownerLogin,
    name: repository.name,
    fullName: repository.fullName,
    htmlUrl: repository.htmlUrl,
    description: repository.description,
    topics: repository.topics,
    primaryLanguage: repository.primaryLanguage,
    starredAt: repository.starredAt,
    pushedAt: repository.pushedAt,
    archived: repository.archived,
    disabled: repository.disabled,
    isStarred: true,
    firstObservedAt: observedAt,
    lastObservedAt: observedAt,
    unstarredAt: null
  }
}

export function mapGitHubIdentity(identity: DecodedGitHubIdentity): GitHubIdentity {
  return identity
}

export function mapNativeList(
  githubUserId: GitHubUserId,
  list: DecodedNativeList,
  observedAt: IsoDateTime
): NativeListRecord {
  const complete =
    !list.itemPageInfo.hasNextPage &&
    list.reportedItemCount === list.repositoryNodeIds.length

  return {
    githubUserId,
    listNodeId: list.listNodeId,
    name: list.name,
    description: list.description,
    visibility: list.isPrivate ? 'private' : 'public',
    slug: list.slug,
    createdAt: list.createdAt,
    updatedAt: list.updatedAt,
    lastAddedAt: list.lastAddedAt,
    reportedItemCount: list.reportedItemCount,
    importedItemCount: list.repositoryNodeIds.length,
    importStatus: complete ? 'complete' : 'partial',
    lastObservedAt: observedAt
  }
}

function decodeStarredRepository(
  value: unknown,
  path: string
): DecodedStarredRepository {
  const record = requireRecord(value, path)
  const repository = requireRecord(record.repo, `${path}.repo`)
  const owner = requireRecord(repository.owner, `${path}.repo.owner`)

  return {
    starredAt: requireIsoDateTime(record, 'starred_at', path),
    repositoryNodeId: requireNonEmptyString(repository, 'node_id', `${path}.repo`),
    ownerLogin: requireNonEmptyString(owner, 'login', `${path}.repo.owner`),
    name: requireNonEmptyString(repository, 'name', `${path}.repo`),
    fullName: requireNonEmptyString(repository, 'full_name', `${path}.repo`),
    htmlUrl: requireNonEmptyString(repository, 'html_url', `${path}.repo`),
    description: requireNullableString(repository, 'description', `${path}.repo`),
    topics: requireStringArray(repository, 'topics', `${path}.repo`),
    primaryLanguage: requireNullableString(repository, 'language', `${path}.repo`),
    pushedAt: requireNullableIsoDateTime(repository, 'pushed_at', `${path}.repo`),
    archived: requireBoolean(repository, 'archived', `${path}.repo`),
    disabled: requireBoolean(repository, 'disabled', `${path}.repo`),
    private: requireBoolean(repository, 'private', `${path}.repo`)
  }
}

function decodeNativeList(value: unknown, path: string): DecodedNativeList {
  const record = requireRecord(value, path)
  const items = requireRecord(record.items, `${path}.items`)
  const nodes = requireArray(items.nodes, `${path}.items.nodes`)
  const repositoryNodeIds = nodes.flatMap((node, index) => {
    if (node === null) return []
    const repository = requireRecord(node, `${path}.items.nodes[${index}]`)
    return [requireNonEmptyString(repository, 'id', `${path}.items.nodes[${index}]`)]
  })

  return {
    listNodeId: requireNonEmptyString(record, 'id', path),
    name: requireNonEmptyString(record, 'name', path),
    description: optionalNullableString(record, 'description', path),
    isPrivate: requireBoolean(record, 'isPrivate', path),
    slug: optionalNullableString(record, 'slug', path),
    createdAt: optionalNullableIsoDateTime(record, 'createdAt', path),
    updatedAt: optionalNullableIsoDateTime(record, 'updatedAt', path),
    lastAddedAt: optionalNullableIsoDateTime(record, 'lastAddedAt', path),
    reportedItemCount: requireNonNegativeInteger(items, 'totalCount', `${path}.items`),
    repositoryNodeIds,
    itemPageInfo: decodePageInfo(items.pageInfo, `${path}.items.pageInfo`)
  }
}

function decodeNativeListMetadata(
  value: unknown,
  path: string
): DecodedNativeListMetadata {
  const record = requireRecord(value, path)
  const items = requireRecord(record.items, `${path}.items`)
  return {
    listNodeId: requireNonEmptyString(record, 'id', path),
    name: requireNonEmptyString(record, 'name', path),
    description: optionalNullableString(record, 'description', path),
    isPrivate: requireBoolean(record, 'isPrivate', path),
    slug: optionalNullableString(record, 'slug', path),
    createdAt: optionalNullableIsoDateTime(record, 'createdAt', path),
    updatedAt: optionalNullableIsoDateTime(record, 'updatedAt', path),
    lastAddedAt: optionalNullableIsoDateTime(record, 'lastAddedAt', path),
    reportedItemCount: requireNonNegativeInteger(items, 'totalCount', `${path}.items`)
  }
}

function decodeViewerListsConnection(
  value: unknown
): Readonly<Record<string, unknown>> {
  const data = requireSuccessfulGraphqlRoot(value)
  const viewer = requireRecord(data.viewer, 'github.graphql.data.viewer')
  return requireRecord(viewer.lists, 'github.graphql.data.viewer.lists')
}

function requireSuccessfulGraphqlRoot(
  value: unknown
): Readonly<Record<string, unknown>> {
  const root = requireRecord(value, 'github.graphql')
  if (Array.isArray(root.errors) && root.errors.length > 0) {
    throw new DecodeFailure('github.graphql', 'a successful response')
  }
  return requireRecord(root.data, 'github.graphql.data')
}

function decodePageInfo(value: unknown, path: string): DecodedPageInfo {
  const record = requireRecord(value, path)
  return {
    hasNextPage: requireBoolean(record, 'hasNextPage', path),
    endCursor: optionalNullableString(record, 'endCursor', path)
  }
}
