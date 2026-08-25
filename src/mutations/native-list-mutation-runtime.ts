import {
  MutationQueueRunner,
  type MutationQueueRunnerOptions
} from './runner'
import {
  NativeListLifecycleRunner,
  type NativeListLifecycleRunnerOptions
} from './native-list-lifecycle-runner'
import {NativeListMutationLock} from './native-list-mutation-lock'

/**
 * Production composition for the two native List mutation paths. The lock is
 * deliberately created here so lifecycle and membership writes cannot drift
 * onto separate serialization domains.
 */
export function createNativeListMutationRuntime(options: {
  readonly queue: MutationQueueRunnerOptions
  readonly lifecycle: Omit<NativeListLifecycleRunnerOptions, 'lock'>
}): {
  readonly lock: NativeListMutationLock
  readonly mutationQueue: MutationQueueRunner
  readonly lifecycleRunner: NativeListLifecycleRunner
} {
  const lock = new NativeListMutationLock()
  return {
    lock,
    mutationQueue: new MutationQueueRunner({
      ...options.queue,
      nativeListMutationLock: lock
    }),
    lifecycleRunner: new NativeListLifecycleRunner({
      ...options.lifecycle,
      lock
    })
  }
}
