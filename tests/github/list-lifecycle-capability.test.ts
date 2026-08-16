import {describe, expect, test} from 'bun:test'
import {nativeListLifecycleControlsEnabled} from '../../src/github/list-lifecycle-capability'

describe('native List lifecycle capability gate', () => {
  test('requires its own complete fixture proof and remains disabled by default', () => {
    expect(nativeListLifecycleControlsEnabled()).toBe(false)
    expect(nativeListLifecycleControlsEnabled({schema: 'available', oauthUserScope: 'verified', accountOwnership: 'verified', createReadBack: 'verified', deleteReadBack: 'verified'})).toBe(true)
  })
})
