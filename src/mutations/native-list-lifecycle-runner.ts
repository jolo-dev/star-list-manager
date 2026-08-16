import type {NativeListLifecycleOperationRecord, NativeListRecord, SanitizedMutationError} from '../domain/types'
import type {CreatedNativeList, ListLifecycleWriteSession} from '../github/list-lifecycle-write-session'
import {sanitizeError} from '../shared/errors'
import {
  getActiveNativeListLifecycleOperation,
  listNativeListLifecycleOperations,
  putNativeListLifecycleOperation
} from '../storage/library'

export interface NativeListLifecycleRunnerOptions {
  readonly database: IDBDatabase
  readonly writer: Pick<ListLifecycleWriteSession, 'createList' | 'deleteList'>
  readonly synchronize: (githubUserId: string) => Promise<{readonly phase: string}>
  readonly listCatalog: (githubUserId: string) => Promise<readonly NativeListRecord[]>
  readonly now: () => string
}

/**
 * Executes the durable singleton journal. Ambiguous remote requests become a
 * terminal blocked-unknown record; they are intentionally never replayed.
 */
export class NativeListLifecycleRunner {
  readonly #database: IDBDatabase
  readonly #writer: NativeListLifecycleRunnerOptions['writer']
  readonly #synchronize: NativeListLifecycleRunnerOptions['synchronize']
  readonly #listCatalog: NativeListLifecycleRunnerOptions['listCatalog']
  readonly #now: () => string

  constructor(options: NativeListLifecycleRunnerOptions) {
    this.#database = options.database
    this.#writer = options.writer
    this.#synchronize = options.synchronize
    this.#listCatalog = options.listCatalog
    this.#now = options.now
  }

  async operation(githubUserId: string): Promise<NativeListLifecycleOperationRecord | null> {
    const operations = await listNativeListLifecycleOperations(this.#database, githubUserId)
    return operations.toSorted((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0] ?? null
  }

  async run(githubUserId: string): Promise<void> {
    const operation = await getActiveNativeListLifecycleOperation(this.#database, githubUserId)
    if (!operation) return
    if (operation.phase === 'queued' || operation.phase === 'preflight') {
      await this.#preflight(operation)
      return
    }
    // A service-worker restart after a request left in-flight is ambiguous.
    await this.#blocked(operation, 'The native List request outcome is unknown. Refresh GitHub before trying again.')
  }

  async #preflight(operation: NativeListLifecycleOperationRecord): Promise<void> {
    let catalog: readonly NativeListRecord[]
    try {
      catalog = await this.#freshCatalog(operation.githubUserId)
    } catch (error: unknown) {
      await this.#failed(
        operation,
        'GitHub did not provide a fresh native List catalog. Refresh and confirm again before deletion.',
        error
      )
      return
    }
    if (operation.intent.kind === 'delete') {
      const intent = operation.intent
      const current = catalog.find((list) => list.listNodeId === intent.listNodeId)
      if (!current) {
        await this.#complete(operation, 'already-deleted')
        return
      }
      if (fingerprint(current) !== operation.confirmationFingerprint) {
        await this.#complete(operation, 'needs-confirmation')
        return
      }
    }
    const mutating = await this.#save(operation, {phase: 'mutating', attemptCount: operation.attemptCount + 1})
    try {
      if (mutating.intent.kind === 'create') {
        const created = await this.#writer.createList({
          expectedGitHubUserId: mutating.githubUserId,
          name: mutating.intent.name,
          visibility: mutating.intent.visibility
        })
        await this.#verifyCreate(mutating, created)
      } else {
        await this.#writer.deleteList({
          expectedGitHubUserId: mutating.githubUserId,
          listNodeId: mutating.intent.listNodeId
        })
        await this.#verifyDelete(mutating)
      }
    } catch (error: unknown) {
      // Neither create nor delete is safely idempotent from this client.
      await this.#blocked(mutating, 'The native List request may have completed, but GitHub did not return a verifiable result.', error)
    }
  }

  async #freshCatalog(githubUserId: string): Promise<readonly NativeListRecord[]> {
    const state = await this.#synchronize(githubUserId)
    if (state.phase !== 'complete' && state.phase !== 'partial') {
      throw new Error('Native List catalog synchronization did not complete.')
    }
    return this.#listCatalog(githubUserId)
  }

  async #verifyCreate(operation: NativeListLifecycleOperationRecord, created: CreatedNativeList): Promise<void> {
    const verifying = await this.#save(operation, {phase: 'verifying', candidateListNodeId: created.listNodeId})
    const current = await this.#freshCatalog(verifying.githubUserId)
    const result = current.find((list) => list.listNodeId === created.listNodeId)
    if (result && result.name === created.name && result.visibility === created.visibility) {
      await this.#complete(verifying, 'succeeded')
      return
    }
    await this.#blocked(verifying, 'GitHub did not verify the created native List by its stable ID.')
  }

  async #verifyDelete(operation: NativeListLifecycleOperationRecord): Promise<void> {
    const verifying = await this.#save(operation, {phase: 'verifying'})
    const current = await this.#freshCatalog(verifying.githubUserId)
    const intent = verifying.intent
    if (intent.kind !== 'delete') throw new Error('Delete verification requires a delete intent.')
    if (!current.some((list) => list.listNodeId === intent.listNodeId)) {
      await this.#complete(verifying, 'succeeded')
      return
    }
    await this.#blocked(verifying, 'GitHub did not verify removal of the native List by its stable ID.')
  }

  async #complete(operation: NativeListLifecycleOperationRecord, phase: 'succeeded' | 'already-deleted' | 'needs-confirmation'): Promise<void> {
    await this.#save(operation, {phase, completedAt: phase === 'needs-confirmation' ? null : this.#now()})
  }

  async #failed(operation: NativeListLifecycleOperationRecord, message: string, error?: unknown): Promise<void> {
    const safe = error ? lifecycleError(error, this.#now()) : lifecycleError({message}, this.#now())
    await this.#save(operation, {phase: 'failed', lastError: safe, completedAt: this.#now()})
  }

  async #blocked(operation: NativeListLifecycleOperationRecord, message: string, error?: unknown): Promise<void> {
    const safe = error ? lifecycleError(error, this.#now()) : lifecycleError({message}, this.#now())
    await this.#save(operation, {phase: 'blocked-unknown', lastError: safe, completedAt: this.#now()})
  }

  async #save(operation: NativeListLifecycleOperationRecord, changes: Partial<NativeListLifecycleOperationRecord>): Promise<NativeListLifecycleOperationRecord> {
    const next = {...operation, ...changes, updatedAt: this.#now()} as NativeListLifecycleOperationRecord
    await putNativeListLifecycleOperation(this.#database, next)
    return next
  }
}

export function nativeListCatalogFingerprint(list: NativeListRecord): string { return fingerprint(list) }
function fingerprint(list: NativeListRecord): string {
  return JSON.stringify([list.listNodeId, list.name, list.visibility, list.reportedItemCount, list.importStatus])
}
function lifecycleError(error: unknown, occurredAt: string): SanitizedMutationError {
  const safe = sanitizeError(error)
  return {category: safe.category === 'storage' || safe.category === 'unsupported' ? 'unknown' : safe.category, message: safe.message, statusCode: safe.status ?? null, occurredAt}
}
