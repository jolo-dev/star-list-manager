export const nativeListLifecycleAlarmName = 'native-list-lifecycle-wake'

export interface NativeListLifecycleWakeEvents {
  readonly onAlarm: (name: string, listener: () => void) => void
  readonly onStartup: (listener: () => void) => void
}

/** Registers recovery independently from repository mutation-queue alarms. */
export function registerNativeListLifecycleWakeEvents(
  events: NativeListLifecycleWakeEvents,
  wakeLifecycle: () => void
): void {
  events.onAlarm(nativeListLifecycleAlarmName, wakeLifecycle)
  events.onStartup(wakeLifecycle)
}
