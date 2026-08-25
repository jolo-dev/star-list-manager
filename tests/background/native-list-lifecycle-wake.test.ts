import {expect, test} from 'bun:test'
import {wakeNativeListLifecycle} from '../../src/background-lifecycle-wake'

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
      run: async () => { runnerCalls += 1 }
    }
  })

  expect(authLoads).toBe(0)
  expect(runnerCalls).toBe(0)
})

test('production lifecycle wake dispatches only for a proven, account-matched active identity', async () => {
  const calls: string[] = []
  await wakeNativeListLifecycle({
    capabilityProven: () => true,
    authSession: {loadActive: async () => ({githubUserId: '42', identity: {githubUserId: '42'}})},
    nativeListLifecycleRunner: {run: async (githubUserId) => { calls.push(githubUserId) }}
  })
  expect(calls).toEqual(['42'])
})
