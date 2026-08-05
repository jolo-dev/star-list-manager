export interface TestClock {
  readonly now: () => Date
}

export function fixedClock(isoTimestamp: string): TestClock {
  return {
    now: () => new Date(isoTimestamp)
  }
}
