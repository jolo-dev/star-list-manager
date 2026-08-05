export type ErrorCategory =
  | 'authentication'
  | 'network'
  | 'permission'
  | 'rate-limit'
  | 'storage'
  | 'unsupported'
  | 'validation'

export interface AppError {
  readonly category: ErrorCategory
  readonly message: string
  readonly retryable: boolean
  readonly status?: number
  readonly retryAt?: string
  readonly rateLimit?: {
    readonly limit: number | null
    readonly remaining: number | null
    readonly resetAt: string | null
  }
}

export class AppFailure extends Error {
  readonly publicError: AppError

  constructor(publicError: AppError) {
    super(publicError.message)
    this.name = 'AppFailure'
    this.publicError = publicError
  }
}

export function sanitizeError(error: unknown): AppError {
  if (error instanceof AppFailure) return sanitizeAppError(error.publicError)

  return {
    category: 'network',
    message: 'An unexpected error occurred.',
    retryable: true
  }
}

export function githubHttpFailure(
  response: Response,
  safeMessage = 'GitHub could not complete the request.'
): AppFailure {
  const limit = parseIntegerHeader(response.headers.get('x-ratelimit-limit'))
  const remaining = parseIntegerHeader(response.headers.get('x-ratelimit-remaining'))
  const resetAt = parseResetTime(response.headers.get('x-ratelimit-reset'))
  const rateLimited = response.status === 429 || (response.status === 403 && remaining === 0)
  const category: ErrorCategory = rateLimited
    ? 'rate-limit'
    : response.status === 401
      ? 'authentication'
      : response.status === 403
        ? 'permission'
        : 'network'

  return new AppFailure({
    category,
    message: safeMessage,
    retryable: rateLimited || response.status === 408 || response.status >= 500,
    status: response.status,
    ...(resetAt ? {retryAt: resetAt} : {}),
    ...(limit !== null || remaining !== null || resetAt !== null
      ? {rateLimit: {limit, remaining, resetAt}}
      : {})
  })
}

export function validationFailure(message: string): AppFailure {
  return new AppFailure({
    category: 'validation',
    message,
    retryable: false
  })
}

function sanitizeAppError(error: AppError): AppError {
  return {
    category: error.category,
    message: redactSensitiveText(error.message),
    retryable: error.retryable,
    ...(error.status === undefined ? {} : {status: error.status}),
    ...(error.retryAt === undefined ? {} : {retryAt: error.retryAt}),
    ...(error.rateLimit === undefined ? {} : {rateLimit: error.rateLimit})
  }
}

function redactSensitiveText(message: string): string {
  return message
    .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(/\bgh[pousr]_[A-Za-z0-9_]+\b/g, '[redacted]')
    .replace(
      /\b(access_token|refresh_token|device_code|authorization)\b\s*[:=]\s*[^\s,;]+/gi,
      '$1=[redacted]'
    )
    .replace(/\b[A-Z0-9]{4}-[A-Z0-9]{4}\b/g, '[redacted]')
}

function parseIntegerHeader(value: string | null): number | null {
  if (value === null || !/^\d+$/.test(value)) return null
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) ? parsed : null
}

function parseResetTime(value: string | null): string | null {
  const seconds = parseIntegerHeader(value)
  return seconds === null ? null : new Date(seconds * 1000).toISOString()
}
