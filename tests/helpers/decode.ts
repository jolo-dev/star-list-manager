export function parseFixtureJson(text: string): unknown {
  return JSON.parse(text) as unknown
}
