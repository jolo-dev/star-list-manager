# Handoff: One-login native GitHub List management

**Repository:** `/Users/jolo/Development/star-list-manager`

**Branch:** `master`

**Approved design/plan commit:** `34243289b7cd3d669cc301249229400ab7c90498`

**Status:** Design and implementation plan approved; implementation has not started

## Objective

Replace the current two-authorization experience with one GitHub OAuth App device authorization requesting `public_repo user`. After that one connection and initial synchronization, users must be able to manage supported native GitHub Lists immediately without a second login or checked-in runtime release-evidence gate.

## Authoritative documents

Read these completely before acting:

1. Approved design:
   - `docs/superpowers/specs/2026-08-26-one-login-native-list-management-design.md`
2. Approved implementation plan:
   - `docs/superpowers/plans/2026-08-26-one-login-native-list-management.md`
3. Current product evidence and API history:
   - `docs/github-app-capability-results.md`
   - `openspec/changes/add-native-list-lifecycle/evidence/2026-08-26-helium-partial-manual-verification.md`
4. Existing safety specifications:
   - `openspec/specs/native-list-import/spec.md`
   - `openspec/specs/native-list-membership/spec.md`
   - `openspec/changes/add-native-list-lifecycle/`
   - `openspec/changes/rename-native-github-list/`

The implementation plan is the task checklist. Do not substitute a shorter ad hoc plan.

## Approved product decisions

- One OAuth App device flow requests `public_repo user` up front.
- The same account-bound credential handles identity, public-star/List synchronization, Starring operations, and native List writes.
- Private repositories remain out of scope. Never request `repo`.
- Remove the separate read-only GitHub App session and separate write authorization UI/runtime.
- Remove checked-in membership, lifecycle, and rename evidence from runtime readiness.
- Engineering probes and manual verification remain release checks, but users do not satisfy or see those gates.
- Native List add/remove/move must work through an officially documented public-only API before the redesign can ship.
- If no supported public-only membership route works, stop. Do not request private-repository access, use undocumented GitHub.com endpoints, scrape pages, reuse cookies, or ship partial List management.
- Core List scope:
  - create with name, optional description, and explicit public/private List visibility;
  - delete empty or populated Lists without unstarring repositories;
  - add/remove/move public starred repositories while preserving unrelated memberships;
  - rename Lists;
  - edit post-creation description/visibility only if GitHub officially exposes and the disposable probe verifies those fields.
- Existing valid matching OAuth write credentials should be promoted atomically where safe.
- When promotion is impossible, retain the active local account namespace and keep repositories, Lists, annotations, history, and operation records browseable while showing one replacement **Connect GitHub** action. No remote call is allowed without the unified credential.

## Mandatory hard gate

Task 2 of the plan is a hard stop.

Before changing production authentication:

1. Confirm current official documentation and live schema.
2. Use one OAuth credential requesting exactly `public_repo user`.
3. With explicitly approved disposable fixtures, prove:
   - public identity/star/List reads;
   - membership add, move, remove, and restoration;
   - complete stable observations and independent read-back after every membership mutation;
   - create with description and visibility;
   - delete and observed absence;
   - rename and restoration;
   - any officially available post-create metadata field and restoration.
4. Clean up independently.
5. Retain only sanitized conclusions.

Do not run live mutations merely because the user approved this project. Present the exact fixture names and receive explicit approval immediately before execution.

If membership receives another deterministic rejection or no official route exists, record sanitized negative evidence, commit only safe probe improvements, and stop Tasks 3–12.

## Current architecture and why it must change

Current production code has two independent sessions:

- Read-only GitHub App:
  - `src/auth/device-flow.ts`
  - `src/auth/controller.ts`
  - `src/auth/session.ts`
  - `src/auth/store.ts`
- OAuth App write session:
  - `src/auth/write-device-flow.ts`
  - `src/auth/write-controller.ts`
  - `src/auth/write-store.ts`

`src/background.ts` composes both, publishes `writeAuthorization`, and enforces membership/lifecycle/rename runtime gates. `src/dashboard/scripts.ts` renders a second authorization experience.

