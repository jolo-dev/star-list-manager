# Manual Release Checklist

Use isolated Chromium and Firefox profiles. Use disposable stars and Lists for state-change scenarios. Never paste tokens into screenshots or bug reports.

## Assisted Verification Evidence

On 2026-08-03, isolated headless Chromium and Firefox profiles completed real GitHub device authorization and read-only star/List synchronization. Firefox additionally completed multi-character local search and disconnect. A separate Chromium fixture profile verified first run, device-code cancellation, ready-state rendering, historical Organized/Backlog plus later Inbox and Due queues, stale-data retention, partial and unavailable native List states, built-in navigation, repository inspection, annotation persistence after a background round trip and restart, deterministic import conflict preview/application, mobile layout without horizontal overflow, and complete deletion back to first run. No browser console errors were observed.

A controlled Chromium profile then ran the production background services against deterministic GitHub responses. It verified one refresh for concurrent star/List requests, retained authoritative data while stars changed between REST pages, reconciliation only after two observations converged, partial first-import classification, later Inbox discovery, disconnect with retained annotations, isolated account switching with automatic first sync, and unavailable Lists for the second account. This found and fixed an account-switch regression in the dashboard auto-sync guard. The generated fixture background was removed by a clean production rebuild before the final checks.

The remaining unchecked items below are broader release exploration beyond the core change's completed verification matrix.

## Installation and First Run

- [x] Load the unpacked Chromium build and temporary Firefox add-on.
- [ ] Confirm the toolbar action opens or focuses one dashboard tab.
- [x] Confirm first run explains public-only, read-only, and local-first behavior.
- [ ] Confirm no content script appears on GitHub or another website.

## Authentication

- [x] Complete device authorization and confirm only the user code is rendered.
- [ ] Deny and expire separate device codes and confirm recoverable states.
- [x] Cancel a pending authorization.
- [x] Trigger concurrent authenticated requests near token expiry and confirm one refresh.
- [x] Disconnect and confirm credentials are removed while annotations remain.
- [x] Sign into another account and confirm namespaces do not merge.

## Optional Starring Authorization

- [x] Confirm Settings discloses that `public_repo` is broader than the Starring-only implementation.
- [x] Cancel the local disclosure and confirm no write credential is created.
- [ ] Cancel a pending OAuth device flow and confirm read-only synchronization remains usable.
- [x] Authorize the same GitHub account and confirm readiness without token material in the DOM or console.
- [ ] Attempt authorization with another GitHub account and confirm account-mismatch rejection.
- [x] Disconnect write access and confirm read sign-in remains while the write credential is removed.
- [ ] Disconnect GitHub and confirm both active credentials are removed while local data remains.
- [ ] Revoke the OAuth App in GitHub settings and confirm the next write request requires reauthorization.
- [x] Run the disposable OAuth Starring probe and independently confirm restoration.

## Synchronization

- [x] Complete two matching star observations and confirm the baseline.
- [x] Add or remove a disposable star between REST pages and confirm omissions are not reconciled until observations converge.
- [x] Interrupt synchronization and confirm the previous library remains usable and stale.
- [ ] Confirm private repositories are not stored or displayed.
- [ ] Verify rate-limit reset information appears after a simulated or real limit response.

## Safe Unstar

- [ ] Select one starred repository and confirm selection changes no local or remote state.
- [ ] Select multiple repositories and confirm the preview shows the exact count and complete owner/name list.
- [ ] Cancel the preview and confirm no batch or job is created.
- [ ] Confirm one disposable unstar and verify the repository remains in active views until two complete observations confirm absence.
- [ ] Confirm a bulk operation with mixed outcomes and verify successful jobs are not rolled back.
- [ ] Cancel a queued job and reject cancellation after checking or deletion begins.
- [ ] Close the dashboard and restart the extension during separate queued, checking, deleting, and verifying scenarios.
- [ ] Verify authentication and permission failures stop automatic retries.
- [ ] Verify rate-limited work resumes at or after the recorded reset.
- [ ] Verify stale owner/name routing is refreshed by stable repository node ID.
- [ ] Verify blocked-unknown leaves local starred state unchanged and offers no automatic retry.
- [ ] Verify successful and externally completed unstars retain notes, tags, favorites, triage, and revisit history.
- [ ] Review repository and global Operations history and confirm there is no Undo or re-star control.

## Native Lists

- [ ] Import multiple Lists and a repository belonging to multiple Lists.
- [ ] Verify independent List and item pagination with a sufficiently large fixture account.
- [ ] Verify an account with no Lists.
- [x] Verify unavailable schema/capability handling without fallback requests.
- [x] Verify partial List coverage does not disclose inaccessible item details.

## Triage and Discovery

- [x] Confirm listed historical stars become reviewed/Organized and others become Backlog.
- [x] Confirm a later star enters Inbox and resync does not reset local triage.
- [ ] Search owner, name, description, topic, language, List, tag, and note text.
- [ ] Combine triage, star state, List/tag, language, archive/disabled, and date filters.
- [ ] Verify deterministic name, star, push, and review sorting.
- [ ] Use keyboard and mouse navigation, repository selection, annotation editing, and triage controls.
- [ ] Verify empty-library, no-result, stale, partial-List, and recoverable-error states.
- [x] Restart each browser and confirm local annotations and Due calculations recover.

## Portability and Deletion

- [ ] Export and inspect JSON to confirm no token, device code, or authorization header is present.
- [x] Preview and apply newer, equal, and older annotation conflicts and confirm deterministic counts.
- [ ] Confirm imported metadata only fills missing history and does not replace synchronized fields.
- [ ] Confirm settings change only when selected in the preview.
- [ ] Reject a different-account export without changing either namespace.
- [ ] Cancel complete deletion and confirm no changes.
- [x] Confirm complete deletion removes credentials, IndexedDB, settings, sync state, and badge, then returns to first run.
