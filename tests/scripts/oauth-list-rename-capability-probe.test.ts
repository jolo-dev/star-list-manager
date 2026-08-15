import {describe, expect, test} from 'bun:test'
import {
  OAuthListRenameProbeFailure,
  runOAuthListRenameCapabilityProbe,
  type OAuthListRenameProbeDependencies,
  type NativeListCatalogObservation
} from '../../scripts/oauth-list-rename-capability-probe'
import {nativeListRenameControlsEnabled} from '../../src/github/list-rename-capability'

const options = {
  disposableListNodeId: 'L_disposable',
  expectedOriginalName: 'Disposable original',
  temporaryName: 'Disposable temporary 2026-08-15',
  expectedGitHubUserId: '42'
} as const

describe('OAuth native List rename capability probe', () => {
  test('renames the confirmed disposable List, independently reads the full catalog, and restores it', async () => {
    const owners: string[] = []
    const renames: Array<{readonly listNodeId: string; readonly name: string}> = []
    const catalogs = catalogSequence([
      [
        {listNodeId: 'L_disposable', name: 'Disposable original'},
        {listNodeId: 'L_other', name: 'Other List'}
      ],
      [
        {listNodeId: 'L_disposable', name: 'Disposable temporary 2026-08-15'},
        {listNodeId: 'L_other', name: 'Other List'}
      ],
      [
        {listNodeId: 'L_disposable', name: 'Disposable original'},
        {listNodeId: 'L_other', name: 'Other List'}
      ]
    ])

    const result = await runOAuthListRenameCapabilityProbe(options, {
      validateExpectedOwner: async (owner) => {
        owners.push(owner)
      },
      transport: {
        rename: async (request) => {
          expect(request.expectedGitHubUserId).toBe('42')
          renames.push({listNodeId: request.listNodeId, name: request.name})
          return {listNodeId: request.listNodeId, name: request.name}
        }
      },
      readCompleteCatalog: catalogs.read
    })

    expect(owners).toEqual(['42'])
    expect(renames).toEqual([
      {listNodeId: 'L_disposable', name: 'Disposable temporary 2026-08-15'},
      {listNodeId: 'L_disposable', name: 'Disposable original'}
    ])
    expect(catalogs.calls()).toBe(3)
    expect(result).toEqual({
      githubUserId: '42',
      listNodeId: 'L_disposable',
      proof: {
        schema: 'available',
        oauthUserScope: 'verified',
        accountOwnership: 'verified',
        temporaryRenameMutation: 'verified',
        restorationMutation: 'verified',
        independentCatalogReadBack: 'verified'
      }
    })
    expect(nativeListRenameControlsEnabled(result.proof)).toBe(true)
    expect(JSON.stringify(result)).not.toContain('Other List')
  })

  test('does not mutate when the initial complete catalog does not validate the named disposable fixture', async () => {
    let mutations = 0
    const error = await expectProbeFailure(
      runOAuthListRenameCapabilityProbe(options, {
        validateExpectedOwner: async () => {},
        transport: {
          rename: async () => {
            mutations += 1
            return {listNodeId: 'L_disposable', name: 'Disposable temporary 2026-08-15'}
          }
        },
        readCompleteCatalog: async () => [
          {listNodeId: 'L_disposable', name: 'Unapproved personal List'}
        ]
      }),
      'fixture-invalid'
    )

    expect(mutations).toBe(0)
    expect(error.message).not.toContain('Unapproved personal List')
  })

  test('rejects a temporary name already present in the complete catalog without mutation', async () => {
    let mutations = 0
    const error = await expectProbeFailure(
      runOAuthListRenameCapabilityProbe(options, {
        validateExpectedOwner: async () => {},
        transport: {
          rename: async () => {
            mutations += 1
            return {listNodeId: 'L_disposable', name: 'Disposable temporary 2026-08-15'}
          }
        },
        readCompleteCatalog: async () => [
          {listNodeId: 'L_disposable', name: 'Disposable original'},
          {listNodeId: 'L_existing', name: 'Disposable temporary 2026-08-15'}
        ]
      }),
      'fixture-invalid'
    )

    expect(mutations).toBe(0)
    expect(error.message).not.toContain('L_existing')
  })

  test('does not produce proof when temporary read-back fails after the rename but restoration succeeds', async () => {
    const renames: string[] = []
    const catalogs = catalogSequence([
      [{listNodeId: 'L_disposable', name: 'Disposable original'}],
      [{listNodeId: 'L_disposable', name: 'Unexpected external name'}],
      [{listNodeId: 'L_disposable', name: 'Disposable original'}]
    ])

    const error = await expectProbeFailure(
      runOAuthListRenameCapabilityProbe(options, {
        validateExpectedOwner: async () => {},
        transport: {
          rename: async (request) => {
            renames.push(request.name)
            return {listNodeId: request.listNodeId, name: request.name}
          }
        },
        readCompleteCatalog: catalogs.read
      }),
      'read-back-mismatch'
    )

    expect(renames).toEqual(['Disposable temporary 2026-08-15', 'Disposable original'])
    expect(error.message).not.toContain('Unexpected external name')
  })

  test('emits prominent sanitized cleanup guidance if restoration or its read-back fails', async () => {
    const renames: string[] = []
    const catalogs = catalogSequence([
      [{listNodeId: 'L_disposable', name: 'Disposable original'}],
      [{listNodeId: 'L_disposable', name: 'Disposable temporary 2026-08-15'}],
      [{listNodeId: 'L_disposable', name: 'Unexpected external name'}]
    ])

    const error = await expectProbeFailure(
      runOAuthListRenameCapabilityProbe(options, {
        validateExpectedOwner: async () => {},
        transport: {
          rename: async (request) => {
            renames.push(request.name)
            return {listNodeId: request.listNodeId, name: request.name}
          }
        },
        readCompleteCatalog: catalogs.read
      }),
      'cleanup-failed'
    )

    expect(renames).toEqual(['Disposable temporary 2026-08-15', 'Disposable original'])
    expect(error.cleanupRequired).toBe(true)
    expect(error.message).toContain('CLEANUP REQUIRED')
    expect(error.message).not.toContain('Unexpected external name')
  })
})

function catalogSequence(values: readonly NativeListCatalogObservation[]): {
  readonly read: OAuthListRenameProbeDependencies['readCompleteCatalog']
  readonly calls: () => number
} {
  let callCount = 0
  return {
    read: async (expectedGitHubUserId) => {
      expect(expectedGitHubUserId).toBe('42')
      const value = values[callCount]
      callCount += 1
      if (!value) throw new Error('Unexpected catalog read.')
      return value
    },
    calls: () => callCount
  }
}

async function expectProbeFailure(
  promise: Promise<unknown>,
  code: OAuthListRenameProbeFailure['code']
): Promise<OAuthListRenameProbeFailure> {
  try {
    await promise
    throw new Error(`Expected ${code}`)
  } catch (error: unknown) {
    expect(error).toBeInstanceOf(OAuthListRenameProbeFailure)
    if (!(error instanceof OAuthListRenameProbeFailure)) throw error
    expect(error.code).toBe(code)
    return error
  }
}
