import {describe, expect, test} from 'bun:test'
import {IDBFactory} from 'fake-indexeddb'
import type {
  AnnotationRecord,
  LibraryExportDocument,
  RepositoryRecord,
  SettingsRecord,
  WriteAuthStateRecord
} from '../../src/domain/types'
import {DataPortabilityService} from '../../src/import/service'
import {openLibraryDatabase} from '../../src/storage/database'
import {
  clearAllLibraryData,
  getAnnotation,
  getAuthState,
  getRepository,
  getSettings,
  getWriteAuthState,
  hasRetainedLibraryData,
  putAnnotation,
  putAuthState,
  putRepository,
  putSettings,
  putWriteAuthState
} from '../../src/storage/library'

const now = Date.parse('2026-08-03T12:00:00Z')

describe('data portability', () => {
  test('exports only the active namespace without credentials', async () => {
    const database = await testDatabase('portability-export')
    await putRepository(database, repository('42', 'R_active'))
    await putRepository(database, repository('99', 'R_other'))
    await putAnnotation(database, annotation('42', 'R_active', '2026-08-03T10:00:00Z'))
    await putAuthState(database, {
      githubUserId: '42',
      identity: {
        githubUserId: '42',
        userNodeId: 'U_active',
        login: 'active',
        avatarUrl: 'https://avatars.githubusercontent.com/u/42'
      },
      credentials: {
        accessToken: 'access-secret',
        refreshToken: 'refresh-secret',
        accessTokenExpiresAt: '2026-08-04T12:00:00Z',
        refreshTokenExpiresAt: '2027-02-03T12:00:00Z',
        generation: 1
      },
      authenticatedAt: '2026-08-03T10:00:00Z',
      refreshedAt: '2026-08-03T10:00:00Z'
    })
    await putWriteAuthState(database, writeAuthState())
    const service = new DataPortabilityService(database, () => now)

    const exported = await service.exportNamespace('42')
    expect(exported.filename).toBe('star-list-manager-42-2026-08-03.json')
    expect(exported.content).toContain('R_active')
    expect(exported.content).not.toContain('R_other')
    expect(exported.content).not.toContain('access-secret')
    expect(exported.content).not.toContain('refresh-secret')
    database.close()
  })

  test('previews and applies deterministic non-destructive merge rules', async () => {
    const database = await testDatabase('portability-merge')
    await putRepository(database, {...repository('42', 'R_existing'), description: null})
    await putAnnotation(
      database,
      annotation('42', 'R_existing', '2026-08-03T10:00:00Z')
    )
    await putSettings(database, settings('42', 'name'))
    const service = new DataPortabilityService(database, () => now)
    const imported = exportDocument()

    const preview = await service.previewImport('42', imported, false)
    expect(preview).toMatchObject({
      added: 1,
      updated: 1,
      metadataFilled: 1,
      settingsSelected: 0
    })
    expect(await service.applyImport('42', imported, false)).toEqual(preview)
    expect((await getRepository(database, '42', 'R_existing'))?.description).toBe(
      'Imported historical description'
    )
    expect((await getAnnotation(database, '42', 'R_existing'))?.note).toBe(
      'Newer imported note'
    )
    expect(await getAnnotation(database, '42', 'R_added')).not.toBeNull()
    expect((await getSettings(database, '42'))?.repositorySort).toBe('name')
    database.close()
  })

  test('rejects another account without changing local data', async () => {
    const database = await testDatabase('portability-account-mismatch')
    const local = annotation('42', 'R_existing', '2026-08-03T10:00:00Z')
    await putAnnotation(database, local)
    const service = new DataPortabilityService(database, () => now)
    const source = exportDocument()
    const imported = {
      ...source,
      githubUserId: '99',
      repositories: [],
      annotations: [],
      settings: {...source.settings, githubUserId: '99'}
    }

    await expect(service.applyImport('42', imported, true)).rejects.toThrow(
      'different GitHub account'
    )
    expect(await getAnnotation(database, '42', 'R_existing')).toEqual(local)
    database.close()
  })

  test('clears credentials and every library store for complete removal', async () => {
    const database = await testDatabase('portability-delete')
    await putRepository(database, repository('42', 'R_existing'))
    await putAnnotation(database, annotation('42', 'R_existing', '2026-08-03T10:00:00Z'))
    await putSettings(database, settings('42', 'name'))
    await putAuthState(database, {
      githubUserId: '42',
      identity: {
        githubUserId: '42',
        userNodeId: 'U_active',
        login: 'active',
        avatarUrl: 'https://avatars.githubusercontent.com/u/42'
      },
      credentials: {
        accessToken: 'access-secret',
        refreshToken: 'refresh-secret',
        accessTokenExpiresAt: '2026-08-04T12:00:00Z',
        refreshTokenExpiresAt: '2027-02-03T12:00:00Z',
        generation: 1
      },
      authenticatedAt: '2026-08-03T10:00:00Z',
      refreshedAt: '2026-08-03T10:00:00Z'
    })
    await putWriteAuthState(database, writeAuthState())

    await clearAllLibraryData(database)
    expect(await hasRetainedLibraryData(database)).toBe(false)
    expect(await getAuthState(database, '42')).toBeNull()
    expect(await getWriteAuthState(database, '42')).toBeNull()
    expect(await getSettings(database, '42')).toBeNull()
    database.close()
  })
})

