## 1. Define lifecycle contracts and migration

- [x] 1.1 Add `NativeListLifecycleIntent`, operation phases, verification outcomes, and sanitized lifecycle details to `src/domain/types.ts`; keep repository mutation types unchanged rather than using synthetic repository jobs.
- [x] 1.2 Add a versioned `nativeListLifecycleOperations` IndexedDB store, account/status indexes, validation, and account/data-deletion coverage in `src/storage/database.ts` and `src/storage/library.ts`.
- [x] 1.3 Expand migration and persistence tests in `tests/storage/native-list-lifecycle-operations.test.ts` to cover create intent, delete snapshot, terminal history, account isolation, active-operation uniqueness, account deletion, and complete local-data deletion.
- [x] 1.4 Implement the minimal storage API and run `bun test tests/storage/native-list-lifecycle-operations.test.ts` until it passes.

## 2. Create the narrow OAuth lifecycle transport

- [x] 2.1 Add failing tests in `tests/github/list-lifecycle-write-session.test.ts` for fixed create/delete documents, expected account checks, scope checks, canonical validated inputs, response decoding, GraphQL/HTTP errors, and token redaction.
- [x] 2.2 Implement `src/github/list-lifecycle-write-session.ts` with only `createList` and `deleteList`; reject descriptions, rename, existing visibility changes, arbitrary documents, arbitrary variables, and account mismatch locally.
- [x] 2.3 Add explicit create/delete lifecycle readiness to `src/github/list-lifecycle-capability.ts` and its unit tests; it must remain false without verified fixture evidence.
- [x] 2.4 Run `bun test tests/github/list-lifecycle-write-session.test.ts tests/github/list-lifecycle-capability.test.ts`.

## 3. Add an independent disposable lifecycle probe and release gate

- [x] 3.1 Write failing fixture tests in `tests/scripts/oauth-list-lifecycle-capability-probe.test.ts` covering explicit fixture name/visibility, create read-back, delete-by-returned-ID, absence read-back, failures, and sanitized output.
- [x] 3.2 Implement `scripts/oauth-list-lifecycle-capability-probe.ts`; accept only operator-confirmed disposable input, never log tokens, and print cleanup guidance if the created fixture remains.
- [x] 3.3 Add `src/github/list-lifecycle-release-evidence.ts` and focused tests using the existing membership release-evidence pattern: validate an exact null-prototype, non-secret proof shape and fail closed when reviewed evidence is absent, malformed, incomplete, or unexpected.
- [x] 3.4 Update `docs/github-app-setup.md` and add `docs/native-list-lifecycle-fixture.md` with the exact disposable-fixture setup, evidence-review, validation, and cleanup procedure.
- [x] 3.5 Run the lifecycle probe and release-evidence unit tests.

## 4. Implement authoritative lifecycle observation and execution

- [x] 4.1 Extend `src/sync/native-list-sync.ts` with a catalog-only fresh observation API that returns a complete metadata fingerprint for targeted List IDs without treating partial repository import as deletion proof.
- [x] 4.2 Write failing tests in `tests/sync/native-list-sync.test.ts` for fresh target metadata, renamed/visibility/count changes, target absence, catalog pagination, and retaining the existing mirror on interrupted sync.
- [x] 4.3 Add `src/mutations/native-list-lifecycle-runner.ts` and tests in `tests/mutations/native-list-lifecycle-runner.test.ts` for create, empty delete, populated delete, preflight re-confirmation, already-deleted, response-lost recovery, read-back mismatch, rate limit, account switching, and service-worker interruption.
- [x] 4.4 Serialize lifecycle actions with membership writes through one native-List mutation lock. When a delete removes a List referenced by queued membership work, transition those jobs to refreshed-preview/needs-confirmation rather than issuing stale membership mutations.
- [x] 4.5 On verified create/delete, call normal native List synchronization and let `reconcileNativeLists` update local List/membership rows; verify repository records and annotations are unchanged.
- [x] 4.6 Run `bun test tests/sync/native-list-sync.test.ts tests/mutations/native-list-lifecycle-runner.test.ts tests/mutations/membership-runner.test.ts`.

## 5. Wire background protocol and state

- [x] 5.1 Extend `src/shared/messages.ts` with validated lifecycle preview, confirm-create, confirm-delete, refresh, and status messages. Require explicit visibility for create and an exact List ID plus confirmation fingerprint for delete.
- [x] 5.2 Wire services and handlers in `src/background.ts`; require the active account and independently proven lifecycle capability before creating an operation.
- [x] 5.3 Expose only non-secret lifecycle readiness, sync progress, operation phase, sanitized errors, and refreshed List catalog through the dashboard state.
- [x] 5.4 Add message and background tests for malformed input, signed-out access, authorization-required, capability-disabled, account mismatch, cancellation, and no accidental GitHub write during ordinary state reads.
- [x] 5.5 Run the targeted background/message test files after identifying them with `bun test tests/<targeted-files>`.

