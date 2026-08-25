import {expect, test} from 'bun:test'
import {
  nativeListLifecycleAlarmName,
  registerNativeListLifecycleWakeEvents
} from '../../src/mutations/native-list-lifecycle-wake'

test('registers only the dedicated lifecycle alarm and browser startup wake', () => {
  const alarms = new Map<string, () => void>()
  let startup: (() => void) | null = null
  let wakes = 0

  registerNativeListLifecycleWakeEvents({
    onAlarm: (name, listener) => { alarms.set(name, listener) },
    onStartup: (listener) => { startup = listener }
  }, () => { wakes += 1 })

  expect(nativeListLifecycleAlarmName).toBe('native-list-lifecycle-wake')
  alarms.get('mutation-queue-wake')?.()
  expect(wakes).toBe(0)
  alarms.get(nativeListLifecycleAlarmName)?.()
  ;(startup as (() => void) | null)?.()
  expect(wakes).toBe(2)
})
