import {describe, expect, test} from 'bun:test'
import {IDBFactory} from 'fake-indexeddb'
import {BrowserWriteAuthStore} from '../../src/auth/write-store'
import type {AuthStore} from '../../src/auth/store'
import type {
  AuthStateRecord,
  GitHubUserId,
  WriteAuthStateRecord
} from '../../src/domain/types'
import {openLibraryDatabase} from '../../src/storage/database'

const timestamp = '2026-08-03T12:00:00Z'

describe('browser write authorization store', () => {
  test('uses the active read account for save and current lookup', async () => {
    const database = await openLibraryDatabase({
      name: 'write-store-current-test',
      factory: new IDBFactory()
    })
    const readStore = new MutableAuthStore(authStateFixture('42'))
    const store = new BrowserWriteAuthStore(database, readStore)
    const first = writeAuthStateFixture('42')

    await store.save(first)
    expect(await store.loadCurrent()).toEqual(first)
    expect(await store.loadAccount('42')).toEqual(first)

    await expect(store.save(writeAuthStateFixture('84'))).rejects.toThrow(
      'does not match the active account'
    )
    expect(await store.loadAccount('84')).toBeNull()

    readStore.state = authStateFixture('84')
    expect(await store.loadCurrent()).toBeNull()
    readStore.state = null
    expect(await store.loadCurrent()).toBeNull()
    await expect(store.save(first)).rejects.toThrow('does not match the active account')
    database.close()
  })

  test('deletes the current account, a named account, or all accounts independently', async () => {
    const database = await openLibraryDatabase({
      name: 'write-store-delete-test',
      factory: new IDBFactory()
    })
    const readStore = new MutableAuthStore(authStateFixture('42'))
    const store = new BrowserWriteAuthStore(database, readStore)
    const first = writeAuthStateFixture('42')
    const second = writeAuthStateFixture('84')

    await store.save(first)
    readStore.state = authStateFixture('84')
    await store.save(second)
    await store.deleteCurrent()
    expect(await store.loadAccount('42')).toEqual(first)
    expect(await store.loadAccount('84')).toBeNull()

    await store.deleteAccount('42')
    expect(await store.loadAccount('42')).toBeNull()

    await store.save(second)
    readStore.state = authStateFixture('42')
    await store.save(first)
    await store.clearAll()
    expect(await store.loadAccount('42')).toBeNull()
    expect(await store.loadAccount('84')).toBeNull()
    database.close()
  })
})

class MutableAuthStore implements AuthStore {
  state: AuthStateRecord | null

  constructor(state: AuthStateRecord | null) {
    this.state = state
  }

  loadActive(): Promise<AuthStateRecord | null> {
    return Promise.resolve(this.state)
  }

  hasRetainedData(): Promise<boolean> {
    return Promise.resolve(false)
  }

  saveActive(state: AuthStateRecord): Promise<void> {
    this.state = state
    return Promise.resolve()
  }

  replaceIfGeneration(
    _expectedGeneration: number,
    state: AuthStateRecord
  ): Promise<boolean> {
    this.state = state
    return Promise.resolve(true)
  }

  clearIfGeneration(
    githubUserId: GitHubUserId,
    _expectedGeneration: number
  ): Promise<boolean> {
    if (this.state?.githubUserId !== githubUserId) return Promise.resolve(false)
    this.state = null
    return Promise.resolve(true)
  }

  disconnect(): Promise<void> {
    this.state = null
    return Promise.resolve()
  }
}

function authStateFixture(githubUserId: GitHubUserId): AuthStateRecord {
  return {
    githubUserId,
    identity: {
      githubUserId,
      userNodeId: `U_${githubUserId}`,
      login: `user-${githubUserId}`,
      avatarUrl: `https://avatars.githubusercontent.com/u/${githubUserId}`
    },
    credentials: {
      accessToken: `read-access-${githubUserId}`,
      refreshToken: `refresh-${githubUserId}`,
      accessTokenExpiresAt: '2026-08-03T20:00:00Z',
      refreshTokenExpiresAt: '2027-02-03T12:00:00Z',
      generation: 1
    },
    authenticatedAt: timestamp,
    refreshedAt: timestamp
  }
}

function writeAuthStateFixture(githubUserId: GitHubUserId): WriteAuthStateRecord {
  return {
    githubUserId,
    identity: {
      githubUserId,
      userNodeId: `U_${githubUserId}`,
      login: `user-${githubUserId}`,
      avatarUrl: `https://avatars.githubusercontent.com/u/${githubUserId}`
    },
    credential: {
      accessToken: `write-access-${githubUserId}`,
      tokenType: 'bearer',
      grantedScopes: ['public_repo']
    },
    authorizedAt: timestamp,
    lastFailure: null
  }
}
