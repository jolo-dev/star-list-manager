export interface ListRenameCapabilityProof {
  readonly schema: 'available'
  readonly oauthUserScope: 'verified'
  readonly accountOwnership: 'verified'
  readonly unchangedNameMutation: 'verified'
  readonly independentReadBack: 'verified'
}

export function nativeListRenameControlsEnabled(
  proof: ListRenameCapabilityProof | null = null
): boolean {
  return (
    proof?.schema === 'available' &&
    proof.oauthUserScope === 'verified' &&
    proof.accountOwnership === 'verified' &&
    proof.unchangedNameMutation === 'verified' &&
    proof.independentReadBack === 'verified'
  )
}
