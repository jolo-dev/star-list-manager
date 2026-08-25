import {clearAllLibraryData} from './storage/library'

export interface ClearAllDataRuntimeServices {
  readonly database: IDBDatabase
  readonly mutationQueue: {
    readonly pause: () => Promise<void>
    readonly resume: () => void
  }
  readonly lifecycleWake: {
    readonly pauseAndWait: () => Promise<void>
    readonly clear: () => Promise<void>
    readonly resume: () => void
  }
  readonly resetWriteAuthorization: () => void
  readonly disconnectAuthentication: () => Promise<void>
  readonly clearLocalStorage: () => Promise<void>
  readonly clearToolbarBadge: () => Promise<void>
  readonly resetAuthentication: () => unknown
}

/** Drains both native-List execution paths before deleting their durable state. */
export async function clearAllDataWithLifecycleDrain(
  services: ClearAllDataRuntimeServices
): Promise<unknown> {
  const queuePaused = services.mutationQueue.pause()
  const lifecyclePaused = services.lifecycleWake.pauseAndWait()
  try {
    await Promise.all([queuePaused, lifecyclePaused])
    try {
      await services.lifecycleWake.clear()
      services.resetWriteAuthorization()
      await services.disconnectAuthentication()
      await clearAllLibraryData(services.database)
      await services.clearLocalStorage()
      await services.clearToolbarBadge()
      return services.resetAuthentication()
    } finally {
      services.lifecycleWake.resume()
    }
  } finally {
    services.mutationQueue.resume()
  }
}