Current release state:

- `src/github/list-membership-release-evidence.ts` has a `null` build input after current `updateUserListsForItem` attempts returned sanitized permission failures.
- `src/github/list-lifecycle-release-evidence.ts` remains `null` because full private/Firefox/restart manual verification is incomplete.
- Rename is disabled through a separate environment/proof path.
- Therefore OAuth approval alone currently does not enable the controls.

The redesign intentionally removes these runtime release gates only after the official API feasibility gate succeeds. It must retain all operational safety checks.

## Safety invariants that must survive

Never remove or weaken these while simplifying authentication:

- Fixed, typed REST routes and GraphQL documents only.
- No caller-supplied URL, GraphQL document, operation name, variables object, authorization header, or unsupported metadata field.
- Account identity rechecked before remote dispatch.
- Minimum `public_repo` and `user` scopes for List writes.
- Fresh complete catalog/membership observation before a write.
- Read-only preview and explicit confirmation.
- Persisted intent before dispatch.
- Shared native List mutation lock.
- At-most-once remote dispatch.
- No automatic replay after ambiguous create/update/membership/delete outcomes.
- Independent authoritative read-back before local success.
- Stale confirmation rejection.
- Cross-account isolation.
- Repositories remain starred after List deletion.
- Local repositories, annotations, history, and organization remain intact.
- Worker-evaluation/startup/alarm recovery for durable work.
- Accessible dialog, cancellation, focus restoration, forced-colors, and 320px behavior.

Rename/update must be upgraded to the same durable safety model. The approved plan adds a persisted update operation, confirmation fingerprint, at-most-once runner, and observation-only restart recovery. Do not merely rewire the old immediate rename service.

## Unified migration model

The approved plan uses structural IndexedDB v6 stores plus runtime network validation:

- `sessions`
- `migrationState`
- `nativeListUpdateOperations`

Do not perform network validation inside `onupgradeneeded`.

A unified account record may have `credential: null` so a retained local namespace remains browseable. Credential promotion uses a versioned prepared/complete migration record:

1. Validate active pointer, stable identity, matching legacy write credential, minimum scopes, and live `/user` identity.
2. Atomically store the unified account/session plus prepared marker while leaving legacy credentials intact.
3. The unified session becomes authoritative only after commit.
4. Cleanup legacy auth records idempotently and mark complete.
5. On interruption, resume from the marker without combining accounts or recreating credentials.
6. Await `SessionBootstrap.initialize()` before controller state, synchronization, wake handlers, or mutation consumers can load authentication.

A credential-null retained account permits local browsing only. It must make zero remote sync/write calls.

## Operation-specific runtime failures

Do not replace checked-in gates with another hidden global gate.

A deterministic permission/schema rejection may mark only one operation kind unavailable for the current session generation:

- `membership`
- `create`
- `delete`
- `update`

The state is in memory, sanitized, and reset by a new session generation, successful explicit operation refresh, or reconnect. It is not release evidence and must not disable unrelated operations.

## Repository state and preservation requirements

The working tree intentionally contains user-owned work that is unrelated to this feature:

```text
 M src/dashboard/styles.css
 M tests/dashboard/styles.test.ts
?? .impeccable/critique/2026-08-24T17-24-43Z__src-dashboard-index-html.md
?? .impeccable/live/
```

Do not stage, revert, overwrite, clean, or delete these paths on `master`.

Additional preserved recovery artifacts:

- Immutable stash object: `c4cf3fae658eab184f4055bf72be2c2020598f29`
- External backup: `/tmp/star-list-manager-inline-lifecycle-backup.rgIbh0`
- Existing unrelated worktree: `.worktrees/archive-stars-redesign`

Do not reuse or delete the unrelated worktree.

Create a new isolated worktree for this change, for example:

```bash
git worktree add .worktrees/unify-github-auth-list-management -b feature/unify-github-auth-list-management master
```

Before using that path, follow `@superpowers:using-git-worktrees` and verify project ignore/safety rules. Final integration must explicitly reconcile the user's CSS work rather than overwriting it.

