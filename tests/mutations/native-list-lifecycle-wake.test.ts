import {expect, test} from 'bun:test'
import {
  nativeListLifecycleAlarmName,
  registerNativeListLifecycleWakeEvents
} from '../../src/mutations/native-list-lifecycle-wake'

test('registers dedicated wake events and immediately recovers when a worker starts after the one-shot alarm fired', () => {
  const alarms = new Map<string, () => void>()
  let startup: (() => void) | null = null
  let wakes = 0

  registerNativeListLifecycleWakeEvents({
    onAlarm: (name, listener) => { alarms.set(name, listener) },
    onStartup: (listener) => { startup = listener }
  }, () => { wakes += 1 })

  expect(nativeListLifecycleAlarmName).toBe('native-list-lifecycle-wake')
  expect(wakes).toBe(1)
  alarms.get('mutation-queue-wake')?.()
  expect(wakes).toBe(1)
  alarms.get(nativeListLifecycleAlarmName)?.()
  ;(startup as (() => void) | null)?.()
  expect(wakes).toBe(3)
})
