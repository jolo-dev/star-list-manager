import type {AuthStateRecord, GitHubUserId} from '../domain/types'
import {
  readLocalStorage,
  removeLocalStorage,
  writeLocalStorage
} from '../platform/browser'
import {
  deleteAuthState,
  deleteAuthStateIfGeneration,
  getAuthState,
  hasRetainedLibraryData,
  putAuthState,
  replaceAuthStateIfGeneration
} from '../storage/library'

const activeAccountKey = 'activeGitHubUserId'

export interface AuthStore {
  loadActive(): Promise<AuthStateRecord | null>
  hasRetainedData(): Promise<boolean>
  saveActive(state: AuthStateRecord): Promise<void>
  replaceIfGeneration(
    expectedGeneration: number,
    state: AuthStateRecord
  ): Promise<boolean>
  clearIfGeneration(
    githubUserId: GitHubUserId,
    expectedGeneration: number
  ): Promise<boolean>
  disconnect(): Promise<void>
}

export class BrowserAuthStore implements AuthStore {
  readonly #database: IDBDatabase

  constructor(database: IDBDatabase) {
    this.#database = database
  }

  async loadActive(): Promise<AuthStateRecord | null> {
    const values = await readLocalStorage(activeAccountKey)
    const githubUserId = values[activeAccountKey]
    return typeof githubUserId === 'string'
      ? getAuthState(this.#database, githubUserId)
      : null
  }

  hasRetainedData(): Promise<boolean> {
    return hasRetainedLibraryData(this.#database)
  }

  async saveActive(state: AuthStateRecord): Promise<void> {
    const current = await this.loadActive()
    if (current && current.githubUserId !== state.githubUserId) {
      await deleteAuthState(this.#database, current.githubUserId)
    }
    await putAuthState(this.#database, state)
    await writeLocalStorage({[activeAccountKey]: state.githubUserId})
  }

  replaceIfGeneration(
    expectedGeneration: number,
    state: AuthStateRecord
  ): Promise<boolean> {
    return replaceAuthStateIfGeneration(this.#database, expectedGeneration, state)
  }

  async clearIfGeneration(
    githubUserId: GitHubUserId,
    expectedGeneration: number
  ): Promise<boolean> {
    const removed = await deleteAuthStateIfGeneration(
      this.#database,
      githubUserId,
      expectedGeneration
    )
    if (!removed) return false

    const values = await readLocalStorage(activeAccountKey)
    if (values[activeAccountKey] === githubUserId) {
      await removeLocalStorage(activeAccountKey)
    }
    return true
  }

  async disconnect(): Promise<void> {
    const active = await this.loadActive()
    if (active) await deleteAuthState(this.#database, active.githubUserId)
    await removeLocalStorage(activeAccountKey)
  }
}
