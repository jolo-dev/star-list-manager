import {failure, success, type Result} from '../shared/result'

const nativeListNameCollator = new Intl.Collator('und', {usage: 'search', sensitivity: 'base'})

export interface NativeListRenameListItem {
  readonly listNodeId: string
  readonly name: string
}

export type NativeListRenameValidationError =
  | {
      readonly code: 'empty'
      readonly message: 'A native List name is required.'
    }
  | {
      readonly code: 'duplicate'
      readonly message: 'A native List with this name already exists.'
    }

export function canonicalNativeListName(value: string): string {
  return value.normalize('NFKC').trim()
}

export function nativeListNameKey(value: string): string {
  return canonicalNativeListName(value).toLocaleLowerCase()
}

export function nativeListNamesEquivalent(left: string, right: string): boolean {
  return nativeListNameCollator.compare(
    canonicalNativeListName(left),
    canonicalNativeListName(right)
  ) === 0
}

export function validateNativeListRename(
  value: string,
  listNodeId: string,
  lists: Iterable<NativeListRenameListItem>
): Result<string, NativeListRenameValidationError> {
  const name = canonicalNativeListName(value)
  if (name.length === 0) {
    return failure({
      code: 'empty',
      message: 'A native List name is required.'
    })
  }

  for (const list of lists) {
    if (list.listNodeId !== listNodeId && nativeListNamesEquivalent(list.name, name)) {
      return failure({
        code: 'duplicate',
        message: 'A native List with this name already exists.'
      })
    }
  }

  return success(name)
}
