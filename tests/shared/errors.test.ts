import {describe, expect, test} from 'bun:test'
import {
  AppFailure,
  githubHttpFailure,
  sanitizeError
} from '../../src/shared/errors'
import {safeLogMessage} from '../../src/shared/logging'

describe('sanitized errors', () => {
  test('preserves HTTP and rate-limit metadata without response content', () => {
    const failure = githubHttpFailure(
      new Response('access_token=secret', {
        status: 403,
        headers: {
          'x-ratelimit-limit': '5000',
          'x-ratelimit-remaining': '0',
          'x-ratelimit-reset': '1785762000'
        }
      }),
      'GitHub rate limit reached.'
    )

    expect(sanitizeError(failure)).toEqual({
      category: 'rate-limit',
      message: 'GitHub rate limit reached.',
      retryable: true,
      status: 403,
      retryAt: '2026-08-03T13:00:00.000Z',
      rateLimit: {
        limit: 5000,
        remaining: 0,
        resetAt: '2026-08-03T13:00:00.000Z'
      }
    })
  })

  test('does not expose raw exception messages', () => {
    const error = sanitizeError(
      new Error('Authorization: Bearer secret access_token=secret ghp_fixture')
    )
    expect(error.message).toBe('An unexpected error occurred.')
    expect(JSON.stringify(error)).not.toContain('secret')
    expect(JSON.stringify(error)).not.toContain('ghp_fixture')
  })

  test('redacts credential patterns from explicitly public failures', () => {
    const error = sanitizeError(
      new AppFailure({
        category: 'authentication',
        message: 'Bearer secret refresh_token=secret ABCD-EFGH',
        retryable: false
      })
    )
    expect(error.message).toBe('Bearer [redacted] refresh_token=[redacted] [redacted]')
  })

  test('sanitizes exception text before logging', () => {
    expect(safeLogMessage(new Error('Bearer access-secret'))).toBe(
      'An unexpected error occurred.'
    )
  })
})
