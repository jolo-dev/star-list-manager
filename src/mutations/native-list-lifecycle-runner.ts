import type {NativeListLifecycleOperationRecord, NativeListRecord, SanitizedMutationError} from '../domain/types'
import type {CreatedNativeList, ListLifecycleWriteSession} from '../github/list-lifecycle-write-session'
import {sanitizeError} from '../shared/errors'
import type {NativeListCatalogObservation} from '../sync/native-list-sync'
import {
  getActiveNativeListLifecycleOperation,
  listNativeListLifecycleOperations,
  putNativeListLifecycleOperation
} from '../storage/library'
import {invalidateMembershipJobsForDeletedList} from '../storage/mutations'
import {NativeListMutationLock} from './native-list-mutation-lock'

export interface NativeListLifecycleOwner {
  loadActive(): Promise<{
    readonly githubUserId: string
    readonly identity: {readonly githubUserId: string}
  } | null>
}

export interface NativeListLifecycleRunnerOptions {
  readonly database: IDBDatabase
  readonly owner: NativeListLifecycleOwner
  readonly lock: NativeListMutationLock
  readonly writer: Pick<ListLifecycleWriteSession, 'createList' | 'deleteList'>
  /** Complete catalog-only observation: it must not import repository items. */
  readonly observeCatalog: (
    githubUserId: string,
    targetListNodeIds: readonly string[]
  ) => Promise<NativeListCatalogObservation>
  /** Normal reconciliation, used only after a catalog observation verifies an outcome. */
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
  readonly #owner: NativeListLifecycleRunnerOptions['owner']
  readonly #lock: NativeListMutationLock
  readonly #writer: NativeListLifecycleRunnerOptions['writer']
  readonly #observeCatalog: NativeListLifecycleRunnerOptions['observeCatalog']
  readonly #synchronize: NativeListLifecycleRunnerOptions['synchronize']
  readonly #listCatalog: NativeListLifecycleRunnerOptions['listCatalog']
  readonly #now: () => string

  constructor(options: NativeListLifecycleRunnerOptions) {
    this.#database = options.database
    this.#owner = options.owner
    this.#lock = options.lock
    this.#writer = options.writer
    this.#observeCatalog = options.observeCatalog
    this.#synchronize = options.synchronize
    this.#listCatalog = options.listCatalog
    this.#now = options.now
  }

