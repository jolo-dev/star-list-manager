## 1. Define lifecycle contracts and migration

- [ ] 1.1 Add `NativeListLifecycleIntent`, operation phases, verification outcomes, and sanitized lifecycle details to `src/domain/types.ts`; keep repository mutation types unchanged rather than using synthetic repository jobs.
- [ ] 1.2 Add a versioned `nativeListLifecycleOperations` IndexedDB store, account/status indexes, validation, and account/data-deletion coverage in `src/storage/database.ts` and `src/storage/library.ts`.
- [ ] 1.3 Write failing migration and persistence tests in `tests/storage/native-list-lifecycle-operations.test.ts` for create intent, delete snapshot, terminal history, account isolation, active-operation uniqueness, and complete local-data deletion.
- [ ] 1.4 Implement the minimal storage API and run `bun test tests/storage/native-list-lifecycle-operations.test.ts` until it passes.

## 2. Create the narrow OAuth lifecycle transport

- [ ] 2.1 Add failing tests in `tests/github/list-lifecycle-write-session.test.ts` for fixed create/delete documents, expected account checks, scope checks, canonical validated inputs, response decoding, GraphQL/HTTP errors, and token redaction.
- [ ] 2.2 Implement `src/github/list-lifecycle-write-session.ts` with only `createList` and `deleteList`; reject descriptions, rename, existing visibility changes, arbitrary documents, arbitrary variables, and account mismatch locally.
- [ ] 2.3 Add explicit create/delete lifecycle readiness to `src/github/list-lifecycle-capability.ts` and its unit tests; it must remain false without verified fixture evidence.
- [ ] 2.4 Run `bun test tests/github/list-lifecycle-write-session.test.ts tests/github/list-lifecycle-capability.test.ts`.

## 3. Add an independent disposable lifecycle probe

- [ ] 3.1 Write failing fixture tests in `tests/scripts/oauth-list-lifecycle-capability-probe.test.ts` covering explicit fixture name/visibility, create read-back, delete-by-returned-ID, absence read-back, failures, and sanitized output.
- [ ] 3.2 Implement `scripts/oauth-list-lifecycle-capability-probe.ts`; accept only operator-confirmed disposable input, never log tokens, and print cleanup guidance if the created fixture remains.
- [ ] 3.3 Update `docs/github-app-setup.md` and add `docs/native-list-lifecycle-fixture.md` with the exact disposable-fixture setup, verification, and cleanup procedure.
- [ ] 3.4 Run `bun test tests/scripts/oauth-list-lifecycle-capability-probe.test.ts`.

## 4. Implement authoritative lifecycle observation and execution

- [ ] 4.1 Extend `src/sync/native-list-sync.ts` with a catalog-only fresh observation API that returns a complete metadata fingerprint for targeted List IDs without treating partial repository import as deletion proof.
- [ ] 4.2 Write failing tests in `tests/sync/native-list-sync.test.ts` for fresh target metadata, renamed/visibility/count changes, target absence, catalog pagination, and retaining the existing mirror on interrupted sync.
- [ ] 4.3 Add `src/mutations/native-list-lifecycle-runner.ts` and tests in `tests/mutations/native-list-lifecycle-runner.test.ts` for create, empty delete, populated delete, preflight re-confirmation, already-deleted, response-lost recovery, read-back mismatch, rate limit, account switching, and service-worker interruption.
- [ ] 4.4 Serialize lifecycle actions with membership writes through one native-List mutation lock. When a delete removes a List referenced by queued membership work, transition those jobs to refreshed-preview/needs-confirmation rather than issuing stale membership mutations.
- [ ] 4.5 On verified create/delete, call normal native List synchronization and let `reconcileNativeLists` update local List/membership rows; verify repository records and annotations are unchanged.
- [ ] 4.6 Run `bun test tests/sync/native-list-sync.test.ts tests/mutations/native-list-lifecycle-runner.test.ts tests/mutations/membership-runner.test.ts`.

## 5. Wire background protocol and state

- [ ] 5.1 Extend `src/shared/messages.ts` with validated lifecycle preview, confirm-create, confirm-delete, refresh, and status messages. Require explicit visibility for create and an exact List ID plus confirmation fingerprint for delete.
- [ ] 5.2 Wire services and handlers in `src/background.ts`; require the active account and independently proven lifecycle capability before creating an operation.
- [ ] 5.3 Expose only non-secret lifecycle readiness, sync progress, operation phase, sanitized errors, and refreshed List catalog through the dashboard state.
- [ ] 5.4 Add message and background tests for malformed input, signed-out access, authorization-required, capability-disabled, account mismatch, cancellation, and no accidental GitHub write during ordinary state reads.
- [ ] 5.5 Run the targeted background/message test files after identifying them with `bun test tests/<targeted-files>`.

## 6. Add accessible List management UI

- [ ] 6.1 Add a GitHub List management entry in `src/dashboard/scripts.ts` that remains reachable when no Lists exist and clearly distinguishes native Lists from local tags.
- [ ] 6.2 Add the create dialog with a trimmed non-empty name, mandatory public/private choice, write/readiness disclosure, focus restoration, pending state, and no repository-membership controls.
- [ ] 6.3 Add deletion controls for synchronized Lists. Use standard confirmation for zero reported items and a stronger List-name-specific confirmation for populated Lists that displays reported count, partial-import status, no-undo wording, and “repositories remain starred but unlisted.”
- [ ] 6.4 Render lifecycle progress, verified outcome, ambiguous outcome, error/re-auth guidance, manual refresh, and disable conflicting controls while a native-List mutation is active.
- [ ] 6.5 Add DOM tests for empty catalog creation, required visibility, empty deletion, populated deletion confirmation, cancellation, keyboard focus, partial imports, and lifecycle invalidation of membership previews.
- [ ] 6.6 Run the targeted dashboard DOM tests with `bun test tests/dashboard/<targeted-files>`.

## 7. Update specifications and product documentation

- [ ] 7.1 Apply the accepted OpenSpec deltas to `openspec/specs/native-list-import/spec.md`, `openspec/specs/oauth-starring-write-auth/spec.md`, and `openspec/specs/native-list-membership/spec.md`; add `openspec/specs/native-list-lifecycle/spec.md` when implementation is archived.
- [ ] 7.2 Update `README.md`, `STORE.md`, and `PRIVACY.md` to disclose create/delete scope, explicit privacy selection, populated List confirmation, no automatic retry after ambiguity, and that repositories/local annotations are retained.
- [ ] 7.3 Update `docs/manual-test-checklist.md` with isolated-profile creation, public/private visibility verification, empty and populated deletion, post-delete repository retention, external List change, response-lost recovery, and read-only fallback.

## 8. Verify and release safely

- [ ] 8.1 Run `bun run check:source`, `bun run typecheck`, `bun test`, `env -u NODE_OPTIONS bun run build:chrome`, `env -u NODE_OPTIONS bun run build:firefox`, and `env -u NODE_OPTIONS bun run inspect:build`.
- [ ] 8.2 Run the lifecycle capability probe only against a deliberately disposable fixture, verify its cleanup independently, and retain only sanitized evidence.
- [ ] 8.3 Manually verify both browser builds in isolated profiles: create public/private Lists, delete empty/populated Lists, confirm repositories remain starred/unlisted, test stale confirmation and restart recovery, then test membership behavior after creation and deletion.
- [ ] 8.4 Enable lifecycle controls only after all automated and isolated-profile checks pass; otherwise retain read-only synchronization and disabled lifecycle controls.
