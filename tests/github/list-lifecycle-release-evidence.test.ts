import {describe, expect, test} from 'bun:test'
import {nativeListLifecycleControlsEnabled} from '../../src/github/list-lifecycle-capability'
import {
  releaseNativeListLifecycleCapabilityProof,
  validateNativeListLifecycleReleaseEvidence
} from '../../src/github/list-lifecycle-release-evidence'

const completeEvidence = {
  schema: 'available',
  oauthUserScope: 'verified',
  accountOwnership: 'verified',
  createReadBack: 'verified',
  deleteReadBack: 'verified'
} as const

describe('native List lifecycle release evidence', () => {
  test('keeps the reviewed build input null until manual verification is complete', () => {
    expect(releaseNativeListLifecycleCapabilityProof()).toBeNull()
    expect(nativeListLifecycleControlsEnabled(releaseNativeListLifecycleCapabilityProof())).toBe(false)
  })

  test('accepts only an exact null-prototype non-secret proof and returns its canonical frozen proof', () => {
    const evidence = Object.assign(Object.create(null) as object, completeEvidence)
    const proof = validateNativeListLifecycleReleaseEvidence(evidence)

    expect(proof).toEqual(completeEvidence)
    expect(Object.getPrototypeOf(proof)).toBeNull()
    expect(Object.isFrozen(proof)).toBe(true)
    expect(validateNativeListLifecycleReleaseEvidence(proof)).toBe(proof)
  })

  test('fails closed for absent, malformed, incomplete, unexpected, inherited, and accessor evidence', () => {
    const accessorEvidence = Object.assign(Object.create(null) as object, completeEvidence)
    Object.defineProperty(accessorEvidence, 'schema', {enumerable: true, get: () => 'available'})
    const inheritedEvidence = Object.assign(Object.create({accessToken: 'secret'}) as object, completeEvidence)

    for (const evidence of [
      null,
      completeEvidence,
      Object.create(null),
      Object.assign(Object.create(null) as object, {...completeEvidence, createReadBack: 'unverified'}),
      Object.assign(Object.create(null) as object, {...completeEvidence, accessToken: 'secret'}),
      Object.assign(Object.create(null) as object, {...completeEvidence, [Symbol('credential')]: 'secret'}),
      inheritedEvidence,
      accessorEvidence,
      []
    ]) {
      expect(validateNativeListLifecycleReleaseEvidence(evidence)).toBeNull()
    }
  })

  test('does not invoke hostile evidence accessors or leak secret material', () => {
    const evidence = new Proxy(Object.create(null), {
      ownKeys: () => { throw new Error('gho_lifecycle_release_secret') }
    })
    expect(validateNativeListLifecycleReleaseEvidence(evidence)).toBeNull()
  })
})
