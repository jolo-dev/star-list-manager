import {expect, test} from 'bun:test'
import {IDBFactory} from 'fake-indexeddb'
import {NativeListLifecycleRunner} from '../../src/mutations/native-list-lifecycle-runner'
import {openLibraryDatabase} from '../../src/storage/database'
import {getActiveNativeListLifecycleOperation, putNativeListLifecycleOperation} from '../../src/storage/library'

test('lifecycle runner records ambiguous create without retrying it', async () => {
  const database = await openLibraryDatabase({name: 'lifecycle-ambiguous', factory: new IDBFactory()})
  await putNativeListLifecycleOperation(database, operation())
  let calls = 0
  const runner = new NativeListLifecycleRunner({
    database,
    writer: {createList: async () => { calls += 1; throw new Error('response lost') }, deleteList: async () => undefined},
    synchronize: async () => ({phase: 'complete'}),
    listCatalog: async () => [],
    now: () => '2026-08-12T01:00:00.000Z'
  })

  await runner.run('42')
  expect(calls).toBe(1)
  expect(await getActiveNativeListLifecycleOperation(database, '42')).toBeNull()
  expect((await runner.operation('42'))?.phase).toBe('blocked-unknown')
  database.close()
})

test('lifecycle runner refuses deletion when a fresh catalog synchronization fails', async () => {
  const database = await openLibraryDatabase({name: 'lifecycle-stale-delete', factory: new IDBFactory()})
  const list = {
    githubUserId: '42',
    listNodeId: 'L_delete',
    name: 'Delete me',
    description: null,
    visibility: 'public' as const,
    slug: null,
    createdAt: null,
    updatedAt: null,
    lastAddedAt: null,
    reportedItemCount: 0,
    importedItemCount: 0,
    importStatus: 'complete' as const,
    lastObservedAt: '2026-08-12T00:00:00.000Z'
  }
  await putNativeListLifecycleOperation(database, {
    ...operation(),
    intent: {
      kind: 'delete',
      listNodeId: list.listNodeId,
      name: list.name,
      visibility: list.visibility,
      reportedItemCount: list.reportedItemCount,
      importStatus: list.importStatus
    },
    confirmationFingerprint: JSON.stringify([
      list.listNodeId,
      list.name,
      list.visibility,
      list.reportedItemCount,
      list.importStatus
    ])
  })
  let deleteCalls = 0
  const runner = new NativeListLifecycleRunner({
    database,
    writer: {createList: async () => { throw new Error('not expected') }, deleteList: async () => { deleteCalls += 1 }},
    synchronize: async () => ({phase: 'stale'}),
    listCatalog: async () => [list],
    now: () => '2026-08-12T01:00:00.000Z'
  })

  await runner.run('42')

  expect(deleteCalls).toBe(0)
  expect((await runner.operation('42'))?.phase).toBe('failed')
  database.close()
})

function operation() {
  return {githubUserId: '42', operationId: 'op', intent: {kind: 'create' as const, name: 'Ideas', visibility: 'private' as const}, phase: 'queued' as const, attemptCount: 0, candidateListNodeId: null, confirmationFingerprint: null, lastError: null, createdAt: '2026-08-12T00:00:00.000Z', updatedAt: '2026-08-12T00:00:00.000Z', completedAt: null}
}
