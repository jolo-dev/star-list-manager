import {expect, test} from 'bun:test'
import {AppFailure} from '../../src/shared/errors'
import {planMembershipIntent, relevantListCatalogFingerprint} from '../../src/domain/native-list-membership'
import {IDBFactory} from 'fake-indexeddb'
import {NativeListLifecycleRunner} from '../../src/mutations/native-list-lifecycle-runner'
import {NativeListMutationLock} from '../../src/mutations/native-list-mutation-lock'
import {openLibraryDatabase} from '../../src/storage/database'
import {putNativeListLifecycleOperation, putRepository} from '../../src/storage/library'
import {enqueueMembershipMutationBatch, getMutationJob} from '../../src/storage/mutations'

const now = () => '2026-08-12T01:00:00.000Z'

test('creates only after the returned stable ID is present with matching metadata in catalog read-back', async () => {
  const harness = await createHarness('lifecycle-create')
  await putNativeListLifecycleOperation(harness.database, createOperation())
  harness.catalog.push(observation([metadata('UL_created', 'Ideas', false, 0)]))
  harness.currentCatalog = []
  harness.catalogAfterSync = [list('UL_created', 'Ideas', 'public', 0)]
  await harness.runner.run('42')
  expect(harness.createCalls).toBe(1)
  expect(harness.syncCalls).toBe(1)
  expect((await harness.runner.operation('42'))?.phase).toBe('succeeded')
  harness.database.close()
})

test('does not report create success when normal reconciliation lacks the read-back candidate', async () => {
  const harness = await createHarness('lifecycle-create-divergent-sync')
  await putNativeListLifecycleOperation(harness.database, createOperation())
  harness.currentCatalog = []
  harness.catalog.push(observation([metadata('UL_created', 'Ideas', false, 0)]))
  harness.catalogAfterSync = []
  await harness.runner.run('42')
  expect(harness.createCalls).toBe(1)
  expect(harness.syncCalls).toBe(1)
  expect((await harness.runner.operation('42'))?.phase).toBe('blocked-unknown')
  harness.database.close()
})

test('delete supports empty and populated Lists without any membership mutation', async () => {
  for (const count of [0, 2]) {
    const harness = await createHarness(`lifecycle-delete-${count}`)
    const current = list('UL_delete', 'Delete me', 'public', count)
    await putNativeListLifecycleOperation(harness.database, deleteOperation(current))
    harness.currentCatalog = [current]
    harness.catalogAfterSync = []
    harness.catalog.push(observation([metadata('UL_delete', 'Delete me', false, count)]), observation([]))
    await harness.runner.run('42')
    expect(harness.deleteCalls, String(count)).toBe(1)
    expect((await harness.runner.operation('42'))?.phase, String(count)).toBe('succeeded')
    harness.database.close()
  }
})

test('requires exact renewed delete confirmation and treats fresh absence as already deleted', async () => {
  const changed = await createHarness('lifecycle-changed')
  const current = list('UL_delete', 'Delete me', 'public', 0)
  await putNativeListLifecycleOperation(changed.database, deleteOperation(current))
  changed.currentCatalog = [current]
  changed.catalogAfterSync = [current]
  changed.catalog.push(observation([metadata('UL_delete', 'Renamed', false, 0)]))
  await changed.runner.run('42')
  expect(changed.deleteCalls).toBe(0)
  expect((await changed.runner.operation('42'))?.phase).toBe('needs-confirmation')
  changed.database.close()

  const absent = await createHarness('lifecycle-already-deleted')
  await putNativeListLifecycleOperation(absent.database, deleteOperation(current))
  absent.currentCatalog = [current]
  absent.catalogAfterSync = []
  absent.catalog.push(observation([]))
  await absent.runner.run('42')
  expect(absent.deleteCalls).toBe(0)
  expect(absent.syncCalls).toBe(1)
  expect((await absent.runner.operation('42'))?.phase).toBe('already-deleted')
  absent.database.close()
})

