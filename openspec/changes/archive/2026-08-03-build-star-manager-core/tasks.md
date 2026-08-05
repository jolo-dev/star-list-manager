## 1. Establish the verified project baseline

- [x] 1.1 Add Bun scripts for formatting or static checks used by the project, TypeScript checking, unit tests, Chromium and Firefox builds, and a single `check` command with Extension.js telemetry disabled.
- [x] 1.2 Tighten TypeScript compiler checks, add declarations for browser globals and imported assets, prohibit application `any`, and retain `unknown` for validated external boundaries.
- [x] 1.3 Add test helpers and fixtures for typed JSON decoding, extension messages, clocks, and GitHub HTTP responses without introducing a UI test framework.
- [x] 1.4 Register a development GitHub App with device flow and user-level Starring read permission, keeping its public client ID in documented extension configuration rather than source-secret files.
- [x] 1.5 Run and document a capability spike proving device authorization, access-token refresh without a client secret, public `GET /user/starred`, and read-only `viewer.lists` access.
- [x] 1.6 Using disposable test fixtures only, determine whether the same GitHub App permission can call `updateUserListsForItem`; record the result for the later mutation change without exposing tokens or changing existing Lists.

## 2. Replace the template extension shell

- [x] 2.1 Restrict the manifest to extension-owned pages and GitHub login/API hosts, remove `<all_urls>` and content-script injection, and declare only the storage and toolbar capabilities needed by the core.
- [x] 2.2 Add the full-page dashboard entrypoint and make the Chromium and Firefox toolbar actions open or focus it.
- [x] 2.3 Add a cross-browser platform adapter for runtime messages, storage, toolbar badge updates, and dashboard tab creation.
- [x] 2.4 Define discriminated dashboard-to-background request and response contracts with validation and sanitized error types.
- [x] 2.5 Replace generated template logging, placeholder branding, and sidebar content with Star List Manager first-run and loading states.

## 3. Build the domain and storage foundation

- [x] 3.1 Define repository, native List, membership, annotation, triage, authentication, synchronization, settings, and export domain types namespaced by stable authenticated GitHub user ID and keyed by repository or List node ID where applicable.
- [x] 3.2 Create IndexedDB schema version 1 with account-namespaced repositories, native Lists, native memberships, annotations, sync state, auth state, and settings stores plus required indexes.
- [x] 3.3 Implement transactional storage operations and migration tests covering empty databases, upgrades, rollback on failure, and lookup by repository, List, tag, and triage state.
- [x] 3.4 Implement validated decoders for extension messages, GitHub REST payloads, GitHub GraphQL payloads, and import files before mapping them into domain records.
- [x] 3.5 Add sanitized application error mapping that preserves actionable status and rate-limit information without retaining credentials or raw sensitive responses.

## 4. Implement GitHub device authentication

- [x] 4.1 Implement device-code creation, polling interval and `slow_down` handling, cancellation, expiry, denial, and successful identity validation in extension-owned contexts.
- [x] 4.2 Persist access and refresh token metadata locally, implement single-flight refresh without a client secret, atomically rotate token pairs with generation checks, retry an authenticated operation once, and clear credentials only when the rejected pair is still current.
- [x] 4.3 Reject untrusted or malformed credential-bearing messages and add tests proving credentials never appear in UI responses, logs, errors, or exports.
- [x] 4.4 Add dashboard sign-in, pending authorization, expired or denied authorization, signed-in identity, reauthentication, and confirmed disconnect states, with account switching selecting isolated retained namespaces.

## 5. Synchronize the public star library

- [x] 5.1 Implement the GitHub REST client with API version `2026-03-10`, star timestamp media type, pagination, conditional metadata where useful, and typed rate-limit extraction.
- [x] 5.2 Implement full public-star observations that stage and deduplicate pages, require two consecutive matching node ID sets for convergence, coalesce duplicate refreshes, and retain the previous authoritative library after interruption or instability.
- [x] 5.3 Reconcile external stars and only converged external omissions while preserving annotations and update renamed or transferred repositories by stable node ID.
- [x] 5.4 Exclude private repositories from persistence, record skipped out-of-scope items, and test mixed-visibility responses.
- [x] 5.5 Persist and expose observation attempts, convergence status, completion timestamps, page counts, stale status, rate limits, and sanitized failures.

