import type {LibraryExportDocument} from '../domain/types'
import {decodeLibraryExportDocument} from '../import/decoder'
import {validationFailure} from '../shared/errors'

export function serializeLibraryExport(document: LibraryExportDocument): string {
  const validated = decodeLibraryExportDocument(document)
  if (!validated.ok) throw validationFailure(validated.error.message)
  return JSON.stringify(validated.value, null, 2)
}