test('never replays response-lost writes, blocks read-back mismatch, and leaves interrupted work observational', async () => {
  const ambiguous = await createHarness('lifecycle-ambiguous')
  await putNativeListLifecycleOperation(ambiguous.database, createOperation())
  ambiguous.createError = new Error('response lost')
  await ambiguous.runner.run('42')
  await ambiguous.runner.run('42')
  expect(ambiguous.createCalls).toBe(1)
  expect((await ambiguous.runner.operation('42'))?.phase).toBe('blocked-unknown')
  ambiguous.database.close()

  const mismatch = await createHarness('lifecycle-mismatch')
  await putNativeListLifecycleOperation(mismatch.database, createOperation())
  mismatch.catalog.push(observation([metadata('UL_created', 'Wrong', false, 0)]))
  await mismatch.runner.run('42')
  expect(mismatch.createCalls).toBe(1)
  expect((await mismatch.runner.operation('42'))?.phase).toBe('blocked-unknown')
  mismatch.database.close()

  const interrupted = await createHarness('lifecycle-interrupted')
  await putNativeListLifecycleOperation(interrupted.database, {...createOperation(), phase: 'mutating'})
  interrupted.catalog.push(observation([]))
  await interrupted.runner.run('42')
  expect(interrupted.createCalls).toBe(0)
  expect((await interrupted.runner.operation('42'))?.phase).toBe('blocked-unknown')
  interrupted.database.close()
})

test('does not report deletion or invalidate work when post-sync reconciliation remains divergent', async () => {
  const harness = await createHarness('lifecycle-delete-divergent-sync')
  const current = list('UL_delete', 'Delete me', 'public', 0)
  await putNativeListLifecycleOperation(harness.database, deleteOperation(current))
  harness.currentCatalog = [current]
  await enqueueAffectedMembership(harness.database)
  // Fresh catalog first proves absence, but normal sync read-back leaves the List present.
  harness.catalog.push(observation([]))
  harness.catalogAfterSync = [current]
  await harness.runner.run('42')
  expect(harness.deleteCalls).toBe(0)
  expect(harness.syncCalls).toBe(1)
  expect((await harness.runner.operation('42'))?.phase).toBe('blocked-unknown')
  expect((await getMutationJob(harness.database, '42', 'affected-membership'))?.status).toBe('queued')
  harness.database.close()
})

test('does not retry a writer rate limit and remains terminal for recovery by observation', async () => {
  const harness = await createHarness('lifecycle-writer-rate-limit')
  await putNativeListLifecycleOperation(harness.database, createOperation())
  harness.createError = new AppFailure({category: 'rate-limit', message: 'limited', retryable: true})
  await harness.runner.run('42')
  await harness.runner.run('42')
  expect(harness.createCalls).toBe(1)
  expect((await harness.runner.operation('42'))?.phase).toBe('blocked-unknown')
  harness.database.close()
})

test('does not mutate on catalog rate limit or account switch at an execution boundary', async () => {
  const rateLimited = await createHarness('lifecycle-rate-limit')
  const rateLimitedList = list('UL_delete', 'Delete me', 'public', 0)
  await putNativeListLifecycleOperation(rateLimited.database, deleteOperation(rateLimitedList))
  rateLimited.currentCatalog = [rateLimitedList]
  rateLimited.catalogAfterSync = [rateLimitedList]
  rateLimited.catalogError = new Error('rate limited')
  await rateLimited.runner.run('42')
  expect(rateLimited.deleteCalls).toBe(0)
  expect((await rateLimited.runner.operation('42'))?.phase).toBe('failed')
  rateLimited.database.close()

  const switched = await createHarness('lifecycle-account-switch')
  await putNativeListLifecycleOperation(switched.database, createOperation())
  switched.switchOnOwnerCheck = 2
  await switched.runner.run('42')
  expect(switched.createCalls).toBe(0)
  expect((await switched.runner.operation('42'))?.phase).toBe('queued')
  switched.database.close()
})

