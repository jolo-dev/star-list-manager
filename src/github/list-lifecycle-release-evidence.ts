import type {ListLifecycleCapabilityProof} from './list-lifecycle-capability'

const evidenceRequirements = [
  ['schema', 'available'],
  ['oauthUserScope', 'verified'],
  ['accountOwnership', 'verified'],
  ['createReadBack', 'verified'],
  ['deleteReadBack', 'verified']
] as const

const canonicalReleaseEvidence = Object.freeze(
  Object.assign(
    Object.create(null) as object,
    {
      schema: 'available',
      oauthUserScope: 'verified',
      accountOwnership: 'verified',
      createReadBack: 'verified',
      deleteReadBack: 'verified'
    } as const satisfies ListLifecycleCapabilityProof
  )
)

// Release-time build input. It remains null until a maintainer reviews sanitized manual probe evidence.
const reviewedReleaseEvidenceBuildInput: unknown | null = null

export function validateNativeListLifecycleReleaseEvidence(
  value: unknown
): ListLifecycleCapabilityProof | null {
  if (typeof value !== 'object' || value === null) return null

  try {
    if (Object.getPrototypeOf(value) !== null) return null
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

export function releaseNativeListLifecycleCapabilityProof(): ListLifecycleCapabilityProof | null {
  return validateNativeListLifecycleReleaseEvidence(reviewedReleaseEvidenceBuildInput)
}