function exportDocument(): LibraryExportDocument {
  return {
    format: 'star-list-manager',
    version: 1,
    exportedAt: '2026-08-03T12:00:00Z',
    githubUserId: '42',
    repositories: [
      {
        ...repository('42', 'R_existing'),
        description: 'Imported historical description'
      }
    ],
    nativeLists: [],
    nativeMemberships: [],
    annotations: [
      {
        ...annotation('42', 'R_existing', '2026-08-03T11:00:00Z'),
        note: 'Newer imported note'
      },
      annotation('42', 'R_added', '2026-08-03T11:00:00Z')
    ],
    syncState: [],
    settings: settings('42', 'reviewed-at')
  }
}

function writeAuthState(): WriteAuthStateRecord {
  return {
    githubUserId: '42',
    identity: {
      githubUserId: '42',
      userNodeId: 'U_active',
      login: 'active',
      avatarUrl: 'https://avatars.githubusercontent.com/u/42'
    },
    credential: {
      accessToken: 'write-access-secret',
      tokenType: 'bearer',
      grantedScopes: ['public_repo']
    },
    authorizedAt: '2026-08-03T10:00:00Z',
    lastFailure: null
  }
}

function repository(githubUserId: string, repositoryNodeId: string): RepositoryRecord {
  return {
    githubUserId,
    repositoryNodeId,
    ownerLogin: 'jolo-dev',
    name: repositoryNodeId,
    fullName: `jolo-dev/${repositoryNodeId}`,
    htmlUrl: `https://github.com/jolo-dev/${repositoryNodeId}`,
    description: 'Local description',
    topics: [],
    primaryLanguage: null,
    starredAt: '2026-08-01T12:00:00Z',
    pushedAt: null,
    archived: false,
    disabled: false,
    isStarred: true,
    firstObservedAt: '2026-08-01T12:00:00Z',
    lastObservedAt: '2026-08-03T12:00:00Z',
    unstarredAt: null
  }
}

function annotation(
  githubUserId: string,
  repositoryNodeId: string,
  localModifiedAt: string
): AnnotationRecord {
  return {
    githubUserId,
    repositoryNodeId,
    triageState: 'backlog',
    tags: ['Research'],
    note: 'Local note',
    favorite: false,
    revisitAt: null,
    reviewedAt: null,
    localModifiedAt
  }
}

function settings(
  githubUserId: string,
  repositorySort: SettingsRecord['repositorySort']
): SettingsRecord {
  return {
    githubUserId,
    repositorySort,
    sortAscending: false,
    staleAfterMinutes: 60,
    exportSchemaVersion: 1,
    localModifiedAt: '2026-08-03T10:00:00Z'
  }
}

function testDatabase(name: string): Promise<IDBDatabase> {
  return openLibraryDatabase({name, factory: new IDBFactory()})
}
