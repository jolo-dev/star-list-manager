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
    hasActiveOperations: async () => false,
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
    hasActiveOperations: async () => false,
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
    hasActiveOperations: async () => false,
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

test('pauses and drains an in-flight lifecycle runner before allowing data deletion', async () => {
  let releaseRun!: () => void
  let runnerCalls = 0
  const wake = new NativeListLifecycleWake({
    capabilityProven: () => true,
    authSession: {loadActive: async () => ({githubUserId: '42', identity: {githubUserId: '42'}})},
    nativeListLifecycleRunner: {
      run: async () => {
        runnerCalls += 1
        await new Promise<void>((resolve) => { releaseRun = resolve })
      },
      operation: async () => null
    },
    hasActiveOperations: async () => false,
    schedule: async () => undefined,
    clear: async () => undefined
  })

  const running = wake.wake()
  await Promise.resolve()
  const paused = wake.pauseAndWait()
  await Promise.resolve()
  expect(runnerCalls).toBe(1)
  releaseRun()
  await Promise.all([running, paused])
  await wake.wake()
  expect(runnerCalls).toBe(1)
})

test('keeps a delayed alarm for account A work while account B is active, then resumes when A returns', async () => {
  let active = {githubUserId: 'B', identity: {githubUserId: 'B'}}
  const runs: string[] = []
  const delays: Array<number | undefined> = []
  let clears = 0
  let activeOperations = true
  const wake = new NativeListLifecycleWake({
    capabilityProven: () => true,
    authSession: {loadActive: async () => active},
    nativeListLifecycleRunner: {
      run: async (githubUserId) => { runs.push(githubUserId) },
      operation: async (githubUserId) => githubUserId === 'A' ? {phase: 'succeeded'} : null
    },
    hasActiveOperations: async () => activeOperations,
    schedule: async (delayMs) => { delays.push(delayMs) },
    clear: async () => { clears += 1 }
  })

  await wake.wake()
  expect(runs).toEqual(['B'])
  expect(delays).toEqual([60_000])
  expect(clears).toBe(0)

  active = {githubUserId: 'A', identity: {githubUserId: 'A'}}
  activeOperations = false
  await wake.wake()
  expect(runs).toEqual(['B', 'A'])
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
    hasActiveOperations: async () => false,
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
    hasActiveOperations: async () => false,
    schedule: async () => undefined,
    clear: async () => undefined
  })
  expect(calls).toEqual(['42'])
})
