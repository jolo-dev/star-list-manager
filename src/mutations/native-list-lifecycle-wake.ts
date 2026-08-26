export const nativeListLifecycleAlarmName = 'native-list-lifecycle-wake'

export interface NativeListLifecycleWakeEvents {
  readonly onAlarm: (name: string, listener: () => void) => void
  readonly onStartup: (listener: () => void) => void
}

/**
 * Registers recovery independently from repository mutation-queue alarms and
 * immediately checks durable work whenever a service worker is evaluated.
 * The immediate wake covers browser startup events missed before registration
 * and one-shot alarms consumed by a worker that was terminated mid-drain.
 */
export function registerNativeListLifecycleWakeEvents(
  events: NativeListLifecycleWakeEvents,
  wakeLifecycle: () => void
): void {
  events.onAlarm(nativeListLifecycleAlarmName, wakeLifecycle)
  events.onStartup(wakeLifecycle)
  wakeLifecycle()
}
