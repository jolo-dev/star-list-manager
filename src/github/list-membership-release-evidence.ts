import {type ListMembershipCapabilityProof} from './list-membership-capability'

const canonicalReleaseEvidence = Object.freeze({
  schema: 'available',
  oauthUserScope: 'verified',
  accountOwnership: 'verified',
  unchangedSetMutation: 'verified',
  independentReadBack: 'verified'
} as const satisfies ListMembershipCapabilityProof)

// This is a release-time build input. Set it to null when the evidence is absent or unverified.
const reviewedReleaseEvidenceBuildInput: unknown | null = canonicalReleaseEvidence

const evidenceRequirements = [
  ['schema', 'available'],
  ['oauthUserScope', 'verified'],
  ['accountOwnership', 'verified'],
  ['unchangedSetMutation', 'verified'],
  ['independentReadBack', 'verified']
] as const

export function validateNativeListMembershipReleaseEvidence(
  value: unknown
): ListMembershipCapabilityProof | null {
  if (typeof value !== 'object' || value === null) return null

  try {
    if (Object.getPrototypeOf(value) !== Object.prototype) return null

    const ownKeys = Reflect.ownKeys(value)
    if (ownKeys.length !== evidenceRequirements.length) return null

    for (const [key, expectedValue] of evidenceRequirements) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key)
      if (
        descriptor === undefined ||
        !descriptor.enumerable ||
        !('value' in descriptor) ||
        descriptor.value !== expectedValue
      ) {
        return null
      }
    }
  } catch {
    return null
  }

  return canonicalReleaseEvidence
}

export function releaseNativeListMembershipCapabilityProof(): ListMembershipCapabilityProof | null {
  return validateNativeListMembershipReleaseEvidence(reviewedReleaseEvidenceBuildInput)
}
