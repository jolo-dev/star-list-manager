import {describe, expect, test} from 'bun:test'
import {serializeLibraryExport} from '../../src/export/serialize'
import type {LibraryExportDocument} from '../../src/domain/types'

describe('library export serialization', () => {
  test('serializes the credential-free schema', () => {
    const serialized = serializeLibraryExport(exportFixture())
    expect(serialized).toContain('"githubUserId": "42"')
    expect(serialized).not.toContain('accessToken')
    expect(serialized).not.toContain('refreshToken')
    expect(serialized).not.toContain('write-access-secret')
    expect(serialized).not.toContain('public_repo')
    expect(serialized).not.toContain('authorization')
  })

  test('rejects runtime objects with undeclared credential fields', () => {
    const unsafeDocument = {
      ...exportFixture(),
      accessToken: 'access-secret'
    } as unknown as LibraryExportDocument

    expect(() => serializeLibraryExport(unsafeDocument)).toThrow()
  })
})

function exportFixture(): LibraryExportDocument {
  return {
    format: 'star-list-manager',
    version: 1,
    exportedAt: '2026-08-03T12:00:00Z',
    githubUserId: '42',
    repositories: [],
    nativeLists: [],
    nativeMemberships: [],
    annotations: [],
    syncState: [],
    settings: {
      githubUserId: '42',
      repositorySort: 'starred-at',
      sortAscending: false,
      staleAfterMinutes: 60,
      exportSchemaVersion: 1,
      localModifiedAt: '2026-08-03T12:00:00Z'
    }
  }
}
