export const mutationQueueAlarmName = 'mutation-queue-wake'

export interface MutationQueueWakeEvents {
  readonly onAlarm: (name: string, listener: () => void) => void
  readonly onStartup: (listener: () => void) => void
}

export function registerMutationQueueWakeEvents(
  events: MutationQueueWakeEvents,
  checkQueue: () => void
): void {
  events.onAlarm(mutationQueueAlarmName, checkQueue)
  events.onStartup(checkQueue)
}
