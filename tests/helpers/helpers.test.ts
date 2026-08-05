import {describe, expect, test} from 'bun:test'
import {starredRepositoryResponseFixture} from '../fixtures/github'
import {fixedClock} from './clock'
import {parseFixtureJson} from './decode'
import {jsonResponse} from './http'
import {messageFixture} from './messages'

describe('test helpers', () => {
  test('provides a deterministic clock', () => {
    const clock = fixedClock('2026-08-02T12:00:00Z')
    expect(clock.now().toISOString()).toBe('2026-08-02T12:00:00.000Z')
  })

  test('preserves unknown JSON at decoder boundaries', () => {
    expect(parseFixtureJson('{"value":1}')).toEqual({value: 1})
  })

  test('creates typed message fixtures', () => {
    expect(messageFixture('sync-stars', {force: true})).toEqual({
      type: 'sync-stars',
      payload: {force: true}
    })
  })

  test('creates GitHub JSON responses', async () => {
    const response = jsonResponse(starredRepositoryResponseFixture, {
      status: 206,
      headers: {'x-ratelimit-remaining': '4999'}
    })

    expect(response.status).toBe(206)
    expect(response.headers.get('x-ratelimit-remaining')).toBe('4999')
    expect((await response.json()) as unknown).toEqual(
      starredRepositoryResponseFixture
    )
  })
})