async function createHarness(name: string) {
  const database = await openLibraryDatabase({name, factory: new IDBFactory()})
  let active = '42'
  const catalog: ReturnType<typeof observation>[] = []
  const harness = {
    database, catalog, createCalls: 0, deleteCalls: 0, syncCalls: 0, createError: null as Error | null,
    catalogError: null as Error | null, switchAfterCatalog: false, switchOnOwnerCheck: 0, ownerChecks: 0,
    currentCatalog: [] as ReturnType<typeof list>[], catalogAfterSync: [] as ReturnType<typeof list>[],
    runner: null as unknown as NativeListLifecycleRunner
  }
  harness.runner = new NativeListLifecycleRunner({
    database,
    owner: {loadActive: async () => { harness.ownerChecks += 1; if (harness.ownerChecks === harness.switchOnOwnerCheck) active = '99'; return active === '42' ? {githubUserId: '42', identity: {githubUserId: '42'}} : {githubUserId: active, identity: {githubUserId: active}} }},
    lock: new NativeListMutationLock(),
    writer: {
      createList: async () => { harness.createCalls += 1; if (harness.createError) throw harness.createError; return {listNodeId: 'UL_created', name: 'Ideas', visibility: 'public' as const} },
      deleteList: async () => { harness.deleteCalls += 1 }
    },
    observeCatalog: async () => { if (harness.catalogError) throw harness.catalogError; const result = harness.catalog.shift() ?? observation([]); if (harness.switchAfterCatalog) active = '99'; return result },
    synchronize: async () => { harness.syncCalls += 1; harness.currentCatalog = harness.catalogAfterSync; return {phase: 'complete'} },
    listCatalog: async () => harness.currentCatalog,
    now
  })
  return harness
}

async function enqueueAffectedMembership(database: IDBDatabase): Promise<void> {
  await putRepository(database, {
    githubUserId: '42', repositoryNodeId: 'R_kept', ownerLogin: 'octocat', name: 'kept', fullName: 'octocat/kept', htmlUrl: 'https://github.com/octocat/kept', description: null, topics: [], primaryLanguage: null, starredAt: now(), pushedAt: null, archived: false, disabled: false, isStarred: true, firstObservedAt: now(), lastObservedAt: now(), unstarredAt: null
  })
  const plan = planMembershipIntent([], {kind: 'add', githubUserId: '42', repositoryNodeId: 'R_kept', additions: ['UL_delete']})
  if (!plan.ok) throw new Error('invalid fixture')
  await enqueueMembershipMutationBatch(database, {
    githubUserId: '42', batchId: 'affected-batch', origin: 'single', createdAt: now(),
    repositories: [{jobId: 'affected-membership', repositoryNodeId: 'R_kept', ownerLogin: 'octocat', repositoryName: 'kept', plan: plan.value, confirmedCatalog: relevantListCatalogFingerprint(['UL_delete'], [{listNodeId: 'UL_delete', name: 'Delete me', visibility: 'public'}])}]
  })
}

function createOperation() {
  return {githubUserId: '42', operationId: 'op', intent: {kind: 'create' as const, name: 'Ideas', visibility: 'public' as const}, phase: 'queued' as const, attemptCount: 0, candidateListNodeId: null, confirmationFingerprint: null, lastError: null, createdAt: '2026-08-12T00:00:00.000Z', updatedAt: '2026-08-12T00:00:00.000Z', completedAt: null}
}
function list(listNodeId: string, name: string, visibility: 'public' | 'private', reportedItemCount: number) {
  return {githubUserId: '42', listNodeId, name, description: null, visibility, slug: null, createdAt: null, updatedAt: null, lastAddedAt: null, reportedItemCount, importedItemCount: reportedItemCount, importStatus: 'complete' as const, lastObservedAt: '2026-08-12T00:00:00.000Z'}
}
function deleteOperation(current: ReturnType<typeof list>) {
  return {...createOperation(), operationId: 'delete', intent: {kind: 'delete' as const, listNodeId: current.listNodeId, name: current.name, visibility: current.visibility, reportedItemCount: current.reportedItemCount, importStatus: current.importStatus}, confirmationFingerprint: JSON.stringify([current.listNodeId, current.name, current.visibility, current.reportedItemCount, current.importStatus])}
}
function metadata(listNodeId: string, name: string, isPrivate: boolean, reportedItemCount: number) {
  return {listNodeId, name, description: null, isPrivate, slug: null, createdAt: null, updatedAt: null, lastAddedAt: null, reportedItemCount}
}
function observation(lists: readonly ReturnType<typeof metadata>[]) {
  const target = (id: string) => lists.find((item) => item.listNodeId === id) ?? null
  return {githubUserId: '42', complete: true as const, targets: new Map([['UL_delete', target('UL_delete')], ['UL_created', target('UL_created')]]), fingerprint: JSON.stringify(lists), rateLimit: {limit: 5000, remaining: 4999, resetAt: null}}
}