  async operation(githubUserId: string): Promise<NativeListLifecycleOperationRecord | null> {
    const operations = await listNativeListLifecycleOperations(this.#database, githubUserId)
    return operations.toSorted((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0] ?? null
  }

  run(githubUserId: string): Promise<void> {
    return this.#lock.run(() => this.#run(githubUserId))
  }

  async #run(githubUserId: string): Promise<void> {
    const operation = await getActiveNativeListLifecycleOperation(this.#database, githubUserId)
    if (!operation || !(await this.#ownerStillActive(operation.githubUserId))) return
    if (operation.phase === 'queued' || operation.phase === 'preflight') {
      await this.#preflight(operation)
      return
    }
    // A restart must observe first, never blindly replay the persisted request.
    await this.#recoverInterrupted(operation)
  }

  async #preflight(operation: NativeListLifecycleOperationRecord): Promise<void> {
    const intent = operation.intent
    if (intent.kind === 'delete') {
      const observation = await this.#catalogOrFail(operation, [intent.listNodeId])
      if (!observation) return
      if (!(await this.#ownerStillActive(operation.githubUserId))) return
      const current = observation.targets.get(intent.listNodeId) ?? null
      if (!current) {
        const reconciled = await this.#reconcile(operation)
        if (reconciled === null) return
        if (!reconciled.some((list) => list.listNodeId === intent.listNodeId)) {
          await this.#invalidateMembershipWork(operation, intent.listNodeId)
          await this.#complete(operation, 'already-deleted')
        } else {
          await this.#blocked(operation, 'GitHub did not verify removal of the native List after reconciliation.')
        }
        return
      }
      const local = (await this.#listCatalog(operation.githubUserId)).find(
        (list) => list.listNodeId === intent.listNodeId
      )
      if (deleteFingerprint(current, local?.importStatus ?? 'partial') !== operation.confirmationFingerprint) {
        await this.#complete(operation, 'needs-confirmation')
        return
      }
    }
    if (!(await this.#ownerStillActive(operation.githubUserId))) return
    const mutating = await this.#save(operation, {phase: 'mutating', attemptCount: operation.attemptCount + 1})
    try {
      if (mutating.intent.kind === 'create') {
        const created = await this.#writer.createList({
          expectedGitHubUserId: mutating.githubUserId,
          name: mutating.intent.name,
          visibility: mutating.intent.visibility
        })
        if (!(await this.#ownerStillActive(mutating.githubUserId))) return
        await this.#verifyCreate(mutating, created)
      } else {
        await this.#writer.deleteList({
          expectedGitHubUserId: mutating.githubUserId,
          listNodeId: mutating.intent.listNodeId
        })
        if (!(await this.#ownerStillActive(mutating.githubUserId))) return
        await this.#verifyDelete(mutating)
      }
    } catch (error: unknown) {
      // A transport failure after dispatch may be ambiguous; never replay it.
      await this.#blocked(mutating, 'The native List request may have completed, but GitHub did not return a verifiable result.', error)
    }
  }

  async #verifyCreate(operation: NativeListLifecycleOperationRecord, created: CreatedNativeList): Promise<void> {
    const verifying = await this.#save(operation, {phase: 'verifying', candidateListNodeId: created.listNodeId})
    const observation = await this.#catalogOrBlocked(verifying, [created.listNodeId])
    if (!observation) return
    if (!(await this.#ownerStillActive(verifying.githubUserId))) {
      await this.#accountSuspended(verifying)
      return
    }
    const result = observation.targets.get(created.listNodeId) ?? null
    if (result && result.name === created.name && (result.isPrivate ? 'private' : 'public') === created.visibility) {
      const reconciled = await this.#reconcile(verifying)
      if (reconciled === null) return
      if (reconciled.some((list) => list.listNodeId === created.listNodeId && list.name === created.name && list.visibility === created.visibility)) {
        await this.#complete(verifying, 'succeeded')
      } else {
        await this.#blocked(verifying, 'GitHub did not verify the created native List after reconciliation.')
      }
      return
    }
    await this.#blocked(verifying, 'GitHub did not verify the created native List by its stable ID.')
  }

  async #verifyDelete(operation: NativeListLifecycleOperationRecord): Promise<void> {
    const verifying = await this.#save(operation, {phase: 'verifying'})
    const intent = verifying.intent
    if (intent.kind !== 'delete') throw new Error('Delete verification requires a delete intent.')
    const observation = await this.#catalogOrBlocked(verifying, [intent.listNodeId])
    if (!observation) return
    if (!(await this.#ownerStillActive(verifying.githubUserId))) {
      await this.#accountSuspended(verifying)
      return
    }
    if ((observation.targets.get(intent.listNodeId) ?? null) === null) {
      const reconciled = await this.#reconcile(verifying)
      if (reconciled === null) return
      if (!reconciled.some((list) => list.listNodeId === intent.listNodeId)) {
        await this.#invalidateMembershipWork(verifying, intent.listNodeId)
        await this.#complete(verifying, 'succeeded')
      } else {
        await this.#blocked(verifying, 'GitHub did not verify removal of the native List after reconciliation.')
      }
      return
    }
    await this.#blocked(verifying, 'GitHub did not verify removal of the native List by its stable ID.')
  }

  async #recoverInterrupted(operation: NativeListLifecycleOperationRecord): Promise<void> {
    const intent = operation.intent
    const target = intent.kind === 'delete'
      ? intent.listNodeId
      : operation.candidateListNodeId
    if (!target) {
      await this.#blocked(operation, 'The native List request outcome is unknown. Refresh GitHub before trying again.')
      return
    }
    const observation = await this.#catalogOrBlocked(operation, [target])
    if (!observation) return
    if (!(await this.#ownerStillActive(operation.githubUserId))) {
      await this.#accountSuspended(operation)
      return
    }
    const found = observation.targets.get(target) ?? null
    if (intent.kind === 'delete' && !found) {
      const reconciled = await this.#reconcile(operation)
      if (reconciled === null) return
      if (!reconciled.some((list) => list.listNodeId === intent.listNodeId)) {
        await this.#invalidateMembershipWork(operation, intent.listNodeId)
        await this.#complete(operation, 'succeeded')
      } else {
        await this.#blocked(operation, 'GitHub did not verify removal of the native List after reconciliation.')
      }
      return
    }
    if (intent.kind === 'create' && found && found.name === intent.name && (found.isPrivate ? 'private' : 'public') === intent.visibility) {
      const reconciled = await this.#reconcile(operation)
      if (reconciled === null) return
      if (reconciled.some((list) => list.listNodeId === target && list.name === intent.name && list.visibility === intent.visibility)) {
        await this.#complete(operation, 'succeeded')
      } else {
        await this.#blocked(operation, 'GitHub did not verify the created native List after reconciliation.')
      }
      return
    }
    await this.#blocked(operation, 'The native List request outcome is unknown. Refresh GitHub before trying again.')
  }

  async #catalogOrFail(operation: NativeListLifecycleOperationRecord, targets: readonly string[]): Promise<NativeListCatalogObservation | null> {
    try {
      return await this.#observeCatalog(operation.githubUserId, targets)
    } catch (error: unknown) {
      await this.#failed(operation, 'GitHub did not provide a fresh native List catalog. Refresh and confirm again before deletion.', error)
      return null
    }
  }

  async #catalogOrBlocked(operation: NativeListLifecycleOperationRecord, targets: readonly string[]): Promise<NativeListCatalogObservation | null> {
    try {
      return await this.#observeCatalog(operation.githubUserId, targets)
    } catch (error: unknown) {
      await this.#blocked(operation, 'GitHub did not provide a complete native List catalog for verification.', error)
      return null
    }
  }

  async #reconcile(operation: NativeListLifecycleOperationRecord): Promise<readonly NativeListRecord[] | null> {
    if (!(await this.#ownerStillActive(operation.githubUserId))) {
      await this.#accountSuspended(operation)
      return null
    }
    try {
      const state = await this.#synchronize(operation.githubUserId)
      if (!(await this.#ownerStillActive(operation.githubUserId))) {
        await this.#accountSuspended(operation)
        return null
      }
      if (state.phase === 'complete' || state.phase === 'partial') {
        const lists = await this.#listCatalog(operation.githubUserId)
        if (!(await this.#ownerStillActive(operation.githubUserId))) {
          await this.#accountSuspended(operation)
          return null
        }
        return lists
      }
      await this.#blocked(operation, 'GitHub did not complete native List reconciliation after verification.')
    } catch (error: unknown) {
      await this.#blocked(operation, 'GitHub did not complete native List reconciliation after verification.', error)
    }
    return null
  }

  async #invalidateMembershipWork(
    operation: NativeListLifecycleOperationRecord,
    listNodeId: string
  ): Promise<void> {
    await invalidateMembershipJobsForDeletedList(
      this.#database,
      operation.githubUserId,
      listNodeId,
      this.#now(),
      (jobId) => `lifecycle-${operation.operationId}-${jobId}`
    )
  }

  async #accountSuspended(operation: NativeListLifecycleOperationRecord): Promise<void> {
    await this.#save(operation, {
      phase: 'blocked-unknown',
      completedAt: this.#now(),
      lastError: fixedLifecycleError(
        'The active GitHub account changed during native List reconciliation. Refresh after returning to the account.',
        this.#now(),
        'authentication'
      )
    })
  }

  async #ownerStillActive(githubUserId: string): Promise<boolean> {
    const active = await this.#owner.loadActive()
    return active?.githubUserId === githubUserId && active.identity.githubUserId === githubUserId
  }

  async #complete(operation: NativeListLifecycleOperationRecord, phase: 'succeeded' | 'already-deleted' | 'needs-confirmation'): Promise<void> {
    await this.#save(operation, {phase, completedAt: phase === 'needs-confirmation' ? null : this.#now()})
  }
  async #failed(operation: NativeListLifecycleOperationRecord, message: string, error?: unknown): Promise<void> {
    const safe = error
      ? lifecycleError(error, this.#now(), message)
      : fixedLifecycleError(message, this.#now())
    await this.#save(operation, {phase: 'failed', lastError: safe, completedAt: this.#now()})
  }
  async #blocked(operation: NativeListLifecycleOperationRecord, message: string, error?: unknown): Promise<void> {
    const safe = error
      ? lifecycleError(error, this.#now(), message)
      : fixedLifecycleError(message, this.#now())
    await this.#save(operation, {phase: 'blocked-unknown', lastError: safe, completedAt: this.#now()})
  }
  async #save(operation: NativeListLifecycleOperationRecord, changes: Partial<NativeListLifecycleOperationRecord>): Promise<NativeListLifecycleOperationRecord> {
    const next = {...operation, ...changes, updatedAt: this.#now()} as NativeListLifecycleOperationRecord
    await putNativeListLifecycleOperation(this.#database, next)
    return next
  }
}

export function nativeListCatalogFingerprint(list: NativeListRecord): string {
  return JSON.stringify([list.listNodeId, list.name, list.visibility, list.reportedItemCount, list.importStatus])
}
function deleteFingerprint(
  list: {readonly listNodeId: string; readonly name: string; readonly isPrivate: boolean; readonly reportedItemCount: number},
  importStatus: 'complete' | 'partial'
): string {
  return JSON.stringify([list.listNodeId, list.name, list.isPrivate ? 'private' : 'public', list.reportedItemCount, importStatus])
}
function lifecycleError(
  error: unknown,
  occurredAt: string,
  message: string
): SanitizedMutationError {
  const safe = sanitizeError(error)
  return {category: safe.category === 'storage' || safe.category === 'unsupported' ? 'unknown' : safe.category, message, statusCode: safe.status ?? null, occurredAt}
}
function fixedLifecycleError(
  message: string,
  occurredAt: string,
  category: SanitizedMutationError['category'] = 'unknown'
): SanitizedMutationError {
  return {category, message, statusCode: null, occurredAt}
}
