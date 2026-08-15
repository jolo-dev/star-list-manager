import {describe, expect, test} from 'bun:test'
import {
  nativeListRenameControlsEnabled,
  type ListRenameCapabilityProof
} from '../../src/github/list-rename-capability'

const proof = {
  schema: 'available',
  oauthUserScope: 'verified',
  accountOwnership: 'verified',
  temporaryRenameMutation: 'verified',
  restorationMutation: 'verified',
  temporaryCatalogReadBack: 'verified',
  restorationCatalogReadBack: 'verified'
} as const satisfies ListRenameCapabilityProof

describe('native List rename capability gate', () => {
  test('keeps production controls disabled by default or without a proof', () => {
    expect(nativeListRenameControlsEnabled()).toBe(false)
    expect(nativeListRenameControlsEnabled(null)).toBe(false)
  })

  test('rejects either missing or unverified independent catalog stage', () => {
    const {
      temporaryCatalogReadBack: _temporaryCatalogReadBack,
      ...withoutTemporaryCatalogReadBack
    } = proof
    const {
      restorationCatalogReadBack: _restorationCatalogReadBack,
      ...withoutRestorationCatalogReadBack
    } = proof

    expect(
      nativeListRenameControlsEnabled(asCapabilityProof(withoutTemporaryCatalogReadBack))
    ).toBe(false)
    expect(
      nativeListRenameControlsEnabled(asCapabilityProof(withoutRestorationCatalogReadBack))
    ).toBe(false)
    expect(
      nativeListRenameControlsEnabled(
        asCapabilityProof({...proof, temporaryCatalogReadBack: 'unverified'})
      )
    ).toBe(false)
    expect(
      nativeListRenameControlsEnabled(
        asCapabilityProof({...proof, restorationCatalogReadBack: 'unverified'})
      )
    ).toBe(false)
  })

  test('enables controls only after every independent rename proof is complete', () => {
    expect(nativeListRenameControlsEnabled(proof)).toBe(true)

    for (const key of Object.keys(proof) as Array<keyof ListRenameCapabilityProof>) {
      expect(
        nativeListRenameControlsEnabled(asCapabilityProof({...proof, [key]: 'unverified'}))
      ).toBe(false)
    }
  })
})

function asCapabilityProof(value: unknown): ListRenameCapabilityProof {
  return value as ListRenameCapabilityProof
}
