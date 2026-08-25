import {
  MutationQueueRunner,
  type MutationQueueRunnerOptions
} from './runner'
import {
  NativeListLifecycleRunner,
  type NativeListLifecycleRunnerOptions
} from './native-list-lifecycle-runner'
import {NativeListMutationLock} from './native-list-mutation-lock'
import type {ListRenameMutationRequest} from '../github/list-rename-write-session'
import type {NativeListRecord} from '../domain/types'

/**
 * Production composition for the two native List mutation paths. The lock is
 * deliberately created here so lifecycle and membership writes cannot drift
 * onto separate serialization domains.
 */
export function createNativeListMutationRuntime(options: {
  readonly queue: MutationQueueRunnerOptions
  readonly rename: {
    readonly rename: (request: ListRenameMutationRequest) => Promise<NativeListRecord>
  }
  readonly lifecycle: Omit<NativeListLifecycleRunnerOptions, 'lock'>
}): {
  readonly lock: NativeListMutationLock
  readonly mutationQueue: MutationQueueRunner
  readonly nativeListRename: {
    readonly rename: (request: ListRenameMutationRequest) => Promise<NativeListRecord>
  }
  readonly lifecycleRunner: NativeListLifecycleRunner
} {
  const lock = new NativeListMutationLock()
  return {
    lock,
    mutationQueue: new MutationQueueRunner({
      ...options.queue,
      nativeListMutationLock: lock
    }),
    nativeListRename: {
      rename: (request) => lock.run(() => options.rename.rename(request))
    },
    lifecycleRunner: new NativeListLifecycleRunner({
      ...options.lifecycle,
      lock
    })
  }
}
