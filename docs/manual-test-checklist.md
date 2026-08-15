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

## Optional Write Authorization

- [ ] Confirm Settings discloses that `public_repo` grants broader public-repository authority, `user` grants broader profile authority, and neither authority is exposed as a general API surface.
- [x] Cancel the local disclosure and confirm no write credential is created.
- [ ] Cancel a pending OAuth device flow and confirm read-only synchronization remains usable.
- [x] Authorize the same GitHub account with `public_repo user` and confirm complete readiness without token material in the DOM or console.
- [ ] Attempt authorization with another GitHub account and confirm account-mismatch rejection.
- [x] Disconnect write access and confirm read sign-in remains while the write credential is removed.
- [ ] Disconnect GitHub and confirm both active credentials are removed while local data remains.
- [ ] Revoke the OAuth App in GitHub settings and confirm the next write request requires reauthorization.
- [x] Run the disposable OAuth Starring probe and independently confirm restoration.
- [ ] Run the disposable native List membership probe with an unchanged complete set and independently confirm the read-back without token material in output or storage.

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

GitHub native Lists use a public-preview API. Run every membership scenario only against public starred repositories and existing disposable Lists in an isolated profile. The mutation replaces the repository's complete membership set; repeated complete observations reduce ambiguity but are multi-request and non-atomic, so do not treat these checks as evidence of transactional isolation from concurrent GitHub edits.

- [ ] Import multiple Lists and a repository belonging to multiple Lists.
- [ ] Verify independent List and item pagination with a sufficiently large fixture account.
- [ ] Verify an account with no Lists.
- [x] Verify unavailable schema/capability handling without fallback requests.
- [x] Verify partial List coverage does not disclose inaccessible item details.
- [ ] In an isolated profile, create only disposable Lists and a disposable public star according to `docs/native-list-membership-fixture.md`; confirm no existing List or membership is used.
- [ ] Confirm a build with absent, unverified, malformed, or sensitive reviewed release evidence keeps native List membership controls disabled and Lists read-only.
- [ ] After reviewed release evidence is bundled, confirm same-account `user` authorization is required; verify a stored `public_repo`-only credential can still serve Starring but cannot enable membership controls.
- [ ] Preview single and bulk add operations; confirm each repository shows current, resulting, added, removed, and unchanged Lists, existing destinations are no-ops, and unrelated memberships remain in the complete resulting set.
- [ ] Preview explicit remove and move operations; confirm absent removals are no-ops, an absent move source is rejected, and a valid move removes only its source while preserving unrelated memberships.
- [ ] For every add, remove, and move confirmation, confirm the UI states that `UpdateUserListsForItem` replaces the complete set, observations are non-atomic, and concurrent GitHub edits may cause reconfirmation, instability, or conflict.
- [ ] Change membership directly on GitHub after confirmation and confirm the job performs no write, shows refreshed current/resulting sets, and requires reconfirmation. Repeat for referenced List rename, visibility change, and deletion.
- [ ] Confirm successful mutation is reported only after an independent repeated stable read-back of the complete desired set.
- [ ] Force a post-write desired-versus-observed mismatch and confirm a verification conflict displays both sets, updates the local mirror to observed GitHub membership, and requires a new preview before retry.
- [ ] Change membership during List or item pagination and confirm incomplete or non-matching repeated observations block preview, mutation, or verification rather than treating missing data as absence.
- [ ] Confirm add, remove, move, stale reconfirmation, conflict, restart recovery, and partial bulk outcomes retain tags, notes, favorites, triage state, revisit dates, and review history.
- [ ] Confirm there are no native List create, delete, or visibility controls. Membership capability proof must not expose rename controls.

## Guarded Native List Rename

The owner-bound `UpdateUserList` transport, reconciliation, and inline editor are implemented, but rename is not release-enabled. No live device authorization, permission proof, temporary mutation, disposable rename probe, or write proof has been performed for rename. The default `.env` build flag is `EXTENSION_PUBLIC_GITHUB_LIST_RENAME_ENABLED=false`; a separate membership proof does not enable rename.

- [ ] In clean isolated Chromium and Firefox profiles with no rename proof, confirm imported Lists remain read-only and no Edit control is available.
- [ ] Before any future probe, use a development-only GitHub account in an isolated browser profile and explicitly confirm one disposable existing List. Record its exact node ID, original name, same-account user ID, and a unique temporary name; do not use an important or shared List.
- [ ] Run the rename probe only with its explicit disposable-List confirmation and verify schema availability, `user` permission, and same-account ownership without displaying tokens, device codes, authorization headers, or raw credential responses.
- [ ] Independently read the complete List catalog after the temporary rename and again after restoration. Confirm the same List ID has the exact unique temporary name first and the exact original name after restoration.
- [ ] If the temporary rename, either read-back, or restoration cannot be verified, stop: manually inspect and restore the disposable List before treating any proof as valid or enabling a gate.
- [ ] Only after that separate proof, use a manually gated isolated test build; confirm the default-disabled build remains unchanged for general-user and release builds.
- [ ] In the gated isolated build, select an existing disposable List detail header and confirm Edit moves focus to the inline input, announces the current List name, and leaves the sidebar navigation-only.
- [ ] Verify whitespace-only names, blank names, and names duplicating another List under case-insensitive Unicode-normalized comparison do not dispatch a request. Verify a valid, distinct user-supplied name is not rewritten except for surrounding whitespace trimming.
- [ ] Verify Cancel and Escape preserve the existing name, clear validation feedback, and return focus to Edit. Verify Save shows pending/busy state and prevents a double submit.
- [ ] Force server rejection, deleted-List, account-change, ambiguous-response, and divergent read-back paths. Confirm no optimistic local rename, a sanitized inline result, authoritative refresh when available, and a fresh explicit Save is required rather than automatic retry.
- [ ] Complete a valid disposable rename and independently verify the same List ID and exact name in the header, sidebar, and a reload. Confirm concurrent external rename/read-back mismatch shows the observed authoritative name rather than overwriting it locally.
- [ ] Switch accounts or navigate/refresh while Save is pending. Confirm stale input exits without becoming a saved change and no rename is sent for the wrong account.
- [ ] Confirm rename does not create, delete, change visibility of, or change membership for any List; it must not alter local tags, notes, favorites, triage state, revisit dates, review history, or repository data.

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
