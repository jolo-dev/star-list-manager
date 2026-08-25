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
    readonly operation: (githubUserId: string) => Promise<{readonly phase: string} | null>
  }
  readonly hasActiveOperations: () => Promise<boolean>
  readonly setDispatchPaused?: (paused: boolean) => void
  readonly schedule: (delayMs?: number) => Promise<void>
  readonly clear: () => Promise<void>
}

/**
 * Owns one lifecycle drain per worker. The persisted alarm survives a worker
 * stop between persistence and direct dispatch; overlapping alarm/direct wakes
 * share this drain rather than issuing a second runner call.
 */
export class NativeListLifecycleWake {
  readonly #services: NativeListLifecycleWakeServices
  #drain: Promise<void> | null = null
  #paused = false

  constructor(services: NativeListLifecycleWakeServices) {
    this.#services = services
  }

  schedule(): Promise<void> {
    return this.#services.schedule()
  }

  clear(): Promise<void> {
    return this.#services.clear()
  }

  async pauseAndWait(): Promise<void> {
    this.#paused = true
    this.#services.setDispatchPaused?.(true)
    await this.#drain
  }

  resume(): void {
    this.#paused = false
    this.#services.setDispatchPaused?.(false)
  }

  wake(): Promise<void> {
    if (this.#paused) return Promise.resolve()
    if (this.#drain) return this.#drain
    const drain = this.#drainLifecycle().finally(() => {
      if (this.#drain === drain) this.#drain = null
    })
    this.#drain = drain
    return drain
  }

  async settle(githubUserId: string | null): Promise<void> {
    if (this.#paused || !this.#services.capabilityProven()) {
      await this.#services.clear()
      return
    }
    const operation = githubUserId === null
      ? null
      : await this.#services.nativeListLifecycleRunner.operation(githubUserId)
    if (
      githubUserId !== null &&
      operation &&
      isActivePhase(operation.phase) &&
      await this.#ownerStillActive(githubUserId)
    ) {
      await this.#services.schedule()
      return
    }
    // Work for a different signed-in account stays durable without spinning.
    if (await this.#services.hasActiveOperations()) {
      await this.#services.schedule(60_000)
      return
    }
    await this.#services.clear()
  }

  async #drainLifecycle(): Promise<void> {
    if (this.#paused || !this.#services.capabilityProven()) {
      await this.#services.clear()
      return
    }
    const active = await this.#services.authSession.loadActive()
    if (!active || active.identity.githubUserId !== active.githubUserId) {
      await this.settle(null)
      return
    }
    if (this.#paused) {
      await this.settle(active.githubUserId)
      return
    }
    try {
      await this.#services.nativeListLifecycleRunner.run(active.githubUserId)
    } finally {
      await this.settle(active.githubUserId)
    }
  }

  async #ownerStillActive(githubUserId: string): Promise<boolean> {
    const active = await this.#services.authSession.loadActive()
    return active?.githubUserId === githubUserId && active.identity.githubUserId === githubUserId
  }
}

/** Compatibility helper for isolated callers; production keeps one instance. */
export function wakeNativeListLifecycle(
  services: NativeListLifecycleWakeServices
): Promise<void> {
  return new NativeListLifecycleWake(services).wake()
}

function isActivePhase(phase: string): boolean {
  return phase === 'queued' || phase === 'preflight' || phase === 'mutating' || phase === 'verifying'
}
