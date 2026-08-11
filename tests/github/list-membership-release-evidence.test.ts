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
  test('returns a complete immutable reviewed capability proof that validates itself', () => {
    const proof = releaseNativeListMembershipCapabilityProof()

    expect(proof).toEqual(completeEvidence)
    expect(proof).not.toBeNull()
    expect(Object.isFrozen(proof)).toBe(true)
    expect(validateNativeListMembershipReleaseEvidence(proof)).toBe(proof)
  })

  test('rejects a normal Object.prototype-backed proof', () => {
    expect(validateNativeListMembershipReleaseEvidence(completeEvidence)).toBeNull()
  })

  test('accepts an exact null-prototype proof', () => {
    const evidence = Object.assign(Object.create(null) as object, completeEvidence)

    expect(validateNativeListMembershipReleaseEvidence(evidence)).not.toBeNull()
  })

  test('rejects a normal proof while Object.prototype is polluted', () => {
    const inheritedCredentialKey = 'taskTwoInheritedCredential'
    const originalDescriptor = Object.getOwnPropertyDescriptor(Object.prototype, inheritedCredentialKey)
    Object.defineProperty(Object.prototype, inheritedCredentialKey, {
      configurable: true,
      enumerable: true,
      value: 'secret'
    })

    try {
      expect(validateNativeListMembershipReleaseEvidence(completeEvidence)).toBeNull()
    } finally {
      if (originalDescriptor === undefined) {
        Reflect.deleteProperty(Object.prototype, inheritedCredentialKey)
      } else {
        Object.defineProperty(Object.prototype, inheritedCredentialKey, originalDescriptor)
      }
    }
  })

  test('rejects partial and malformed evidence', () => {
    for (const evidence of [
      null,
      {},
      Object.create(null),
      {schema: 'available'},
      {...completeEvidence, independentReadBack: 'unverified'},
      'available',
      []
    ]) {
      expect(validateNativeListMembershipReleaseEvidence(evidence)).toBeNull()
    }
  })

  test('rejects unknown and credential-bearing own evidence keys', () => {
    for (const key of ['accessToken', 'deviceCode', 'user', 'fixture']) {
      expect(
        validateNativeListMembershipReleaseEvidence({...completeEvidence, [key]: 'secret'})
      ).toBeNull()
    }
  })

  test('rejects inherited credential fields', () => {
    const evidence = Object.assign(Object.create({accessToken: 'secret'}) as object, completeEvidence)

    expect(validateNativeListMembershipReleaseEvidence(evidence)).toBeNull()
  })

  test('rejects non-enumerable expected fields', () => {
    const evidence = {...completeEvidence}
    Object.defineProperty(evidence, 'schema', {enumerable: false})

    expect(validateNativeListMembershipReleaseEvidence(evidence)).toBeNull()
  })

  test('rejects symbol keys', () => {
    const evidence = {...completeEvidence, [Symbol('credential')]: 'secret'}

    expect(validateNativeListMembershipReleaseEvidence(evidence)).toBeNull()
  })

  test('rejects accessor expected fields without invoking them', () => {
    const evidence = {...completeEvidence}
    Object.defineProperty(evidence, 'schema', {
      enumerable: true,
      get: () => 'available'
    })

    expect(validateNativeListMembershipReleaseEvidence(evidence)).toBeNull()
  })

  test('fails closed when a hostile proxy rejects property inspection', () => {
    const evidence = new Proxy({...completeEvidence}, {
      ownKeys: () => {
        throw new Error('inspection denied')
      }
    })

    expect(validateNativeListMembershipReleaseEvidence(evidence)).toBeNull()
  })

  test('enables native List membership controls with reviewed release evidence', () => {
    expect(nativeListMembershipControlsEnabled(releaseNativeListMembershipCapabilityProof())).toBe(true)
  })
})
