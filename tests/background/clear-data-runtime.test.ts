import {expect, test} from 'bun:test'
import {IDBFactory} from 'fake-indexeddb'
import {clearAllDataWithLifecycleDrain} from '../../src/background-clear-data-runtime'
import {openLibraryDatabase} from '../../src/storage/database'
import {
  listNativeListLifecycleOperations,
  putNativeListLifecycleOperation
} from '../../src/storage/library'

const now = '2026-08-25T00:00:00.000Z'

test('waits for lifecycle work before clearing its alarm and all durable data', async () => {
  const database = await openLibraryDatabase({
    name: 'clear-data-lifecycle-drain',
    factory: new IDBFactory()
  })
  await putNativeListLifecycleOperation(database, operation())
  const events: string[] = []
  let releaseLifecycle!: () => void
  const lifecycleReleased = new Promise<void>((resolve) => { releaseLifecycle = resolve })
  let remoteWrites = 0

  const clearing = clearAllDataWithLifecycleDrain({
    database,
    mutationQueue: {
      pause: async () => { events.push('queue-paused') },
      resume: () => { events.push('queue-resumed') }
    },
    lifecycleWake: {
      pauseAndWait: async () => {
        events.push('lifecycle-paused')
        await lifecycleReleased
        remoteWrites += 1
        await putNativeListLifecycleOperation(database, {...operation(), phase: 'succeeded', completedAt: now})
        events.push('lifecycle-finished')
      },
      clear: async () => { events.push('alarm-cleared') },
      resume: () => { events.push('lifecycle-resumed') }
    },
    resetWriteAuthorization: () => { events.push('write-reset') },
    disconnectAuthentication: async () => { events.push('auth-disconnected') },
    clearLocalStorage: async () => { events.push('local-cleared') },
    clearToolbarBadge: async () => { events.push('badge-cleared') },
    resetAuthentication: () => ({phase: 'signed-out'})
  })

  await Promise.resolve()
  expect(events).toEqual(['queue-paused', 'lifecycle-paused'])
  expect(await listNativeListLifecycleOperations(database, '42')).toHaveLength(1)

  releaseLifecycle()
  expect(await clearing).toEqual({phase: 'signed-out'})
  expect(events).toEqual([
    'queue-paused', 'lifecycle-paused', 'lifecycle-finished', 'alarm-cleared',
    'write-reset', 'auth-disconnected', 'local-cleared', 'badge-cleared',
    'lifecycle-resumed', 'queue-resumed'
  ])
  expect(await listNativeListLifecycleOperations(database, '42')).toEqual([])
  expect(remoteWrites).toBe(1)
  await Promise.resolve()
  expect(remoteWrites).toBe(1)
  database.close()
})

function operation() {
  return {
    githubUserId: '42', operationId: 'op', intent: {kind: 'create' as const, name: 'Ideas', visibility: 'public' as const},
    phase: 'queued' as const, attemptCount: 0, candidateListNodeId: null, confirmationFingerprint: null,
    lastError: null, createdAt: now, updatedAt: now, completedAt: null
  }
}
