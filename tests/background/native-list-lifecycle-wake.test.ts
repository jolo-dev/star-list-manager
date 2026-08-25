import {expect, test} from 'bun:test'
import {
  NativeListLifecycleWake,
  wakeNativeListLifecycle
} from '../../src/background-lifecycle-wake'

test('production lifecycle wake does not dispatch persisted work when lifecycle capability is unproven', async () => {
  let authLoads = 0
  let runnerCalls = 0

  await wakeNativeListLifecycle({
    capabilityProven: () => false,
    authSession: {
      loadActive: async () => {
        authLoads += 1
        return {githubUserId: '42', identity: {githubUserId: '42'}}
      }
    },
    nativeListLifecycleRunner: {
      run: async () => { runnerCalls += 1 },
      operation: async () => null
    },
    schedule: async () => undefined,
    clear: async () => undefined
  })

  expect(authLoads).toBe(0)
  expect(runnerCalls).toBe(0)
})

test('recovers persisted queued work from a dedicated alarm after worker termination', async () => {
  let alarmScheduled = false
  let runnerCalls = 0
  const services = {
    capabilityProven: () => true,
    authSession: {loadActive: async () => ({githubUserId: '42', identity: {githubUserId: '42'}})},
    nativeListLifecycleRunner: {
      run: async () => { runnerCalls += 1 },
      operation: async () => null
    },
    schedule: async () => { alarmScheduled = true },
    clear: async () => { alarmScheduled = false }
  }

  // Persistence schedules before direct dispatch; a terminated worker loses the direct call.
  await new NativeListLifecycleWake(services).schedule()
  expect(alarmScheduled).toBe(true)

  // A later worker receives the dedicated alarm and drains the persisted work.
  const recoveredWorker = new NativeListLifecycleWake(services)
  if (alarmScheduled) await recoveredWorker.wake()
  expect(runnerCalls).toBe(1)
  expect(alarmScheduled).toBe(false)
})

test('deduplicates overlapping direct and alarm drains while rescheduling still-active work', async () => {
  let releaseRun!: () => void
  let runnerCalls = 0
  let scheduled = 0
  const wake = new NativeListLifecycleWake({
    capabilityProven: () => true,
    authSession: {loadActive: async () => ({githubUserId: '42', identity: {githubUserId: '42'}})},
    nativeListLifecycleRunner: {
      run: async () => {
        runnerCalls += 1
        await new Promise<void>((resolve) => { releaseRun = resolve })
      },
      operation: async () => ({phase: 'preflight'})
    },
    schedule: async () => { scheduled += 1 },
    clear: async () => undefined
  })

  const direct = wake.wake()
  await Promise.resolve()
  const alarm = wake.wake()
  expect(runnerCalls).toBe(1)
  releaseRun()
  await Promise.all([direct, alarm])
  expect(runnerCalls).toBe(1)
  expect(scheduled).toBe(1)
})

test('clears rather than dispatching or rescheduling when release capability is disabled', async () => {
  let runnerCalls = 0
  let cleared = 0
  const wake = new NativeListLifecycleWake({
    capabilityProven: () => false,
    authSession: {loadActive: async () => ({githubUserId: '42', identity: {githubUserId: '42'}})},
    nativeListLifecycleRunner: {
      run: async () => { runnerCalls += 1 },
      operation: async () => null
    },
    schedule: async () => { throw new Error('must not schedule') },
    clear: async () => { cleared += 1 }
  })

  await wake.wake()
  expect(runnerCalls).toBe(0)
  expect(cleared).toBe(1)
})

test('production lifecycle wake dispatches only for a proven, account-matched active identity', async () => {
  const calls: string[] = []
  await wakeNativeListLifecycle({
    capabilityProven: () => true,
    authSession: {loadActive: async () => ({githubUserId: '42', identity: {githubUserId: '42'}})},
    nativeListLifecycleRunner: {
      run: async (githubUserId) => { calls.push(githubUserId) },
      operation: async () => null
    },
    schedule: async () => undefined,
    clear: async () => undefined
  })
  expect(calls).toEqual(['42'])
})
