import {describe, expect, test} from 'bun:test'
import {
  OAuthListLifecycleProbeFailure,
  createCompleteCatalogReader,
  parseCliArguments,
  runOAuthListLifecycleCapabilityProbe,
  type NativeListCatalogObservation,
  type OAuthListLifecycleProbeDependencies
} from '../../scripts/oauth-list-lifecycle-capability-probe'
import {nativeListLifecycleControlsEnabled} from '../../src/github/list-lifecycle-capability'

const options = {
  fixtureName: 'Disposable lifecycle 2026-08-20',
  visibility: 'private',
  expectedGitHubUserId: '42'
} as const

describe('OAuth native List lifecycle capability probe', () => {
  test('creates an explicitly named and visible disposable List, reads it back, deletes its returned ID, and observes absence', async () => {
    const creates: unknown[] = []
    const deletes: unknown[] = []
    const catalogs = catalogSequence([
      [],
      [{listNodeId: 'L_created', name: options.fixtureName, visibility: 'private'}],
      []
    ])

    const result = await runOAuthListLifecycleCapabilityProbe(options, {
      validateExpectedOwner: async (githubUserId) => expect(githubUserId).toBe('42'),
      transport: {
        createList: async (request) => {
          creates.push(request)
          return {listNodeId: 'L_created', name: options.fixtureName, visibility: 'private'}
        },
        deleteList: async (request) => {
          deletes.push(request)
        }
      },
      readCompleteCatalog: catalogs.read
    })

    expect(creates).toEqual([{expectedGitHubUserId: '42', name: options.fixtureName, visibility: 'private'}])
    expect(deletes).toEqual([{expectedGitHubUserId: '42', listNodeId: 'L_created'}])
    expect(catalogs.calls()).toBe(3)
    expect(result).toEqual({
      githubUserId: '42',
      proof: {
        schema: 'available',
        oauthUserScope: 'verified',
        accountOwnership: 'verified',
        createReadBack: 'verified',
        deleteReadBack: 'verified'
      }
    })
    expect(nativeListLifecycleControlsEnabled(result.proof)).toBe(true)
  })

  test('does not create when explicit fixture input is invalid or already present', async () => {
    let creates = 0
    const dependencies: OAuthListLifecycleProbeDependencies = {
      validateExpectedOwner: async () => {},
      transport: {
        createList: async () => {
          creates += 1
          return {listNodeId: 'L_created', name: options.fixtureName, visibility: 'private'}
        },
        deleteList: async () => {}
      },
      readCompleteCatalog: async () => [
        {listNodeId: 'L_existing', name: options.fixtureName, visibility: 'private'}
      ]
    }
    await expectProbeFailure(runOAuthListLifecycleCapabilityProbe({...options, fixtureName: ' '}, dependencies), 'invalid-input')
    await expectProbeFailure(runOAuthListLifecycleCapabilityProbe(options, dependencies), 'fixture-invalid')
    expect(creates).toBe(0)
  })

  test('does not produce proof on a create read-back failure but deletes only the returned ID once', async () => {
    const deletes: unknown[] = []
    const error = await expectProbeFailure(
      runOAuthListLifecycleCapabilityProbe(options, {
        validateExpectedOwner: async () => {},
        transport: {
          createList: async () => ({listNodeId: 'L_created', name: options.fixtureName, visibility: 'private'}),
          deleteList: async (request) => { deletes.push(request) }
        },
        readCompleteCatalog: catalogSequence([
          [],
          [{listNodeId: 'L_created', name: 'Unexpected list', visibility: 'private'}],
          []
        ]).read
      }),
      'read-back-mismatch'
    )
    expect(deletes).toEqual([{expectedGitHubUserId: '42', listNodeId: 'L_created'}])
    expect(error.message).not.toContain('Unexpected list')
  })

  test('fails safely and prominently requests manual cleanup when the created fixture may remain', async () => {
    const deletes: string[] = []
    const error = await expectProbeFailure(
      runOAuthListLifecycleCapabilityProbe(options, {
        validateExpectedOwner: async () => {},
        transport: {
          createList: async () => ({listNodeId: 'L_created', name: options.fixtureName, visibility: 'private'}),
          deleteList: async (request) => {
            deletes.push(request.listNodeId)
            throw new Error('gho_lifecycle_probe_secret')
          }
        },
        readCompleteCatalog: catalogSequence([
          [],
          [{listNodeId: 'L_created', name: options.fixtureName, visibility: 'private'}]
        ]).read
      }),
      'cleanup-required'
    )
    expect(deletes).toEqual(['L_created'])
    expect(error.cleanupRequired).toBe(true)
    expect(error.message).toContain('CLEANUP REQUIRED')
    expect(error.message).not.toContain('gho_lifecycle_probe_secret')
  })

  test('accepts only explicit operator-confirmed CLI input and reads every page with its fixed catalog document', async () => {
    expect(parseCliArguments([
      '--confirm-disposable-list-lifecycle',
      '--fixture-name=Disposable lifecycle 2026-08-20',
      '--visibility=private',
      '--github-user-id=42'
    ])).toEqual(options)
    expect(() => parseCliArguments(['--fixture-name=Disposable', '--visibility=private', '--github-user-id=42'])).toThrow(OAuthListLifecycleProbeFailure)

    const bodies: Array<{readonly query: string; readonly variables: unknown}> = []
    const responses = [
      catalogPage([{id: 'L_one', name: 'One', isPrivate: false}], true, 'next'),
      catalogPage([{id: 'L_two', name: 'Two', isPrivate: true}], false, null)
    ]
    const reader = createCompleteCatalogReader('gho_lifecycle_probe_secret', async (_input, init) => {
      bodies.push(JSON.parse(String(init?.body)) as {readonly query: string; readonly variables: unknown})
      const response = responses.shift()
      if (!response) throw new Error('Unexpected request')
      return response
    })
    await expect(reader('42')).resolves.toEqual([
      {listNodeId: 'L_one', name: 'One', visibility: 'public'},
      {listNodeId: 'L_two', name: 'Two', visibility: 'private'}
    ])
    expect(bodies.map((body) => body.variables)).toEqual([{after: null}, {after: 'next'}])
    expect(bodies.every((body) => body.query.includes('query NativeListLifecycleProbeCatalog') && body.query.includes('nodes { id name isPrivate }'))).toBe(true)
  })

  test('sanitizes dependency failures and never retries ambiguous mutations', async () => {
    let creates = 0
    const error = await expectProbeFailure(
      runOAuthListLifecycleCapabilityProbe(options, {
        validateExpectedOwner: () => Promise.reject(new Error('gho_lifecycle_probe_secret')),
        transport: {
          createList: async () => {
            creates += 1
            throw new Error('gho_lifecycle_probe_secret')
          },
          deleteList: async () => {}
        },
        readCompleteCatalog: async () => []
      }),
      'fixture-invalid'
    )
    expect(creates).toBe(0)
    expect(error.message).not.toContain('gho_lifecycle_probe_secret')
  })
})

function catalogPage(nodes: readonly unknown[], hasNextPage: boolean, endCursor: string | null): Response {
  return new Response(JSON.stringify({
    data: {viewer: {lists: {nodes, pageInfo: {hasNextPage, endCursor}}}}
  }), {headers: {'content-type': 'application/json'}})
}

function catalogSequence(values: readonly NativeListCatalogObservation[]): {
  readonly read: OAuthListLifecycleProbeDependencies['readCompleteCatalog']
  readonly calls: () => number
} {
  let callCount = 0
  return {
    read: async () => {
      const value = values[callCount]
      callCount += 1
      if (!value) throw new Error('Missing catalog fixture.')
      return value
    },
    calls: () => callCount
  }
}

async function expectProbeFailure(
  promise: Promise<unknown>,
  code: OAuthListLifecycleProbeFailure['code']
): Promise<OAuthListLifecycleProbeFailure> {
  try {
    await promise
    throw new Error(`Expected ${code}`)
  } catch (error: unknown) {
    expect(error).toBeInstanceOf(OAuthListLifecycleProbeFailure)
    if (!(error instanceof OAuthListLifecycleProbeFailure)) throw error
    expect(error.code).toBe(code)
    return error
  }
}
