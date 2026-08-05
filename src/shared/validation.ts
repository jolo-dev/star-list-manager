import type {AppError} from './errors'
import {failure, success, type Result} from './result'

export class DecodeFailure extends Error {
  constructor(path: string, expectation: string) {
    super(`${path} must be ${expectation}.`)
    this.name = 'DecodeFailure'
  }
}

export function decodeValue<T>(decoder: () => T): Result<T, AppError> {
  try {
    return success(decoder())
  } catch (error: unknown) {
    return failure({
      category: 'validation',
      message:
        error instanceof DecodeFailure
          ? error.message
          : 'The received data could not be validated.',
      retryable: false
    })
  }
}

export function requireRecord(
  value: unknown,
  path: string
): Readonly<Record<string, unknown>> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new DecodeFailure(path, 'an object')
  }
  return value as Readonly<Record<string, unknown>>
}

export function requireArray(value: unknown, path: string): readonly unknown[] {
  if (!Array.isArray(value)) throw new DecodeFailure(path, 'an array')
  return value
}

export function requireString(
  record: Readonly<Record<string, unknown>>,
  key: string,
  path: string
): string {
  const value = record[key]
  if (typeof value !== 'string') throw new DecodeFailure(`${path}.${key}`, 'a string')
  return value
}

export function requireNonEmptyString(
  record: Readonly<Record<string, unknown>>,
  key: string,
  path: string
): string {
  const value = requireString(record, key, path)
  if (value.length === 0) throw new DecodeFailure(`${path}.${key}`, 'a non-empty string')
  return value
}

export function requireBoolean(
  record: Readonly<Record<string, unknown>>,
  key: string,
  path: string
): boolean {
  const value = record[key]
  if (typeof value !== 'boolean') throw new DecodeFailure(`${path}.${key}`, 'a boolean')
  return value
}

export function requireNumber(
  record: Readonly<Record<string, unknown>>,
  key: string,
  path: string
): number {
  const value = record[key]
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new DecodeFailure(`${path}.${key}`, 'a finite number')
  }
  return value
}

export function requireNonNegativeInteger(
  record: Readonly<Record<string, unknown>>,
  key: string,
  path: string
): number {
  const value = requireNumber(record, key, path)
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new DecodeFailure(`${path}.${key}`, 'a non-negative integer')
  }
  return value
}

export function requireNullableString(
  record: Readonly<Record<string, unknown>>,
  key: string,
  path: string
): string | null {
  const value = record[key]
  if (value === null) return null
  if (typeof value !== 'string') {
    throw new DecodeFailure(`${path}.${key}`, 'a string or null')
  }
  return value
}

export function optionalNullableString(
  record: Readonly<Record<string, unknown>>,
  key: string,
  path: string
): string | null {
  if (record[key] === undefined) return null
  return requireNullableString(record, key, path)
}

export function requireIsoDateTime(
  record: Readonly<Record<string, unknown>>,
  key: string,
  path: string
): string {
  const value = requireString(record, key, path)
  if (!isIsoDateTime(value)) {
    throw new DecodeFailure(`${path}.${key}`, 'an ISO date-time string')
  }
  return value
}

export function requireNullableIsoDateTime(
  record: Readonly<Record<string, unknown>>,
  key: string,
  path: string
): string | null {
  const value = requireNullableString(record, key, path)
  if (value !== null && !isIsoDateTime(value)) {
    throw new DecodeFailure(`${path}.${key}`, 'an ISO date-time string or null')
  }
  return value
}

export function optionalNullableIsoDateTime(
  record: Readonly<Record<string, unknown>>,
  key: string,
  path: string
): string | null {
  if (record[key] === undefined) return null
  return requireNullableIsoDateTime(record, key, path)
}

export function requireStringArray(
  record: Readonly<Record<string, unknown>>,
  key: string,
  path: string
): readonly string[] {
  return requireArray(record[key], `${path}.${key}`).map((value, index) => {
    if (typeof value !== 'string') {
      throw new DecodeFailure(`${path}.${key}[${index}]`, 'a string')
    }
    return value
  })
}

export function requireLiteral<T extends string | number>(
  record: Readonly<Record<string, unknown>>,
  key: string,
  expected: T,
  path: string
): T {
  if (record[key] !== expected) {
    throw new DecodeFailure(`${path}.${key}`, JSON.stringify(expected))
  }
  return expected
}

export function requireEnum<T extends string>(
  record: Readonly<Record<string, unknown>>,
  key: string,
  values: readonly T[],
  path: string
): T {
  const value = record[key]
  if (typeof value !== 'string' || !values.includes(value as T)) {
    throw new DecodeFailure(`${path}.${key}`, `one of ${values.join(', ')}`)
  }
  return value as T
}

export function requireOnlyKeys(
  record: Readonly<Record<string, unknown>>,
  allowedKeys: readonly string[],
  path: string
): void {
  const unexpected = Object.keys(record).find((key) => !allowedKeys.includes(key))
  if (unexpected) throw new DecodeFailure(`${path}.${unexpected}`, 'omitted')
}

export function isIsoDateTime(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value) &&
    Number.isFinite(Date.parse(value))
}