## 6. Import native GitHub Lists

- [x] 6.1 Implement the GraphQL client and a capability probe for viewer List access without cookie, DOM, or undocumented internal endpoint fallbacks.
- [x] 6.2 Import paginated List metadata, then paginate each List's item connection independently and store public memberships by repository node ID.
- [x] 6.3 Detect partial Lists when reported counts exceed accessible items and expose unavailable, partial, complete, and stale List-sync states.
- [x] 6.4 Reconcile List rename, metadata changes, membership changes, and deletion without changing repository annotations.
- [x] 6.5 Add tests for multiple memberships, list and item pagination, no-list accounts, partial visibility, malformed data, schema unavailability, and interrupted synchronization.

## 7. Implement triage and local annotations

- [x] 7.1 Apply first-import classification only after a converged star baseline and complete, partial, or unavailable List resolution: observed listed historical stars become reviewed/Organized, other historical stars become Backlog, and partial coverage remains visible.
- [x] 7.2 Classify repositories discovered after the baseline as Inbox and test that a resync does not reset an existing user's triage state.
- [x] 7.3 Implement reviewed, Backlog, snoozed, and due transitions plus local tags, note, favorite, review timestamp, and revisit date editing.
- [x] 7.4 Derive Inbox, Backlog, Due, and Organized counts locally and update the toolbar badge without notification permission.
- [x] 7.5 Test local annotations across metadata refresh, repository rename, external unstar, re-star, List changes, and extension restart.

## 8. Build the repository discovery dashboard

- [x] 8.1 Build responsive fixed dashboard navigation for Inbox, Backlog, Due, Organized, All Stars, native Lists, local tags, Settings, and visible result counts without custom saved-query management.
- [x] 8.2 Implement local search across repository metadata, native List names, tags, and notes with composable filters and deterministic sorting.
- [x] 8.3 Build repository result rows and an inspection/editor surface showing synchronized metadata, memberships, annotations, triage controls, and a safe GitHub link.
- [x] 8.4 Implement first-run, signed-out, loading, empty-library, ready, stale, partial-native-list, no-result, and recoverable-error presentation states.
- [x] 8.5 Add keyboard and mouse accessibility for navigation, search, selection, annotation editing, and triage actions without adding remote mutation controls.
- [x] 8.6 Add pure-function and DOM behavior tests for views, queries, filters, sorting, due calculations, result counts, and empty or error states.

## 9. Add local data portability and deletion

- [x] 9.1 Define and document a versioned account-namespaced JSON export schema that includes the active GitHub user ID, non-secret library metadata, and local data but excludes all authentication material.
- [x] 9.2 Implement export generation and tests proving credentials and authorization headers cannot be serialized.
- [x] 9.3 Implement complete-file validation, account-identity matching, deterministic impact preview, and non-destructive import merging: newer annotation timestamps win, equal timestamps keep local data, imported metadata only fills missing history, and settings require explicit selection.
- [x] 9.4 Implement separately confirmed complete local-data removal that clears credentials, IndexedDB, settings, sync state, and badges, then returns to first-run state.

## 10. Verify cross-browser behavior and documentation

- [x] 10.1 Run the complete unit test and typecheck suite and produce successful Chromium and Firefox builds with telemetry disabled.
- [x] 10.2 Inspect built manifests to confirm there is no `<all_urls>`, content script, private-repository access, third-party host, remote code, analytics, or bundled secret.
- [x] 10.3 Manually verify first run, concurrent token refresh, converged first sync, star changes between REST pages, partial first-import classification, later Inbox discovery, List unavailability, partial Lists, search, triage, restart recovery, deterministic import conflicts, disconnect, and complete deletion in isolated browser profiles.
- [x] 10.4 Update README, STORE, privacy documentation, and a manual test checklist with exact permissions, public-only scope, browser-local storage limitations, GitHub preview caveats, and data removal instructions.
- [x] 10.5 Add CI that installs with Bun and runs static checks, typecheck, tests, and Chromium and Firefox builds with Extension.js telemetry disabled.