## 6. Add accessible List management UI

- [x] 6.1 Add a GitHub List management entry in `src/dashboard/scripts.ts` that remains reachable when no Lists exist and clearly distinguishes native Lists from local tags.
- [x] 6.2 Add the create dialog with a trimmed non-empty name, mandatory public/private choice, write/readiness disclosure, focus restoration, pending state, and no repository-membership controls.
- [x] 6.3 Add deletion controls for synchronized Lists. Use standard confirmation for zero reported items and a stronger List-name-specific confirmation for populated Lists that displays reported count, partial-import status, no-undo wording, and “repositories remain starred but unlisted.”
- [x] 6.4 Render lifecycle progress, verified outcome, ambiguous outcome, error/re-auth guidance, manual refresh, and disable conflicting controls while a native-List mutation is active.
- [x] 6.5 Add DOM tests for empty catalog creation, required visibility, empty deletion, populated deletion confirmation, cancellation, keyboard focus, partial imports, and lifecycle invalidation of membership previews.
- [x] 6.6 Run the targeted dashboard DOM tests with `bun test tests/dashboard/<targeted-files>`.
- [x] 6.7 Replace the dedicated management navigation/workspace with inline rail markup: a visible accessible `+` beside My Lists and separate sibling remove controls for synchronized native GitHub Lists, with no remove control for Unlist.
- [x] 6.8 Retain compact rail readiness, catalog sync, operation status, queued/preflight cancellation, sanitized recovery guidance, and the fixed `refresh-native-list-lifecycle` action distinct from ordinary Library Refresh; keep actions outside associated live regions.
- [x] 6.9 Move lifecycle dialog ownership to the retained dashboard shell and implement deterministic focus restoration and shell-level fallback when an invoker is disabled or removed by authoritative reconciliation.
- [x] 6.10 Migrate dashboard DOM tests for inline heading/List-row structure, empty-catalog creation, separate navigation and remove controls, no Unlist removal, and removal of the management navigation/workspace.
- [x] 6.11 Add dashboard DOM tests for visible disabled guidance, catalog and conflict blockers, create/delete confirmation flows, queued cancellation, recovery guidance, lifecycle refresh dispatch, and authoritative read-back wording.
- [x] 6.12 Add dashboard DOM tests for live-region association, non-nested interactive controls, dialog focus restoration, post-queue invoker fallback, and shell-level focus fallback after authoritative row removal.
- [x] 6.13 Implement responsive and accessible runtime rail styles for the heading action, sibling List-row controls, compact status surface, narrow touch targets, long names, and forced colors; remove management-page-only rules while retaining dialog styles.
- [x] 6.14 Update dashboard style tests to verify the inline heading action, two-control rows, compact status, narrow sizing, touch targets, forced colors, and removal of obsolete management selectors.
- [x] 6.15 Update `DESIGN.md` to replace the management-panel pattern with inline lifecycle heading, row-action, status, recovery, and focus guidance.
- [x] 6.16 Update `.impeccable/design.json` to replace the management-page component example and synchronize its inline rail lifecycle guidance with `DESIGN.md`.

## 7. Update specifications and product documentation

- [x] 7.1 Run strict OpenSpec validation for `add-native-list-lifecycle` and keep the proposal, delta specs, design, and tasks coherent; defer synchronization into main specs to the archive workflow.
- [x] 7.2 Update `README.md`, `STORE.md`, and `PRIVACY.md` to disclose create/delete scope, explicit privacy selection, populated List confirmation, no automatic retry after ambiguity, and that repositories/local annotations are retained.
- [x] 7.3 Update `docs/manual-test-checklist.md` with isolated-profile creation, public/private visibility verification, empty and populated deletion, post-delete repository retention, external List change, response-lost recovery, and read-only fallback.

## 8. Verify and release safely

- [x] 8.1 Run `bun run check:source`, `bun run typecheck`, `bun test`, `env -u NODE_OPTIONS bun run build:chrome`, `env -u NODE_OPTIONS bun run build:firefox`, and `env -u NODE_OPTIONS bun run inspect:build`.
- [ ] 8.2 Run the lifecycle capability probe only against a deliberately disposable fixture, verify its cleanup independently, and retain only sanitized evidence.
- [ ] 8.3 Manually verify both browser builds in isolated profiles: create public/private Lists, delete empty/populated Lists, confirm repositories remain starred/unlisted, test stale confirmation and restart recovery, then test membership behavior after creation and deletion.
- [ ] 8.4 Add reviewed lifecycle release evidence to a release build only after all automated and isolated-profile checks pass; otherwise keep the evidence input null and retain read-only synchronization with disabled lifecycle controls.
