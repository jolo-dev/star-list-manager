## Why

Users need to organize repositories without returning to GitHub's awkward Star List controls, but GitHub's mutation replaces an item's complete List membership set. Safe add, remove, and move operations therefore require a stable repeated membership observation, explicit previews, full-set preservation, durable execution, and read-back verification.

## What Changes

- Add native GitHub List membership actions for accessible public starred repositories.
- Support additive assignment, explicit removal, and explicit move between Lists while preserving every unrelated membership observed in the final stable pre-write observation.
- Refresh remote memberships before presenting or executing a destructive membership change and require reconfirmation when the preview becomes stale.
- Submit the complete desired List ID set through `updateUserListsForItem`, then read back and compare the resulting membership set.
- Execute single and bulk membership jobs through the durable sequential mutation queue with per-repository outcomes and retry behavior.
- Surface capability unavailable, partial List visibility, conflict, and verification-mismatch states without falling back to GitHub DOM, cookies, or internal endpoints.
- Explicitly disclose that multi-request membership observation is not atomic and GitHub's replace-all mutation cannot prevent a concurrent edit during observation, between the final observation and write, or during read-back.
- Exclude native List creation, rename, privacy changes, and deletion from this change.

## Capabilities

### New Capabilities

- `native-list-membership`: Previewed, preservation-aware, verified add, remove, and move operations for native GitHub List membership.

### Modified Capabilities

None.

## Impact

- Extends native-list dashboard views with selection, membership previews, add/remove/move controls, conflict warnings, and verified results.
- Adds GraphQL mutation contracts and membership-specific jobs to the durable mutation queue created by `add-safe-unstar-workflows`.
- Uses the public `updateUserListsForItem` GraphQL mutation, which requires a complete target List ID set.
- Depends on complete read-only List import, stable repository node IDs, and a separate write-auth change that proves `UpdateUserListsForItem`; the core GitHub App token was denied that mutation.
- Keeps the MVP public-repository-only and does not request private repository access.
