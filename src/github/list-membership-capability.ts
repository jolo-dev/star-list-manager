export interface ListMembershipCapabilityProof {
  readonly schema: 'available'
  readonly oauthUserScope: 'verified'
  readonly accountOwnership: 'verified'
  readonly unchangedSetMutation: 'verified'
  readonly independentReadBack: 'verified'
}

export function nativeListMembershipControlsEnabled(
  proof: ListMembershipCapabilityProof | null = null
): boolean {
  return (
    proof?.schema === 'available' &&
    proof.oauthUserScope === 'verified' &&
    proof.accountOwnership === 'verified' &&
    proof.unchangedSetMutation === 'verified' &&
    proof.independentReadBack === 'verified'
  )
}
