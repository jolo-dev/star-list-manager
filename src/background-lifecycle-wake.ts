export interface NativeListLifecycleWakeServices {
  readonly capabilityProven: () => boolean
  readonly authSession: {
    readonly loadActive: () => Promise<{
      readonly githubUserId: string
      readonly identity: {readonly githubUserId: string}
    } | null>
  }
  readonly nativeListLifecycleRunner: {
    readonly run: (githubUserId: string) => Promise<void>
  }
}

/**
 * Service-worker recovery is an execution path, not an inspection path: it
 * fails closed unless this build currently has independent lifecycle proof.
 */
export async function wakeNativeListLifecycle(
  services: NativeListLifecycleWakeServices
): Promise<void> {
  if (!services.capabilityProven()) return
  const active = await services.authSession.loadActive()
  if (!active || active.identity.githubUserId !== active.githubUserId) return
  await services.nativeListLifecycleRunner.run(active.githubUserId)
}
