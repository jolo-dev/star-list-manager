import type {
  AnnotationRecord,
  ExportPayload,
  GitHubUserId,
  ImportImpact,
  LibraryExportDocument,
  NativeListRecord,
  NativeMembershipRecord,
  RepositoryRecord,
  SettingsRecord,
  SyncStateRecord
} from '../domain/types'
import {serializeLibraryExport} from '../export/serialize'
import {validationFailure} from '../shared/errors'
import {
  libraryIndexes,
  libraryStores,
  requestResult,
  runLibraryTransaction
} from '../storage/database'
import {
  annotationTagIndexKey,
  getSettings,
  getSyncState,
  listAnnotations,
  listNativeLists,
  listNativeMemberships,
  listRepositories
} from '../storage/library'
import {decodeLibraryExportDocument} from './decoder'

interface StoredAnnotation extends AnnotationRecord {
  readonly indexedTags: readonly string[]
}

interface ImportPlan {
  readonly impact: ImportImpact
  readonly repositories: readonly RepositoryRecord[]
  readonly nativeLists: readonly NativeListRecord[]
  readonly memberships: readonly NativeMembershipRecord[]
  readonly annotations: readonly AnnotationRecord[]
  readonly syncState: readonly SyncStateRecord[]
  readonly settings: SettingsRecord | null
}

interface LocalRecords {
  readonly repositories: readonly RepositoryRecord[]
  readonly nativeLists: readonly NativeListRecord[]
  readonly memberships: readonly NativeMembershipRecord[]
  readonly annotations: readonly AnnotationRecord[]
  readonly syncState: readonly SyncStateRecord[]
  readonly settings: SettingsRecord | null
}

export class DataPortabilityService {
  readonly #database: IDBDatabase
  readonly #now: () => number

  constructor(database: IDBDatabase, now = Date.now) {
    this.#database = database
    this.#now = now
  }