## Expected execution order

1. Create and validate new OpenSpec change `unify-github-auth-list-management`.
2. Implement safe probe tooling with TDD.
3. Obtain exact disposable fixture approval and run the official API feasibility gate.
4. Stop if the hard gate fails.
5. Add create description support.
6. Add unified session storage, migration, and startup bootstrap.
7. Consolidate device flow/controller/session.
8. Rewire all fixed GitHub clients.
9. Persist and recover native List updates without replay.
10. Remove runtime evidence gates and collapse background protocol.
11. Replace the two-login dashboard.
12. Remove legacy auth/runtime evidence code.
13. Update docs.
14. Complete full automated, Chrome, Firefox, migration, and live disposable acceptance.

Follow the exact TDD steps and commit boundaries in the plan.

## Verification baseline

Before the design/plan-only commits, the same source tree passed isolated verification:

- 551 tests, 0 failures
- source check
- TypeScript check
- Chrome production build
- Firefox production build
- bundle inspection
- strict `add-native-list-lifecycle` OpenSpec validation
- diff hygiene

A root-directory full check once raced a long-running Extension.js dev process that shared `dist/chromium-based`. The exact build/inspection passed independently, and the complete check passed in an isolated copy. Use the isolated-copy command in Task 12 rather than stopping or killing user processes.

Correct strict command for the new change:

```bash
openspec validate unify-github-auth-list-management --type change --strict --no-interactive
```

## Security and privacy constraints

- Never inspect, print, copy, or commit `.env.local`.
- Never expose or retain OAuth access tokens, refresh tokens, device codes, authorization headers, client IDs, raw responses, raw GitHub errors, or returned stable List IDs.
- Client IDs are public configuration but still must not be copied into evidence or conversation output.
- Resolve disposable repository/List IDs through fixed reads and keep them in memory; use exact names in user approvals and retained evidence.
- Do not broaden OAuth beyond `public_repo user`.
- Do not add arbitrary GraphQL.
- Do not automatically retry ambiguous writes.
- Do not infer membership success from lifecycle success.

## Required review discipline

Use:

- `@superpowers:test-driven-development` for each production change;
- `@openspec-apply-change` after Task 1 creates the change;
- independent specification and code-quality review at each milestone;
- storage/security review for migration;
- API-boundary/security review for unified clients;
- accessibility/spec review for dashboard changes;
- `@superpowers:verification-before-completion` before success claims;
- `@superpowers:finishing-a-development-branch` only after all gates pass.

Do not claim the feature is complete while the feasibility gate, Chrome/Firefox acceptance, migration acceptance, cleanup, or strict OpenSpec validation remains incomplete.

## First action for the receiving agent

Read the approved design and plan, inspect the current status without touching user work, create the isolated worktree, then execute **Task 1 only**. Do not start a live probe in the same step.

## Copy-paste kickoff prompt

```text
Implement the approved one-login native GitHub List management change in /Users/jolo/Development/star-list-manager.

Authoritative documents:
- docs/superpowers/specs/2026-08-26-one-login-native-list-management-design.md
- docs/superpowers/plans/2026-08-26-one-login-native-list-management.md
- docs/superpowers/handoffs/2026-08-26-one-login-native-list-management.md

Start from current master containing this handoff (with 34243289b7cd3d669cc301249229400ab7c90498 as an ancestor) in a new isolated worktree. Preserve the user-owned unstaged CSS/style-test and .impeccable work on master. Follow the plan task-by-task with TDD and independent reviews.

Task 2 is a mandatory hard gate. Do not change production authentication unless an officially documented public-only membership operation succeeds with one public_repo user OAuth credential and independent read-back. Never request repo, use undocumented endpoints, add arbitrary GraphQL, retain credentials/IDs/raw responses, or run a live mutation without explicit approval of exact disposable fixture names.

Begin with Task 1: create and strictly validate the new OpenSpec change unify-github-auth-list-management. Report the worktree path, files created, validation output, and residual risks before continuing.
```
