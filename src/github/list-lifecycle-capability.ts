export interface ListLifecycleCapabilityProof {
  readonly schema: 'available'
  readonly oauthUserScope: 'verified'
  readonly accountOwnership: 'verified'
  readonly createReadBack: 'verified'
  readonly deleteReadBack: 'verified'
}

/** A lifecycle proof is independent from membership proof. */
export function nativeListLifecycleControlsEnabled(
  proof: ListLifecycleCapabilityProof | null = null
): boolean {
  return proof?.schema === 'available' &&
    proof.oauthUserScope === 'verified' &&
    proof.accountOwnership === 'verified' &&
    proof.createReadBack === 'verified' &&
    proof.deleteReadBack === 'verified'
}
