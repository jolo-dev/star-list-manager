export interface ListRenameCapabilityProof {
  readonly schema: 'available'
  readonly oauthUserScope: 'verified'
  readonly accountOwnership: 'verified'
  readonly temporaryRenameMutation: 'verified'
  readonly restorationMutation: 'verified'
  readonly independentCatalogReadBack: 'verified'
}

export function nativeListRenameControlsEnabled(
  proof: ListRenameCapabilityProof | null = null
): boolean {
  return (
    proof?.schema === 'available' &&
    proof.oauthUserScope === 'verified' &&
    proof.accountOwnership === 'verified' &&
    proof.temporaryRenameMutation === 'verified' &&
    proof.restorationMutation === 'verified' &&
    proof.independentCatalogReadBack === 'verified'
  )
}
