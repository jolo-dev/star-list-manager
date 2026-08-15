import {describe, expect, test} from 'bun:test'
import {
  createCompleteCatalogReader,
  OAuthListRenameProbeFailure,
  parseCliArguments,
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
        temporaryCatalogReadBack: 'verified',
        restorationCatalogReadBack: 'verified'
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

  test('rejects a case-only catalog original-name mismatch without mutation', async () => {
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
          {listNodeId: 'L_disposable', name: 'disposable original'}
        ]
      }),
      'fixture-invalid'
    )

    expect(mutations).toBe(0)
    expect(error.message).not.toContain('disposable original')
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

  test('rejects a NFKC and case-equivalent temporary name already present in the complete catalog without mutation', async () => {
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
          {listNodeId: 'L_equivalent', name: 'ｄisposable temporary 2026-08-15'}
        ]
      }),
      'fixture-invalid'
    )

    expect(mutations).toBe(0)
    expect(error.message).not.toContain('L_equivalent')
  })

  test('rejects a Unicode case-fold-equivalent temporary name already present in the complete catalog without mutation', async () => {
    let mutations = 0
    const error = await expectProbeFailure(
      runOAuthListRenameCapabilityProbe(
        {...options, temporaryName: 'STRASSE'},
        {
          validateExpectedOwner: async () => {},
          transport: {
            rename: async () => {
              mutations += 1
              return {listNodeId: 'L_disposable', name: 'STRASSE'}
            }
          },
          readCompleteCatalog: async () => [
            {listNodeId: 'L_disposable', name: 'Disposable original'},
            {listNodeId: 'L_equivalent', name: 'Straße'}
          ]
        }
      ),
      'fixture-invalid'
    )

    expect(mutations).toBe(0)
    expect(error.message).not.toContain('L_equivalent')
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

  test('does not produce proof when temporary read-back differs only by case', async () => {
    const renames: string[] = []
    const catalogs = catalogSequence([
      [{listNodeId: 'L_disposable', name: 'Disposable original'}],
      [{listNodeId: 'L_disposable', name: 'disposable temporary 2026-08-15'}],
      [{listNodeId: 'L_disposable', name: 'Disposable original'}]
    ])

    await expectProbeFailure(
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
  })

  test('does not produce proof when temporary read-back is only Unicode case-fold-equivalent', async () => {
    const renames: string[] = []
    const catalogs = catalogSequence([
      [{listNodeId: 'L_disposable', name: 'Disposable original'}],
      [{listNodeId: 'L_disposable', name: 'Straße'}],
      [{listNodeId: 'L_disposable', name: 'Disposable original'}]
    ])

    await expectProbeFailure(
      runOAuthListRenameCapabilityProbe(
        {...options, temporaryName: 'STRASSE'},
        {
          validateExpectedOwner: async () => {},
          transport: {
            rename: async (request) => {
              renames.push(request.name)
              return {listNodeId: request.listNodeId, name: request.name}
            }
          },
          readCompleteCatalog: catalogs.read
        }
      ),
      'read-back-mismatch'
    )

    expect(renames).toEqual(['STRASSE', 'Disposable original'])
  })

  test('emits prominent sanitized cleanup guidance after final restoration read-back failure', async () => {
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

describe('OAuth native List rename capability probe real-path guards', () => {
  test('accepts exactly the confirmed disposable fixture CLI arguments', () => {
    expect(
      parseCliArguments([
        '--confirm-disposable-list-rename',
        '--list-node-id=L_disposable',
        '--original-name=Disposable original',
        '--temporary-name=Disposable temporary 2026-08-15',
        '--github-user-id=42'
      ])
    ).toEqual(options)
  })

  for (const arguments_ of [
    [
      '--confirm-disposable-list-rename',
      '--confirm-disposable-list-rename',
      '--list-node-id=L_disposable',
      '--original-name=Disposable original',
      '--temporary-name=Disposable temporary 2026-08-15',
      '--github-user-id=42'
    ],
    [
      '--confirm-disposable-list-rename',
      '--list-node-id=L_disposable',
      '--original-name=Disposable original',
      '--temporary-name=Disposable temporary 2026-08-15'
    ],
    [
      '--confirm-disposable-list-rename',
      '--list-node-id=L_disposable',
      '--original-name=Disposable original',
      '--temporary-name=Disposable temporary 2026-08-15',
      '--github-user-id=42',
      '--not-a-probe-argument=value'
    ]
  ]) {
    test(`rejects invalid CLI input: ${arguments_.at(-1)}`, () => {
      expectCliFailure(() => parseCliArguments(arguments_))
    })
  }

  test('reads every page of the fixed native List catalog query', async () => {
    const requests: Array<{readonly query: string; readonly variables: unknown}> = []
    const responses = [
      catalogPage({
        nodes: [{id: 'L_disposable', name: 'Disposable original'}],
        pageInfo: {hasNextPage: true, endCursor: 'cursor-2'}
      }),
      catalogPage({
        nodes: [{id: 'L_other', name: 'Other List'}],
        pageInfo: {hasNextPage: false, endCursor: null}
      })
    ]
    const readCompleteCatalog = createCompleteCatalogReader(
      'probe-token',
      async (input, init) => {
        expect(input).toBe('https://api.github.com/graphql')
        const body = JSON.parse(String(init?.body)) as {
          readonly query: string
          readonly variables: unknown
        }
        requests.push(body)
        const response = responses.shift()
        if (!response) throw new Error('Unexpected request')
        return response
      }
    )

    await expect(readCompleteCatalog('42')).resolves.toEqual([
      {listNodeId: 'L_disposable', name: 'Disposable original'},
      {listNodeId: 'L_other', name: 'Other List'}
    ])
    expect(requests).toHaveLength(2)
    expect(requests.map((request) => request.variables)).toEqual([
      {after: null},
      {after: 'cursor-2'}
    ])
    expect(requests.every((request) => request.query.includes('viewer { lists(first: 100, after: $after)'))).toBe(true)
  })

  for (const [name, response] of [
    [
      'malformed page info',
      catalogPage({nodes: [], pageInfo: {hasNextPage: true, endCursor: null}})
    ],
    [
      'malformed nodes',
      catalogPage({nodes: [{id: 'L_disposable'}], pageInfo: {hasNextPage: false, endCursor: null}})
    ],
    ['GraphQL errors', catalogResponse({errors: [{message: 'probe-token raw-response'}]})],
    ['HTTP failures', new Response('probe-token raw-response', {status: 500})]
  ] as const) {
    test(`sanitizes ${name} from the complete catalog reader`, async () => {
      const reader = createCompleteCatalogReader('probe-token', async () => response)
      await expectSanitizedCatalogFailure(reader('42'))
    })
  }

  test('sanitizes network failures from the complete catalog reader', async () => {
    const reader = createCompleteCatalogReader('probe-token', async () => {
      throw new Error('probe-token raw-response')
    })
    await expectSanitizedCatalogFailure(reader('42'))
  })

  test('attempts restoration after an ambiguous initial mutation rejection', async () => {
    const renames: string[] = []
    const catalogs = catalogSequence([
      [{listNodeId: 'L_disposable', name: 'Disposable original'}],
      [{listNodeId: 'L_disposable', name: 'Disposable original'}]
    ])

    const error = await expectProbeFailure(
      runOAuthListRenameCapabilityProbe(options, {
        validateExpectedOwner: async () => {},
        transport: {
          rename: async (request) => {
            renames.push(request.name)
            if (renames.length === 1) throw new Error('ambiguous transport rejection')
            return {listNodeId: request.listNodeId, name: request.name}
          }
        },
        readCompleteCatalog: catalogs.read
      }),
      'mutation-failed'
    )

    expect(renames).toEqual(['Disposable temporary 2026-08-15', 'Disposable original'])
    expect(error.cleanupRequired).toBe(false)
  })

  test('attempts restoration after a mismatched initial mutation response', async () => {
    const renames: string[] = []
    const catalogs = catalogSequence([
      [{listNodeId: 'L_disposable', name: 'Disposable original'}],
      [{listNodeId: 'L_disposable', name: 'Disposable original'}]
    ])

    await expectProbeFailure(
      runOAuthListRenameCapabilityProbe(options, {
        validateExpectedOwner: async () => {},
        transport: {
          rename: async (request) => {
            renames.push(request.name)
            return renames.length === 1
              ? {listNodeId: 'L_unconfirmed', name: request.name}
              : {listNodeId: request.listNodeId, name: request.name}
          }
        },
        readCompleteCatalog: catalogs.read
      }),
      'mutation-failed'
    )

    expect(renames).toEqual(['Disposable temporary 2026-08-15', 'Disposable original'])
  })

  test('emits cleanup-required guidance after restoration transport failure', async () => {
    const catalogs = catalogSequence([
      [{listNodeId: 'L_disposable', name: 'Disposable original'}],
      [{listNodeId: 'L_disposable', name: 'Disposable temporary 2026-08-15'}]
    ])
    let mutations = 0

    const error = await expectProbeFailure(
      runOAuthListRenameCapabilityProbe(options, {
        validateExpectedOwner: async () => {},
        transport: {
          rename: async (request) => {
            mutations += 1
            if (mutations === 2) throw new Error('probe-token raw-response')
            return {listNodeId: request.listNodeId, name: request.name}
          }
        },
        readCompleteCatalog: catalogs.read
      }),
      'cleanup-failed'
    )

    expect(error.cleanupRequired).toBe(true)
    expect(error.message).toContain('CLEANUP REQUIRED')
    expect(error.message).not.toContain('probe-token')
  })
})

function catalogPage(lists: unknown): Response {
  return catalogResponse({data: {viewer: {lists}}})
}

function catalogResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {'content-type': 'application/json'}
  })
}

async function expectSanitizedCatalogFailure(promise: Promise<unknown>): Promise<void> {
  const error = await expectProbeFailure(promise, 'catalog-read-failed')
  expect(error.message).not.toContain('probe-token')
  expect(error.message).not.toContain('raw-response')
}

function expectCliFailure(action: () => unknown): void {
  expect(action).toThrow(OAuthListRenameProbeFailure)
  try {
    action()
  } catch (error: unknown) {
    expect(error).toBeInstanceOf(OAuthListRenameProbeFailure)
    if (error instanceof OAuthListRenameProbeFailure) {
      expect(error.code).toBe('invalid-input')
    }
  }
}

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
