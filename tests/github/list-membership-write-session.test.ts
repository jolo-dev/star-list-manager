import {describe, expect, test} from 'bun:test'
import type {WriteAuthStateRecord} from '../../src/domain/types'
import {
  ListMembershipMutationFailure,
  ListMembershipWriteSession,
  type ListMembershipMutationRequest,
  type ListMembershipWriteStore
} from '../../src/github/list-membership-write-session'
import {sanitizeError} from '../../src/shared/errors'

const token = 'gho_membership_write_secret'
const request: ListMembershipMutationRequest = {
  expectedGitHubUserId: '42',
  repositoryNodeId: 'R_fixture',
  completeListIds: ['L_alpha', 'L_beta']
}

describe('native List membership write session', () => {
  test('constructs only the static mutation and invokes native fetch without a receiver', async () => {
    const captured: Array<{readonly url: string; readonly init: RequestInit}> = []
    async function nativeFetch(
      this: unknown,
      input: RequestInfo | URL,
      init: RequestInit = {}
    ): Promise<Response> {
      expect(this).toBeUndefined()
      captured.push({url: String(input), init})
      return graphqlResponse({
        data: {
          updateUserListsForItem: {
            lists: [{id: 'L_beta'}, {id: 'L_alpha'}]
          }
        }
      })
    }
    const session = createSession({fetch: nativeFetch})

    expect(await session.updateMemberships(request)).toEqual({
      updatedListIds: ['L_alpha', 'L_beta']
    })
    expect(captured).toHaveLength(1)
    expect(captured[0]?.url).toBe('https://api.github.com/graphql')
    expect(captured[0]?.init.method).toBe('POST')
    const headers = new Headers(captured[0]?.init.headers)
    expect(headers.get('authorization')).toBe(`Bearer ${token}`)
    const body = JSON.parse(String(captured[0]?.init.body)) as Readonly<{
      query: string
      variables: Readonly<Record<string, unknown>>
    }>
    expect(body.query).toContain('mutation UpdateUserListsForItem')
    expect(body.query).toContain(
      'updateUserListsForItem(input: {itemId: $itemId, listIds: $listIds})'
    )
    expect(body.variables).toEqual({
      itemId: 'R_fixture',
      listIds: ['L_alpha', 'L_beta']
    })
    expect(Object.keys(body)).toEqual(['query', 'variables'])
  })

  test('rejects non-canonical IDs and arbitrary operation-shaped input before dispatch', async () => {
    let requests = 0
    const session = createSession({
      fetch: async () => {
        requests += 1
        return graphqlResponse({})
      }
    })

    await expectFailure(
      session.updateMemberships({...request, completeListIds: ['L_beta', 'L_alpha']}),
      'invalid-request'
    )
    await expectFailure(
      session.updateMemberships({...request, completeListIds: ['L_alpha', 'L_alpha']}),
      'invalid-request'
    )
    const arbitrary = {
      ...request,
      url: 'https://example.invalid',
      document: 'mutation Arbitrary { deleteUserList }',
      operation: 'Arbitrary',
      variables: {secret: token}
    }
    await expectFailure(session.updateMemberships(arbitrary), 'invalid-request')
    expect(requests).toBe(0)
  })

  test('requires the active owner and the same account-bound user credential', async () => {
    const cases: ReadonlyArray<{
      readonly activeUserId: string | null
      readonly activeIdentityUserId?: string
      readonly state: WriteAuthStateRecord | null
      readonly reason: ListMembershipMutationFailure['reason']
    }> = [
      {activeUserId: '84', state: writeState('42'), reason: 'account-changed'},
      {
        activeUserId: '42',
        activeIdentityUserId: '84',
        state: writeState('42'),
        reason: 'account-changed'
      },
      {activeUserId: '42', state: null, reason: 'authorization-required'},
      {
        activeUserId: '42',
        state: {...writeState('84'), githubUserId: '42'},
        reason: 'authorization-mismatch'
      },
      {
        activeUserId: '42',
        state: {
          ...writeState('42'),
          credential: {
            ...writeState('42').credential,
            grantedScopes: ['public_repo']
          }
        },
        reason: 'scope-denied'
      }
    ]

    for (const item of cases) {
      let dispatched = false
      const session = createSession({
        activeUserId: item.activeUserId,
        ...(item.activeIdentityUserId === undefined
          ? {}
          : {activeIdentityUserId: item.activeIdentityUserId}),
        state: item.state,
        fetch: async () => {
          dispatched = true
          return graphqlResponse({})
        }
      })
      await expectFailure(session.updateMemberships(request), item.reason)
      expect(dispatched).toBe(false)
    }
  })

  test('maps GraphQL schema, permission, invalid-ID, rate-limit, and server errors', async () => {
    const cases = [
      {
        error: {type: 'GRAPHQL_VALIDATION_FAILED', message: 'field does not exist'},
        reason: 'schema-unavailable'
      },
      {error: {type: 'FORBIDDEN'}, reason: 'permission'},
      {error: {type: 'NOT_FOUND'}, reason: 'invalid-identifiers'},
      {error: {type: 'RATE_LIMITED'}, reason: 'rate-limit'},
      {error: {type: 'INTERNAL'}, reason: 'server'}
    ] as const

    for (const item of cases) {
      const session = createSession({
        fetch: async () => graphqlResponse({errors: [item.error]})
      })
      const error = await expectFailure(
        session.updateMemberships(request),
        item.reason
      )
      expect(JSON.stringify(sanitizeError(error))).not.toContain(token)
    }
  })

  test('maps HTTP, network ambiguity, and malformed payloads to sanitized typed failures', async () => {
    const store = new MemoryWriteStore(writeState('42'))
    const cases: ReadonlyArray<{
      readonly response: Response | Error
      readonly reason: ListMembershipMutationFailure['reason']
    }> = [
      {response: new Response(token, {status: 401}), reason: 'credential-rejected'},
      {response: new Response(token, {status: 403}), reason: 'permission'},
      {response: new Response(token, {status: 400}), reason: 'schema-unavailable'},
      {response: new Response(token, {status: 422}), reason: 'invalid-identifiers'},
      {
        response: new Response(token, {
          status: 429,
          headers: {'x-ratelimit-reset': '1786219200'}
        }),
        reason: 'rate-limit'
      },
      {response: new Response(token, {status: 503}), reason: 'server'},
      {response: new Error(token), reason: 'network-ambiguous'},
      {response: new Response(token), reason: 'malformed-response'},
      {
        response: graphqlResponse({data: {updateUserListsForItem: {lists: null}}}),
        reason: 'malformed-response'
      }
    ]

    for (const item of cases) {
      const session = createSession({
        store,
        fetch: async () => {
          if (item.response instanceof Error) throw item.response
          return item.response.clone()
        }
      })
      const error = await expectFailure(
        session.updateMemberships(request),
        item.reason
      )
      expect(JSON.stringify(sanitizeError(error))).not.toContain(token)
      if (item.reason === 'credential-rejected') {
        expect(store.deletedAccounts).toContain('42')
        store.state = writeState('42')
      }
    }
  })
})

