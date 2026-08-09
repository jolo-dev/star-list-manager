import {describe, expect, test} from 'bun:test'
import {
  nativeListMembershipControlsEnabled,
  type ListMembershipCapabilityProof
} from '../../src/github/list-membership-capability'

const proof: ListMembershipCapabilityProof = {
  schema: 'available',
  oauthUserScope: 'verified',
  accountOwnership: 'verified',
  unchangedSetMutation: 'verified',
  independentReadBack: 'verified'
}

describe('native List membership capability gate', () => {
  test('keeps production controls disabled by default without complete proof', () => {
    expect(nativeListMembershipControlsEnabled()).toBe(false)
    expect(nativeListMembershipControlsEnabled(null)).toBe(false)
  })

  test('enables future controls only for complete capability proof', () => {
    expect(nativeListMembershipControlsEnabled(proof)).toBe(true)
  })
})
