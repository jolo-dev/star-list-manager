import type {
  GitHubUserId,
  WriteAuthStateRecord
} from '../domain/types'
import {
  clearWriteAuthStates,
  deleteWriteAuthState,
  getWriteAuthState,
  putWriteAuthState
} from '../storage/library'
import type {AuthStore} from './store'

export interface WriteAuthStore {
  save(state: WriteAuthStateRecord): Promise<void>
  loadCurrent(): Promise<WriteAuthStateRecord | null>
  loadAccount(githubUserId: GitHubUserId): Promise<WriteAuthStateRecord | null>
  deleteCurrent(): Promise<void>
  deleteAccount(githubUserId: GitHubUserId): Promise<void>
  clearAll(): Promise<void>
}

export class BrowserWriteAuthStore implements WriteAuthStore {
  readonly #database: IDBDatabase
  readonly #readAuthStore: AuthStore

  constructor(database: IDBDatabase, readAuthStore: AuthStore) {
    this.#database = database
    this.#readAuthStore = readAuthStore
  }

  async save(state: WriteAuthStateRecord): Promise<void> {
    const active = await this.#readAuthStore.loadActive()
    if (
      !active ||
      active.githubUserId !== state.githubUserId ||
      active.githubUserId !== state.identity.githubUserId
    ) {
      throw new Error('Write authorization does not match the active account.')
    }
    await putWriteAuthState(this.#database, state)
  }

  async loadCurrent(): Promise<WriteAuthStateRecord | null> {
    const active = await this.#readAuthStore.loadActive()
    return active
      ? getWriteAuthState(this.#database, active.githubUserId)
      : null
  }

  loadAccount(githubUserId: GitHubUserId): Promise<WriteAuthStateRecord | null> {
    return getWriteAuthState(this.#database, githubUserId)
  }

  async deleteCurrent(): Promise<void> {
    const active = await this.#readAuthStore.loadActive()
    if (active) await deleteWriteAuthState(this.#database, active.githubUserId)
  }

  deleteAccount(githubUserId: GitHubUserId): Promise<void> {
    return deleteWriteAuthState(this.#database, githubUserId)
  }

  clearAll(): Promise<void> {
    return clearWriteAuthStates(this.#database)
  }
}
