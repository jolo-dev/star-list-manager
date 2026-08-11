import {describe, expect, test} from 'bun:test'
import {nativeListMembershipControlsEnabled} from '../../src/github/list-membership-capability'
import {
  releaseNativeListMembershipCapabilityProof,
  validateNativeListMembershipReleaseEvidence
} from '../../src/github/list-membership-release-evidence'

const completeEvidence = {
  schema: 'available',
  oauthUserScope: 'verified',
  accountOwnership: 'verified',
  unchangedSetMutation: 'verified',
  independentReadBack: 'verified'
} as const

describe('native List membership release evidence', () => {
  test('returns the complete reviewed capability proof', () => {
    expect(releaseNativeListMembershipCapabilityProof()).toEqual(completeEvidence)
    expect(validateNativeListMembershipReleaseEvidence(completeEvidence)).toEqual(completeEvidence)
  })

  test('rejects partial and malformed evidence', () => {
    for (const evidence of [
      null,
      {},
      {schema: 'available'},
      {...completeEvidence, independentReadBack: 'unverified'},
      'available',
      []
    ]) {
      expect(validateNativeListMembershipReleaseEvidence(evidence)).toBeNull()
    }
  })

  test('rejects unknown and credential-bearing evidence keys', () => {
    for (const key of ['accessToken', 'deviceCode', 'user', 'fixture']) {
      expect(
        validateNativeListMembershipReleaseEvidence({...completeEvidence, [key]: 'secret'})
      ).toBeNull()
    }
  })

  test('enables native List membership controls with reviewed release evidence', () => {
    expect(nativeListMembershipControlsEnabled(releaseNativeListMembershipCapabilityProof())).toBe(true)
  })
})
