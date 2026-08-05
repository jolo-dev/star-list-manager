import {afterEach, describe, expect, test} from 'bun:test'
import manifest from '../../src/manifest.json'
import {
  clearBrowserAlarm,
  createBrowserAlarm,
  onBrowserAlarm,
  onBrowserStartup
} from '../../src/platform/browser'

const originalChrome = Object.getOwnPropertyDescriptor(globalThis, 'chrome')

afterEach(() => {
  if (originalChrome) {
    Object.defineProperty(globalThis, 'chrome', originalChrome)
  } else {
    Reflect.deleteProperty(globalThis, 'chrome')
  }
})

describe('browser alarm platform', () => {
  test('creates and clears one-shot alarms and filters wake events by name', async () => {
    const created: Array<readonly [string, number]> = []
    const cleared: string[] = []
    const listeners: {
      alarm: ((alarm: {readonly name: string}) => void) | null
      startup: (() => void) | null
    } = {alarm: null, startup: null}
    installChrome({
      create: (name, when) => created.push([name, when]),
      clear: (name) => cleared.push(name),
      onAlarm: (listener) => {
        listeners.alarm = listener
      },
      onStartup: (listener) => {
        listeners.startup = listener
      }
    })
    let alarmWakes = 0
    let startupWakes = 0

    await createBrowserAlarm('queue', 123_456)
    await clearBrowserAlarm('queue')
    onBrowserAlarm('queue', () => {
      alarmWakes += 1
    })
    onBrowserStartup(() => {
      startupWakes += 1
    })
    listeners.alarm?.({name: 'other'})
    listeners.alarm?.({name: 'queue'})
    listeners.startup?.()

    expect(created).toEqual([['queue', 123_456]])
    expect(cleared).toEqual(['queue'])
    expect(alarmWakes).toBe(1)
    expect(startupWakes).toBe(1)
  })

  test('adds only alarms to existing extension API permissions', () => {
    expect(manifest['chromium:permissions']).toEqual(['storage', 'alarms'])
    expect(manifest['firefox:permissions']).toEqual([
      'storage',
      'alarms',
      'https://api.github.com/*',
      'https://github.com/login/*'
    ])
  })
})

interface ChromeAlarmHarness {
  readonly create: (name: string, when: number) => void
  readonly clear: (name: string) => void
  readonly onAlarm: (listener: (alarm: {readonly name: string}) => void) => void
  readonly onStartup: (listener: () => void) => void
}

function installChrome(harness: ChromeAlarmHarness): void {
  const fakeChrome = {
    alarms: {
      create: (name: string, info: {readonly when: number}) => {
        harness.create(name, info.when)
        return Promise.resolve()
      },
      clear: (name: string) => {
        harness.clear(name)
        return Promise.resolve(true)
      },
      onAlarm: {addListener: harness.onAlarm}
    },
    runtime: {onStartup: {addListener: harness.onStartup}}
  }
  Object.defineProperty(globalThis, 'chrome', {
    configurable: true,
    value: fakeChrome as unknown as typeof chrome
  })
}
