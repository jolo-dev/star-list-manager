import {sanitizeError} from './errors'

export function safeLogMessage(error: unknown): string {
  return sanitizeError(error).message
}
