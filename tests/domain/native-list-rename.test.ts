import {describe, expect, test} from 'bun:test'
import {
  canonicalNativeListName,
  nativeListNameKey,
  validateNativeListRename
} from '../../src/domain/native-list-rename'

describe('native List rename validation', () => {
  test('canonicalizes display names with surrounding whitespace and NFKC', () => {
    expect(canonicalNativeListName('  Ｔools  ')).toBe('Tools')
    expect(nativeListNameKey('  Ｔools  ')).toBe('tools')
  })

  test('trims compatibility whitespace introduced by NFKC and remains idempotent', () => {
    expect(canonicalNativeListName('¨A')).toBe('̈A')
    expect(canonicalNativeListName(canonicalNativeListName('¨A'))).toBe('̈A')
  })

  test('rejects empty and whitespace-only names with a stable sanitized error', () => {
    for (const name of ['', ' \t\n ']) {
      expect(validateNativeListRename(name, 'L_target', [])).toEqual({
        ok: false,
        error: {
          code: 'empty',
          message: 'A native List name is required.'
        }
      })
    }
  })

  test('allows an unchanged target name and distinct canonical name', () => {
    expect(
      validateNativeListRename('  Tools  ', 'L_target', [
        {listNodeId: 'L_target', name: 'tools'},
        {listNodeId: 'L_other', name: 'Reading'}
      ])
    ).toEqual({ok: true, value: 'Tools'})

    expect(
      validateNativeListRename('Archive', 'L_target', [
        {listNodeId: 'L_target', name: 'Tools'},
        {listNodeId: 'L_other', name: 'Reading'}
      ])
    ).toEqual({ok: true, value: 'Archive'})
  })

  test('rejects case and Unicode-equivalent names belonging to another List', () => {
    for (const name of ['tools', 'Ｔｏｏｌｓ']) {
      expect(
        validateNativeListRename(name, 'L_target', [
          {listNodeId: 'L_target', name: 'Current'},
          {listNodeId: 'L_other', name: 'Tools'}
        ])
      ).toEqual({
        ok: false,
        error: {
          code: 'duplicate',
          message: 'A native List with this name already exists.'
        }
      })
    }
  })
})