  async exportNamespace(githubUserId: GitHubUserId): Promise<ExportPayload> {
    const [repositories, nativeLists, nativeMemberships, annotations, settings, stars, lists] =
      await Promise.all([
        listRepositories(this.#database, githubUserId),
        listNativeLists(this.#database, githubUserId),
        listNativeMemberships(this.#database, githubUserId),
        listAnnotations(this.#database, githubUserId),
        getSettings(this.#database, githubUserId),
        getSyncState(this.#database, githubUserId, 'stars'),
        getSyncState(this.#database, githubUserId, 'native-lists')
      ])
    const exportedAt = new Date(this.#now()).toISOString()
    const document: LibraryExportDocument = {
      format: 'star-list-manager',
      version: 1,
      exportedAt,
      githubUserId,
      repositories,
      nativeLists,
      nativeMemberships,
      annotations,
      syncState: [stars, lists].flatMap((state) => (state ? [state] : [])),
      settings: settings ?? defaultSettings(githubUserId, exportedAt)
    }
    return {
      filename: `star-list-manager-${githubUserId}-${exportedAt.slice(0, 10)}.json`,
      content: serializeLibraryExport(document)
    }
  }

  async previewImport(
    activeGithubUserId: GitHubUserId,
    value: unknown,
    replaceSettings: boolean
  ): Promise<ImportImpact> {
    const document = decodeImport(value, activeGithubUserId)
    const local = await this.#loadLocal(activeGithubUserId)
    return createImportPlan(local, document, replaceSettings).impact
  }

  async applyImport(
    activeGithubUserId: GitHubUserId,
    value: unknown,
    replaceSettings: boolean
  ): Promise<ImportImpact> {
    const document = decodeImport(value, activeGithubUserId)
    const stores = [
      libraryStores.repositories,
      libraryStores.nativeLists,
      libraryStores.nativeMemberships,
      libraryStores.annotations,
      libraryStores.syncState,
      libraryStores.settings
    ] as const

    return runLibraryTransaction(this.#database, stores, 'readwrite', async (transaction) => {
      const local = await loadLocalFromTransaction(
        transaction,
        activeGithubUserId
      )
      const plan = createImportPlan(local, document, replaceSettings)
      const writes: Array<Promise<IDBValidKey>> = []
      const repositoryStore = transaction.objectStore(libraryStores.repositories)
      const listStore = transaction.objectStore(libraryStores.nativeLists)
      const membershipStore = transaction.objectStore(libraryStores.nativeMemberships)
      const annotationStore = transaction.objectStore(libraryStores.annotations)
      const syncStore = transaction.objectStore(libraryStores.syncState)
      const settingsStore = transaction.objectStore(libraryStores.settings)
      for (const record of plan.repositories) writes.push(requestResult(repositoryStore.put(record)))
      for (const record of plan.nativeLists) writes.push(requestResult(listStore.put(record)))
      for (const record of plan.memberships) writes.push(requestResult(membershipStore.put(record)))
      for (const record of plan.annotations) {
        writes.push(requestResult(annotationStore.put(toStoredAnnotation(record))))
      }
      for (const record of plan.syncState) writes.push(requestResult(syncStore.put(record)))
      if (plan.settings) writes.push(requestResult(settingsStore.put(plan.settings)))
      await Promise.all(writes)
      return plan.impact
    })
  }

  async #loadLocal(githubUserId: GitHubUserId): Promise<LocalRecords> {
    const [repositories, nativeLists, memberships, annotations, stars, lists, settings] =
      await Promise.all([
        listRepositories(this.#database, githubUserId),
        listNativeLists(this.#database, githubUserId),
        listNativeMemberships(this.#database, githubUserId),
        listAnnotations(this.#database, githubUserId),
        getSyncState(this.#database, githubUserId, 'stars'),
        getSyncState(this.#database, githubUserId, 'native-lists'),
        getSettings(this.#database, githubUserId)
      ])
    return {
      repositories,
      nativeLists,
      memberships,
      annotations,
      syncState: [stars, lists].flatMap((state) => (state ? [state] : [])),
      settings
    }
  }
}

function createImportPlan(
  local: LocalRecords,
  document: LibraryExportDocument,
  replaceSettings: boolean
): ImportPlan {
  const repositories = mergeMetadata(
    local.repositories,
    document.repositories,
    (record) => record.repositoryNodeId,
    mergeRepository
  )
  const nativeLists = addMissing(
    local.nativeLists,
    document.nativeLists,
    (record) => record.listNodeId
  )
  const memberships = addMissing(
    local.memberships,
    document.nativeMemberships,
    (record) => `${record.listNodeId}\u0000${record.repositoryNodeId}`
  )
  const syncState = addMissing(
    local.syncState,
    document.syncState,
    (record) => record.kind
  )
  const localAnnotations = new Map(
    local.annotations.map((record) => [record.repositoryNodeId, record])
  )
  const annotations: AnnotationRecord[] = []
  let added = repositories.added + nativeLists.added + memberships.added
  let updated = 0
  let unchanged = repositories.unchanged + nativeLists.unchanged + memberships.unchanged
  let skippedConflict = 0

  for (const imported of document.annotations) {
    const existing = localAnnotations.get(imported.repositoryNodeId)
    if (!existing) {
      annotations.push(imported)
      added += 1
      continue
    }
    const importedTime = Date.parse(imported.localModifiedAt)
    const localTime = Date.parse(existing.localModifiedAt)
    if (importedTime > localTime) {
      annotations.push(imported)
      updated += 1
    } else if (importedTime === localTime) {
      unchanged += 1
    } else {
      skippedConflict += 1
    }
  }

  return {
    impact: {
      added,
      updated,
      unchanged: unchanged + syncState.unchanged,
      skippedConflict,
      metadataFilled: repositories.filled + syncState.added,
      settingsSelected: replaceSettings ? 1 : 0
    },
    repositories: repositories.writes,
    nativeLists: nativeLists.writes,
    memberships: memberships.writes,
    annotations,
    syncState: syncState.writes,
    settings: replaceSettings ? document.settings : null
  }
}

function mergeMetadata<T>(
  local: readonly T[],
  imported: readonly T[],
  key: (record: T) => string,
  merge: (existing: T, incoming: T) => T | null
) {
  const current = new Map(local.map((record) => [key(record), record]))
  const writes: T[] = []
  let added = 0
  let filled = 0
  let unchanged = 0
  for (const incoming of imported) {
    const existing = current.get(key(incoming))
    if (!existing) {
      writes.push(incoming)
      added += 1
      continue
    }
    const merged = merge(existing, incoming)
    if (merged) {
      writes.push(merged)
      filled += 1
    } else {
      unchanged += 1
    }
  }
  return {writes, added, filled, unchanged}
}

function addMissing<T>(
  local: readonly T[],
  imported: readonly T[],
  key: (record: T) => string
) {
  const keys = new Set(local.map(key))
  const writes = imported.filter((record) => !keys.has(key(record)))
  return {writes, added: writes.length, unchanged: imported.length - writes.length}
}

function mergeRepository(
  existing: RepositoryRecord,
  incoming: RepositoryRecord
): RepositoryRecord | null {
  const merged = {
    ...existing,
    description: existing.description ?? incoming.description,
    topics: existing.topics.length > 0 ? existing.topics : incoming.topics,
    primaryLanguage: existing.primaryLanguage ?? incoming.primaryLanguage,
    pushedAt: existing.pushedAt ?? incoming.pushedAt,
    firstObservedAt:
      Date.parse(existing.firstObservedAt) <= Date.parse(incoming.firstObservedAt)
        ? existing.firstObservedAt
        : incoming.firstObservedAt
  }
  return JSON.stringify(merged) === JSON.stringify(existing) ? null : merged
}

function decodeImport(
  value: unknown,
  activeGithubUserId: GitHubUserId
): LibraryExportDocument {
  const decoded = decodeLibraryExportDocument(value)
  if (!decoded.ok) throw validationFailure(decoded.error.message)
  if (decoded.value.githubUserId !== activeGithubUserId) {
    throw validationFailure('The import belongs to a different GitHub account.')
  }
  return decoded.value
}

async function loadLocalFromTransaction(
  transaction: IDBTransaction,
  githubUserId: GitHubUserId
): Promise<LocalRecords> {
  const getAll = <T>(storeName: string) =>
    requestResult(
      transaction
        .objectStore(storeName)
        .index(libraryIndexes.byAccount)
        .getAll(githubUserId) as IDBRequest<T[]>
    )
  const [repositories, nativeLists, memberships, storedAnnotations, syncState, settings] =
    await Promise.all([
      getAll<RepositoryRecord>(libraryStores.repositories),
      getAll<NativeListRecord>(libraryStores.nativeLists),
      getAll<NativeMembershipRecord>(libraryStores.nativeMemberships),
      getAll<StoredAnnotation>(libraryStores.annotations),
      getAll<SyncStateRecord>(libraryStores.syncState),
      requestResult(
        transaction.objectStore(libraryStores.settings).get(githubUserId) as IDBRequest<
          SettingsRecord | undefined
        >
      )
    ])
  return {
    repositories,
    nativeLists,
    memberships,
    annotations: storedAnnotations.map(fromStoredAnnotation),
    syncState,
    settings: settings ?? null
  }
}

function toStoredAnnotation(annotation: AnnotationRecord): StoredAnnotation {
  return {
    ...annotation,
    indexedTags: annotation.tags.map((tag) =>
      annotationTagIndexKey(annotation.githubUserId, tag)
    )
  }
}

function fromStoredAnnotation(annotation: StoredAnnotation): AnnotationRecord {
  const {indexedTags: _indexedTags, ...record} = annotation
  return record
}

function defaultSettings(
  githubUserId: GitHubUserId,
  localModifiedAt: string
): SettingsRecord {
  return {
    githubUserId,
    repositorySort: 'starred-at',
    sortAscending: false,
    staleAfterMinutes: 60,
    exportSchemaVersion: 1,
    localModifiedAt
  }
}
