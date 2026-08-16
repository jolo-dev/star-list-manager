import {describe, expect, test} from 'bun:test'
import type {WriteAuthStateRecord} from '../../src/domain/types'
import {
  ListLifecycleMutationFailure,
  ListLifecycleWriteSession
} from '../../src/github/list-lifecycle-write-session'
import {sanitizeError} from '../../src/shared/errors'

const token = 'gho_lifecycle_write_secret'

describe('native List lifecycle write session', () => {
  test('constructs only static create and delete documents with validated inputs', async () => {
    const requests: RequestInit[] = []
    const session = sessionFor(async (_input, init = {}) => {
      requests.push(init)
      const body = JSON.parse(String(init.body)) as {query: string; variables: Record<string, unknown>}
      return new Response(JSON.stringify(body.query.includes('CreateUserList')
        ? {data: {createUserList: {list: {id: 'UL_created', name: 'Ideas', isPrivate: true}}}}
        : {data: {deleteUserList: {clientMutationId: null}}}
      ))
    })

    await expect(session.createList({expectedGitHubUserId: '42', name: '  Ideas  ', visibility: 'private'})).resolves.toEqual({listNodeId: 'UL_created', name: 'Ideas', visibility: 'private'})
    await expect(session.deleteList({expectedGitHubUserId: '42', listNodeId: 'UL_created'})).resolves.toEqual(undefined)
    expect(requests).toHaveLength(2)
    const create = JSON.parse(String(requests[0]?.body)) as {query: string; variables: unknown}
    const remove = JSON.parse(String(requests[1]?.body)) as {query: string; variables: unknown}
    expect(create.query).toContain('mutation CreateUserList')
    expect(create.variables).toEqual({name: 'Ideas', isPrivate: true})
    expect(remove.query).toContain('mutation DeleteUserList')
    expect(remove.variables).toEqual({listId: 'UL_created'})
  })

  test('rejects blank names, arbitrary fields, missing user scope, and account changes before dispatch', async () => {
    let requests = 0
    const fetch = async (): Promise<Response> => {
      requests += 1
      return new Response('{}')
    }
    await expectFailure(sessionFor(fetch).createList({expectedGitHubUserId: '42', name: '  ', visibility: 'public'}), 'invalid-request')
    await expectFailure(sessionFor(fetch).createList({expectedGitHubUserId: '42', name: 'Ideas', visibility: 'public', document: 'mutation evil'} as never), 'invalid-request')
    await expectFailure(sessionFor(fetch, {scopes: ['public_repo']}).deleteList({expectedGitHubUserId: '42', listNodeId: 'UL_one'}), 'scope-denied')
    await expectFailure(sessionFor(fetch, {activeUserId: '84'}).deleteList({expectedGitHubUserId: '42', listNodeId: 'UL_one'}), 'account-changed')
    expect(requests).toBe(0)
  })

  test('sanitizes ambiguous and rejected remote failures without retaining token material', async () => {
    for (const fetch of [
      async () => { throw new Error(token) },
      async () => new Response(token, {status: 401}),
      async () => new Response(JSON.stringify({errors: [{type: 'FORBIDDEN', message: token}]}))
    ]) {
      const error = await expectFailure(sessionFor(fetch).deleteList({expectedGitHubUserId: '42', listNodeId: 'UL_one'}))
      expect(JSON.stringify(sanitizeError(error))).not.toContain(token)
    }
  })
})

function sessionFor(
  fetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>,
  options: {activeUserId?: string; scopes?: readonly string[]} = {}
): ListLifecycleWriteSession {
  const activeUserId = options.activeUserId ?? '42'
  return new ListLifecycleWriteSession({
    authStore: {loadActive: async () => ({githubUserId: activeUserId, identity: {githubUserId: activeUserId}})},
    writeStore: {
      loadAccount: async () => writeState(options.scopes ?? ['public_repo', 'user']),
      deleteAccount: async () => undefined
    },
    fetch
  })
}

function writeState(grantedScopes: readonly string[]): WriteAuthStateRecord {
  return {githubUserId: '42', identity: {githubUserId: '42', userNodeId: 'U_42', login: 'octocat', avatarUrl: 'https://example.test/avatar'}, credential: {accessToken: token, tokenType: 'bearer', grantedScopes}, authorizedAt: '2026-08-12T00:00:00.000Z', lastFailure: null}
}

async function expectFailure<T>(promise: Promise<T>, reason?: ListLifecycleMutationFailure['reason']): Promise<ListLifecycleMutationFailure> {
  try { await promise } catch (error: unknown) {
    expect(error).toBeInstanceOf(ListLifecycleMutationFailure)
    const failure = error as ListLifecycleMutationFailure
    if (reason) expect(failure.reason).toBe(reason)
    return failure
  }
  throw new Error('Expected lifecycle request to fail.')
}
