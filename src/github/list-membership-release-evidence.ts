import {type ListMembershipCapabilityProof} from './list-membership-capability'

const releaseEvidence = {
  schema: 'available',
  oauthUserScope: 'verified',
  accountOwnership: 'verified',
  unchangedSetMutation: 'verified',
  independentReadBack: 'verified'
} as const satisfies ListMembershipCapabilityProof

const evidenceKeys = [
  'schema',
  'oauthUserScope',
  'accountOwnership',
  'unchangedSetMutation',
  'independentReadBack'
] as const

export function validateNativeListMembershipReleaseEvidence(
  value: unknown
): ListMembershipCapabilityProof | null {
  if (typeof value !== 'object' || value === null || Reflect.ownKeys(value).length !== evidenceKeys.length) {
    return null
  }

  const evidence = value as Record<string, unknown>
  if (!evidenceKeys.every((key) => Object.hasOwn(evidence, key))) return null

  if (
    evidence.schema === 'available' &&
    evidence.oauthUserScope === 'verified' &&
    evidence.accountOwnership === 'verified' &&
    evidence.unchangedSetMutation === 'verified' &&
    evidence.independentReadBack === 'verified'
  ) {
    return releaseEvidence
  }

  return null
}

export function releaseNativeListMembershipCapabilityProof(): ListMembershipCapabilityProof {
  return releaseEvidence
}
