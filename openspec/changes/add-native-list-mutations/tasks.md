## 1. Confirm mutation prerequisites

- [ ] 1.1 Confirm `build-star-manager-core` and `add-safe-unstar-workflows` are implemented and their native-list import, GitHub authentication, stable repository identity, and durable queue contracts are available.
- [ ] 1.2 Review the recorded development GitHub App capability spike and keep production membership controls disabled unless `updateUserListsForItem` and independent read-back succeeded with the intended permission.
- [ ] 1.3 Add disposable fixture setup and cleanup guidance for manually testing List mutations without touching existing user Lists or memberships.

## 2. Implement membership intent and set logic

- [ ] 2.1 Define account-bound add, remove, and move intents plus canonical before, desired, and observed membership sets and fingerprints covering referenced List identity, existence, name, and visibility.
- [ ] 2.2 Implement pure deduplicated add as live union additions, with existing destinations reported as no-ops.
- [ ] 2.3 Implement pure remove as live minus explicit removals, with absent memberships reported as no-ops.
- [ ] 2.4 Implement pure move as live minus source union destination, rejecting moves whose source is absent while preserving every unrelated membership.
- [ ] 2.5 Add exhaustive unit tests for empty sets, duplicates, destination already present, source absent, multiple unrelated memberships, and order-independent comparison.

## 3. Build stable membership observations

- [ ] 3.1 Extend native-list synchronization to produce one complete repository-to-List observation only after all current Lists and required item pages finish successfully, while marking it non-atomic.
- [ ] 3.2 Require two consecutive complete observations with identical selected-repository membership sets and relevant List catalog fingerprints, retry within a bounded policy, and report persistent mismatch as unstable.
- [ ] 3.3 Represent stable, changing, partial, interrupted, unavailable, and rate-limited membership observation states without treating missing partial data as absence.
- [ ] 3.4 Add stable-observation APIs for selected repositories and batch previews with canonical set fingerprints and capture intervals.
- [ ] 3.5 Test membership changes during list pagination, consecutive mismatch, eventual stability, independent item cursors, multiple memberships, inaccessible items, deleted Lists, interrupted scans, malformed pages, and GraphQL rate limits.

## 4. Implement the GraphQL membership mutation boundary

- [ ] 4.1 Add validated GraphQL contracts for `updateUserListsForItem` input and payload using repository node ID and complete desired List IDs.
- [ ] 4.2 Map schema absence, permission failure, invalid IDs, rate limits, server errors, network ambiguity, and malformed payloads into sanitized mutation results.
- [ ] 4.3 Implement independent bounded consecutive post-mutation membership observations rather than treating the mutation payload as sufficient verification.
- [ ] 4.4 Verify real add, remove, and move behavior only with disposable public repositories and Lists, including preservation of unrelated memberships.

## 5. Extend durable queue execution

- [ ] 5.1 Add a versioned queue and history migration for owning GitHub user ID, membership intent, confirmed sets, desired sets, observed sets, membership and List catalog fingerprints, `needs-confirmation`, unstable-observation, and verification-conflict details.
- [ ] 5.2 Persist account-bound membership jobs before execution, suspend jobs and owner-scoped mid-flight recovery while their owner is not active, and prevent overlapping active unstar or membership jobs for the same account and repository.
- [ ] 5.3 Before mutation, obtain a latest stable observation and move the job to `needs-confirmation` without writing when its before-set or relevant List catalog differs from the confirmed fingerprint; block the job when bounded observations remain unstable.
- [ ] 5.4 Submit the complete desired set only after the latest bounded stable observation and relevant List catalog match the confirmed values and the repository is still publicly accessible and starred.
- [ ] 5.5 On matching read-back, transactionally update local memberships, finalize the job, and append verified history without changing local annotations.
- [ ] 5.6 On read-back mismatch, update the local mirror to observed GitHub state, record desired versus observed conflict details, and require a new preview before retry.
- [ ] 5.7 Recover interrupted observation, mutation, and verification states through bounded fresh observation before retrying and respect shared sequential execution and rate-limit pauses.

## 6. Add membership management UI

- [ ] 6.1 Add existing native List selection to repository inspection and multi-row selection while clearly separating native Lists from local tags.
- [ ] 6.2 Make additive assignment the primary action and show existing destinations as no-ops without creating unnecessary jobs.
- [ ] 6.3 Add explicit remove and move controls with destructive styling and source-membership validation.
- [ ] 6.4 Build per-repository single and bulk previews showing current, resulting, added, removed, and unchanged Lists plus exact affected repositories.
- [ ] 6.5 Display the replace-all and concurrent-edit limitation for every add, remove, and move confirmation without claiming stronger GitHub isolation, while reserving destructive styling for remove and move.
- [ ] 6.6 Add `needs-confirmation` refreshed previews that preserve original user intent but require new confirmation before execution.
- [ ] 6.7 Display observation and stability progress, changing or incomplete safety blocks, queued work, verified success, partial batch outcomes, and desired-versus-observed conflicts.
- [ ] 6.8 Keep native List lifecycle controls limited to membership add, remove, and move; do not expose create, rename, visibility, or delete actions.

## 7. Verify conflict, lifecycle, and cross-browser behavior

- [ ] 7.1 Test unstable observations and stale preview detection for external add, external remove, List deletion, List rename, visibility change, changes during pagination, and local queue delay using membership and relevant List catalog fingerprints.
- [ ] 7.2 Test post-write mismatch, mutation-payload mismatch, rate limiting, service-worker termination, authorization expiry, schema unavailability, and account switching before mutation, after mutation, and before read-back with owner-scoped recovery on return.
- [ ] 7.3 Test partial bulk completion and confirm successful jobs are not rolled back when another job needs confirmation or conflicts.
- [ ] 7.4 Test interaction with queued or completed unstar jobs and reject membership mutation when the repository is no longer starred.
- [ ] 7.5 Test that native membership changes never alter tags, notes, favorites, triage state, revisit dates, or review history.
- [ ] 7.6 Run static checks, typecheck, tests, and Chromium and Firefox builds with Extension.js telemetry disabled.
- [ ] 7.7 Manually verify add, remove, move, unrelated-membership preservation, stale reconfirmation, mismatch reporting, restart recovery, and read-only fallback in isolated profiles.
- [ ] 7.8 Update README, privacy/store documentation, and manual test guidance with preview API status, replace-all semantics, public-only scope, and the concurrent-edit limitation.