function createSession(
  options: {
    readonly activeUserId?: string | null
    readonly activeIdentityUserId?: string
    readonly state?: WriteAuthStateRecord | null
    readonly store?: MemoryWriteStore
    readonly fetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
  }
): ListMembershipWriteSession {
  const activeUserId = options.activeUserId === undefined ? '42' : options.activeUserId
  return new ListMembershipWriteSession({
    authStore: {
      loadActive: () =>
        Promise.resolve(
          activeUserId
            ? {
                githubUserId: activeUserId,
                identity: {
                  githubUserId: options.activeIdentityUserId ?? activeUserId
                }
              }
            : null
        )
    },
    writeStore:
      options.store ??
      new MemoryWriteStore(options.state === undefined ? writeState('42') : options.state),
    fetch: options.fetch
  })
}

class MemoryWriteStore implements ListMembershipWriteStore {
  state: WriteAuthStateRecord | null
  readonly deletedAccounts: string[] = []

  constructor(state: WriteAuthStateRecord | null) {
    this.state = state
  }

  loadAccount(): Promise<WriteAuthStateRecord | null> {
    return Promise.resolve(this.state)
  }

  deleteAccount(githubUserId: string): Promise<void> {
    this.deletedAccounts.push(githubUserId)
    this.state = null
    return Promise.resolve()
  }
}

function writeState(githubUserId: string): WriteAuthStateRecord {
  return {
    githubUserId,
    identity: {
      githubUserId,
      userNodeId: `U_${githubUserId}`,
      login: `user-${githubUserId}`,
      avatarUrl: `https://avatars.githubusercontent.com/u/${githubUserId}`
    },
    credential: {
      accessToken: token,
      tokenType: 'bearer',
      grantedScopes: ['public_repo', 'user']
    },
    authorizedAt: '2026-08-08T12:00:00Z',
    lastFailure: null
  }
}

function graphqlResponse(value: unknown): Response {
  return Response.json(value)
}

async function expectFailure(
  promise: Promise<unknown>,
  reason: ListMembershipMutationFailure['reason']
): Promise<ListMembershipMutationFailure> {
  try {
    await promise
    throw new Error(`Expected ${reason}`)
  } catch (error: unknown) {
    expect(error).toBeInstanceOf(ListMembershipMutationFailure)
    if (!(error instanceof ListMembershipMutationFailure)) throw error
    expect(error.reason).toBe(reason)
    return error
  }
}
