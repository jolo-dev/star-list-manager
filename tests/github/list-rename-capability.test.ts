import {describe, expect, test} from 'bun:test'
import {
  nativeListRenameControlsEnabled,
  type ListRenameCapabilityProof
} from '../../src/github/list-rename-capability'

const proof: ListRenameCapabilityProof = {
  schema: 'available',
  oauthUserScope: 'verified',
  accountOwnership: 'verified',
  unchangedNameMutation: 'verified',
  independentReadBack: 'verified'
}

describe('native List rename capability gate', () => {
  test('keeps production controls disabled by default or without a proof', () => {
    expect(nativeListRenameControlsEnabled()).toBe(false)
    expect(nativeListRenameControlsEnabled(null)).toBe(false)
  })

  test('enables controls only after every independent rename proof is complete', () => {
    expect(nativeListRenameControlsEnabled(proof)).toBe(true)

    for (const key of Object.keys(proof) as Array<keyof ListRenameCapabilityProof>) {
      expect(
        nativeListRenameControlsEnabled({...proof, [key]: 'unverified'})
      ).toBe(false)
    }
  })
})
