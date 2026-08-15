import {describe, expect, test} from 'bun:test'
import type {WriteAuthStateRecord} from '../../src/domain/types'
import {
  ListRenameMutationFailure,
  ListRenameWriteSession,
  type ListRenameMutationRequest,
  type ListRenameWriteStore
} from '../../src/github/list-rename-write-session'
import {sanitizeError} from '../../src/shared/errors'

const token = 'gho_list_rename_secret'
const request: ListRenameMutationRequest = {
  expectedGitHubUserId: '42',
  listNodeId: 'L_fixture',
  name: '  Ｔools  '
}

describe('native List rename write session', () => {
  test('sends only the static updateUserList document with canonical listId and name variables', async () => {
    const captured: Array<{readonly url: string; readonly init: RequestInit}> = []
    async function nativeFetch(
      this: unknown,
      input: RequestInfo | URL,
      init: RequestInit = {}
    ): Promise<Response> {
      expect(this).toBeUndefined()
      captured.push({url: String(input), init})
      return graphqlResponse({
        data: {updateUserList: {list: {id: 'L_fixture', name: 'Tools'}}}
      })
    }
    const session = createSession({fetch: nativeFetch})

    expect(await session.rename(request)).toEqual({listNodeId: 'L_fixture', name: 'Tools'})
    expect(captured).toHaveLength(1)
    expect(captured[0]?.url).toBe('https://api.github.com/graphql')
    expect(captured[0]?.init.method).toBe('POST')
    const headers = new Headers(captured[0]?.init.headers)
    expect(headers.get('authorization')).toBe(`Bearer ${token}`)
    expect(headers.get('x-github-api-version')).toBe('2026-03-10')
    const body = JSON.parse(String(captured[0]?.init.body)) as Readonly<{
      query: string
      variables: Readonly<Record<string, unknown>>
    }>
    expect(body.query).toContain('mutation UpdateUserList')
    expect(body.query).toContain('updateUserList(input: {listId: $listId, name: $name})')
    expect(body.query).toContain('list { id name }')
    expect(body.variables).toEqual({listId: 'L_fixture', name: 'Tools'})
    expect(Object.keys(body)).toEqual(['query', 'variables'])
  })

  test('rejects non-identifier IDs, empty canonical names, and arbitrary operation-shaped input before dispatch', async () => {
    let requests = 0
    const session = createSession({
      fetch: async () => {
        requests += 1
        return graphqlResponse({})
      }
    })

    for (const invalid of [
      {...request, expectedGitHubUserId: ' 42'},
      {...request, listNodeId: ' '},
      {...request, name: ' \t\n '},
      {
        ...request,
        url: 'https://example.invalid',
        document: 'mutation Arbitrary { deleteUserList }',
        operation: 'Arbitrary',
        variables: {secret: token}
      }
    ]) {
      await expectFailure(session.rename(invalid), 'invalid-request')
    }
    expect(requests).toBe(0)
  })

  test('requires the active owner and an account-bound user credential before dispatch', async () => {
    const cases: ReadonlyArray<{
      readonly activeUserId: string | null
      readonly activeIdentityUserId?: string
      readonly state: WriteAuthStateRecord | null
      readonly reason: ListRenameMutationFailure['reason']
    }> = [
      {activeUserId: null, state: writeState('42'), reason: 'account-changed'},
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
          credential: {...writeState('42').credential, grantedScopes: ['public_repo']}
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
      await expectFailure(session.rename(request), item.reason)
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
      const error = await expectFailure(
        createSession({fetch: async () => graphqlResponse({errors: [item.error]})}).rename(
          request
        ),
        item.reason
      )
      expect(JSON.stringify(sanitizeError(error))).not.toContain(token)
    }
  })

  test('deletes a 401-rejected credential and maps HTTP, network, and malformed responses safely', async () => {
    const store = new MemoryWriteStore(writeState('42'))
    const cases: ReadonlyArray<{
      readonly response: Response | Error
      readonly reason: ListRenameMutationFailure['reason']
    }> = [
      {response: new Response(token, {status: 401}), reason: 'credential-rejected'},
      {response: new Response(token, {status: 403}), reason: 'permission'},
      {response: new Response(token, {status: 400}), reason: 'schema-unavailable'},
      {response: new Response(token, {status: 429}), reason: 'rate-limit'},
      {response: new Response(token, {status: 503}), reason: 'server'},
      {response: new Error(token), reason: 'network-ambiguous'},
      {response: new Response(token), reason: 'malformed-response'},
      {
        response: graphqlResponse({data: {updateUserList: {list: {id: ' ', name: 'Tools'}}}}),
        reason: 'malformed-response'
      },
      {
        response: graphqlResponse({data: {updateUserList: {list: {id: 'L_fixture', name: ''}}}}),
        reason: 'malformed-response'
      }
    ]

    for (const item of cases) {
      const error = await expectFailure(
        createSession({
          store,
          fetch: async () => {
            if (item.response instanceof Error) throw item.response
            return item.response.clone()
          }
        }).rename(request),
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

function createSession(options: {
  readonly activeUserId?: string | null
  readonly activeIdentityUserId?: string
  readonly state?: WriteAuthStateRecord | null
  readonly store?: MemoryWriteStore
  readonly fetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
}): ListRenameWriteSession {
  const activeUserId = options.activeUserId === undefined ? '42' : options.activeUserId
  return new ListRenameWriteSession({
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

class MemoryWriteStore implements ListRenameWriteStore {
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
  reason: ListRenameMutationFailure['reason']
): Promise<ListRenameMutationFailure> {
  try {
    await promise
    throw new Error(`Expected ${reason}`)
  } catch (error: unknown) {
    expect(error).toBeInstanceOf(ListRenameMutationFailure)
    if (!(error instanceof ListRenameMutationFailure)) throw error
    expect(error.reason).toBe(reason)
    return error
  }
}
