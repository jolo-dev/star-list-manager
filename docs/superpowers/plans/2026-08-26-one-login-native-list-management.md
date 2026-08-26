# One-Login Native GitHub List Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace dual GitHub authorization and runtime release gates with one public-repository-only OAuth session that immediately supports verified native List creation, deletion, membership management, and rename.

**Architecture:** Start with a hard official-API feasibility gate. If it passes, add a versioned unified OAuth session and an idempotent runtime migration that can promote the active matching legacy OAuth credential without losing local data. Rewire reads and fixed writes to that session, remove secondary authorization and checked-in runtime evidence gates, then expose the existing safety-preserving List workflows after one connection.

**Tech Stack:** TypeScript 7, Bun 1.3, IndexedDB/fake-indexeddb, VanJS, GitHub OAuth App device flow, fixed GitHub REST/GraphQL operations, Extension.js, OpenSpec.

---

## Execution preconditions

- Use `@superpowers:using-git-worktrees` to create an isolated worktree for this new cross-cutting change. The existing instruction to work directly on `master` applied to `add-native-list-lifecycle`, not this new change.
- Preserve the user-owned unstaged `src/dashboard/styles.css`, `tests/dashboard/styles.test.ts`, and `.impeccable/` work on `master`. Do not copy, overwrite, stage, or delete it. Reconcile CSS only at final integration with the user present.
- Use `@superpowers:test-driven-development` for every production behavior change.
- Use `@openspec-apply-change` after the new OpenSpec artifacts exist.
- Never inspect or copy `.env.local`; never retain OAuth tokens, device codes, client IDs, raw responses, authorization headers, repository/List IDs, or raw GitHub errors.
- Never run a live mutation without the user's explicit approval of exact disposable fixtures.
- **Hard stop:** if Task 2 cannot prove an officially documented public-only membership route with `public_repo user`, do not execute Tasks 3–12.

## File structure and responsibilities

### New planning and evidence files

- `openspec/changes/unify-github-auth-list-management/` — proposal, delta specs, design, tasks, and sanitized feasibility evidence.
- `docs/superpowers/plans/2026-08-26-one-login-native-list-management.md` — this execution plan.

### New authentication units

- `src/auth/oauth-device-flow.ts` — the sole OAuth App device flow; requests `public_repo user`, normalizes returned scopes, validates identity, and returns no UI-visible secret.
- `src/auth/session-store.ts` — active unified session persistence and active-account pointer reconciliation.
- `src/auth/session-migration.ts` — validates/promotes the matching legacy write credential and resumes idempotent cleanup.
- `src/auth/session.ts` — sole authenticated fetch/session invalidation boundary for reads and writes.

### Storage and domain changes

- `src/domain/types.ts` — `GitHubSessionRecord`, unified OAuth credential, and versioned migration record.
- `src/storage/database.ts` — schema v6 `sessions` and `migrationState` stores; structural upgrade only.
- `src/storage/library.ts` — atomic prepare/cleanup/read/write helpers for unified sessions.

### Existing operation units to modify

- `src/github/list-membership-write-session.ts` — feasibility-proven fixed complete-set membership operation using the unified session.
- `src/github/list-lifecycle-write-session.ts` — fixed create including description and visibility, plus delete, using the unified session.
- `src/github/list-rename-write-session.ts` — migrate to a fixed `list-update-write-session.ts` for name and any conditionally proven official metadata fields.
- `src/mutations/native-list-update-runner.ts` — durable at-most-once update execution and observation-only restart recovery.
- `src/mutations/native-list-update-wake.ts` — worker-evaluation/startup/alarm recovery for persisted updates.
- `src/github/starring-write-session.ts` and `src/github/safe-unstar-service.ts` — existing fixed Starring behavior using the same session.
- `src/github/graphql-client.ts` and `src/github/rest-client.ts` — reads continue through authenticated fetch from the unified session.

### Runtime and UI changes

- `src/shared/messages.ts` — one authorization state; no secondary write-authorization requests or runtime evidence readiness.
- `src/background.ts`, `src/background-runtime.ts`, `src/background-lifecycle-runtime.ts`, `src/background-clear-data-runtime.ts` — one controller/store/session, no checked-in capability gate, all existing account/sync/lock/read-back checks retained.
- `src/dashboard/scripts.ts`, `src/dashboard/derivations.ts`, `src/dashboard/styles.css` — one Connect/Reconnect/Disconnect experience and no write-authorization card.

### Legacy units to remove after all consumers migrate

- `src/auth/device-flow.ts`
- `src/auth/write-device-flow.ts`
- `src/auth/write-controller.ts`
- `src/auth/write-store.ts`
- `src/github/list-membership-release-evidence.ts`
- `src/github/list-lifecycle-release-evidence.ts`

Keep capability probe logic as engineering tooling; remove only its runtime gating role.

---

### Task 1: Create the superseding OpenSpec change

**Files:**
- Create: `openspec/changes/unify-github-auth-list-management/.openspec.yaml`
- Create: `openspec/changes/unify-github-auth-list-management/proposal.md`
- Create: `openspec/changes/unify-github-auth-list-management/design.md`
- Create: `openspec/changes/unify-github-auth-list-management/specs/oauth-unified-session/spec.md`
- Create: `openspec/changes/unify-github-auth-list-management/specs/native-list-import/spec.md`
- Create: `openspec/changes/unify-github-auth-list-management/specs/native-list-membership/spec.md`
- Create: `openspec/changes/unify-github-auth-list-management/specs/native-list-lifecycle/spec.md`
- Create: `openspec/changes/unify-github-auth-list-management/specs/oauth-starring-write-auth/spec.md`
- Create: `openspec/changes/unify-github-auth-list-management/tasks.md`
- Reference: `docs/superpowers/specs/2026-08-26-one-login-native-list-management-design.md`

- [ ] **Step 1: Create the change skeleton**

Run:

```bash
openspec new change unify-github-auth-list-management
```

Expected: a spec-driven change root exists with `.openspec.yaml` and no implementation files changed.

- [ ] **Step 2: Write proposal and design artifacts**

The proposal must explicitly say this change supersedes the dual-auth/runtime-gate direction of the still-open membership/lifecycle/rename changes without rewriting their historical evidence. The design must copy the approved hard stop verbatim: official public-only membership failure blocks implementation and release.

- [ ] **Step 3: Write delta requirements**

Include scenarios for:

```markdown
### Requirement: One account-bound OAuth session
The system SHALL request `public_repo user` once and SHALL use the resulting matching credential for public synchronization and fixed write operations.

#### Scenario: Initial connection
- **WHEN** the user completes the one OAuth device flow with both required scopes
- **THEN** the system synchronizes and exposes supported List controls without a second authorization or checked-in release-evidence gate

#### Scenario: Public-only membership API is unavailable
- **WHEN** no officially documented fixed operation succeeds with `public_repo user` and independent read-back
- **THEN** the change SHALL stop before auth migration and SHALL NOT request `repo`, use undocumented endpoints, or ship partial List management
```

Also specify migration commit/rollback, create description/visibility, complete-set membership preservation, fixed operations only, no automatic replay, one disconnect action, operation-specific runtime failure, and public repositories only.

- [ ] **Step 4: Write phased tasks with the feasibility gate first**

Mark every post-feasibility task as blocked on successful sanitized evidence. Do not check implementation tasks yet.

- [ ] **Step 5: Validate the new change**

Run:

```bash
openspec validate unify-github-auth-list-management --type change --strict --no-interactive
```

Expected: `Change 'unify-github-auth-list-management' is valid`.

- [ ] **Step 6: Request specification review and commit**

Use `@superpowers:requesting-code-review` with the approved design as the review source. Resolve all Important findings, rerun strict validation, then commit:

```bash
git add openspec/changes/unify-github-auth-list-management
git commit -m "docs: propose one-login list management"
```

---

### Task 2: Prove the official API and OAuth boundary — hard gate

**Files:**
- Modify: `scripts/oauth-list-membership-capability-probe.ts`
- Modify: `scripts/oauth-list-lifecycle-capability-probe.ts`
- Modify: `scripts/oauth-list-rename-capability-probe.ts`
- Modify: `tests/scripts/oauth-list-membership-capability-probe.test.ts`
- Modify: `tests/scripts/oauth-list-lifecycle-capability-probe.test.ts`
- Modify: `tests/scripts/oauth-list-rename-capability-probe.test.ts`
- Create after successful live verification: `openspec/changes/unify-github-auth-list-management/evidence/2026-08-26-official-list-api-feasibility.md`
- Modify after result: `openspec/changes/unify-github-auth-list-management/tasks.md`

- [ ] **Step 1: Write failing membership probe tests**

Add a dependency-driven test that starts from a stable original complete set and proves this exact sequence with independent stable observations after every mutation:

```ts
expect(steps).toEqual([
  'observe-original',
  'add-destination',
  'observe-added',
  'move-source-to-destination',
  'observe-moved',
  'remove-destination',
  'observe-removed',
  'restore-original',
  'observe-restored'
])
```

Assert every dispatch uses the same expected account, repository node ID, and canonical complete List ID set; restoration is attempted once after any post-first-mutation failure; ambiguous results are never replayed; output contains no IDs, tokens, headers, or raw messages.

- [ ] **Step 2: Run membership probe tests and verify RED**

Run:

```bash
bun test tests/scripts/oauth-list-membership-capability-probe.test.ts
```

Expected: FAIL because the probe currently proves only an unchanged-set mutation.

- [ ] **Step 3: Implement the minimal fixed feasibility sequence**

The CLI must require `--confirm-disposable`, expected GitHub user ID, one exact public starred fixture name, and exact disposable source/destination List names. It must resolve repository/List IDs through fresh fixed reads and keep them only in memory so IDs never enter shell history or retained output. Emit only allowlisted stages and sanitized result categories.

- [ ] **Step 4: Add RED tests for create description and unified-token reads**

In the lifecycle probe tests, require a fixed probe-only `CreateUserList` input containing `name`, `description`, and `isPrivate`, followed by complete catalog read-back matching all three fields and one delete/absence check. Add a test proving identity, public stars, catalog reads, and mutations all use one OAuth credential dependency.

- [ ] **Step 5: Implement the minimal probe-only description contract**

Do not widen production `ListLifecycleWriteSession` yet. Keep the probe document fixed and local to the probe until live evidence succeeds.

- [ ] **Step 6: Run focused automated verification**

Run:

```bash
bun test tests/scripts/oauth-list-membership-capability-probe.test.ts \
  tests/scripts/oauth-list-lifecycle-capability-probe.test.ts \
  tests/scripts/oauth-list-rename-capability-probe.test.ts
bun run check:source
bun run typecheck
```

Expected: all focused tests and checks pass.

- [ ] **Step 7: Review current official contracts without mutating**

Confirm from GitHub's current official documentation and live read-only schema that `UpdateUserListsForItem`, `CreateUserListInput.description`, `CreateUserListInput.isPrivate`, `DeleteUserList`, and `UpdateUserListInput.name` remain official. Also inspect `UpdateUserListInput` for post-creation `description` and `isPrivate`/visibility fields. If either field is official, extend the fixed update probe to change and restore it with independent catalog read-back; if absent, record the sanitized absence and require later UI/source tests to omit that field. Record only URLs, field names, date, and non-sensitive conclusions.

- [ ] **Step 8: Obtain explicit fixture approval before live execution**

Present the exact disposable repository and List names to the user. Do not proceed on general authorization. Never print or retain credential values, device codes, stable IDs, client IDs, or raw responses.

- [ ] **Step 9: Run live feasibility once and clean up independently**

Use one OAuth App device flow requesting exactly `public_repo user`. Confirm the returned normalized scopes contain both and do not contain/request `repo`. Verify identity, public reads, add/remove/move/restoration, create with description/visibility, delete, rename/restoration, and every conditionally official post-create metadata field/restoration. Independently inspect final fixture state and cleanup.

After the new safe CLI flags exist, run only the user-approved names:

```bash
bun run probe:oauth-list-membership -- \
  --confirm-disposable \
  --fixture=owner/repository \
  --source-list-name='Disposable source YYYY-MM-DD' \
  --destination-list-name='Disposable destination YYYY-MM-DD' \
  --github-user-id=EXPECTED_ID
bun run probe:oauth-list-lifecycle -- \
  --confirm-disposable \
  --fixture-name='Disposable lifecycle YYYY-MM-DD' \
  --fixture-description='Disposable verification only' \
  --visibility=public \
  --github-user-id=EXPECTED_ID
bun run probe:oauth-list-rename -- \
  --confirm-disposable \
  --original-name='Disposable rename YYYY-MM-DD' \
  --temporary-name='Disposable renamed YYYY-MM-DD' \
  --github-user-id=EXPECTED_ID
```

Expected: commands print only device guidance plus sanitized stage/results; IDs and credentials are never printed. Run the lifecycle probe separately for private visibility. If conditional update fields exist, rerun the fixed update probe with the exact approved name-based flags and restore every field before exit:

```bash
bun run probe:oauth-list-rename -- \
  --confirm-disposable \
  --original-name='Disposable rename YYYY-MM-DD' \
  --temporary-name='Disposable renamed YYYY-MM-DD' \
  --temporary-description='Disposable temporary description' \
  --temporary-visibility=private \
  --github-user-id=EXPECTED_ID
```

The probe must discover the original description/visibility in memory, restore them after the test, and omit unsupported flags entirely when the official input lacks those fields.

- [ ] **Step 10: Apply the hard-stop decision**

If membership or any hard blocker fails, write sanitized negative evidence, mark the OpenSpec gate blocked, commit probe safety improvements, and **stop the plan**. Do not enable controls or migrate auth.

If all hard blockers pass, write sanitized positive evidence, check the feasibility task, validate OpenSpec, and commit:

```bash
git add scripts tests/scripts openspec/changes/unify-github-auth-list-management
git commit -m "test: prove official one-login list API boundary"
```

---

### Task 3: Add description to the fixed create workflow

**Files:**
- Modify: `src/domain/types.ts`
- Modify: `src/shared/messages.ts`
- Modify: `src/github/list-lifecycle-write-session.ts`
- Modify: `src/background-lifecycle-runtime.ts`
- Modify: `src/mutations/native-list-lifecycle-runner.ts`
- Modify: `src/dashboard/scripts.ts`
- Modify: `tests/shared/messages.test.ts`
- Modify: `tests/github/list-lifecycle-write-session.test.ts`
- Modify: `tests/background/native-list-lifecycle-runtime.test.ts`
- Modify: `tests/mutations/native-list-lifecycle-runner.test.ts`
- Modify: `tests/dashboard/dom.test.ts`

- [ ] **Step 1: Write failing transport and decoder tests**

Require an exact create request:

```ts
{
  expectedGitHubUserId: '42',
  name: 'Reading',
  description: 'Long-form references',
  visibility: 'private'
}
```

Assert the fixed document declares `$description: String`, variables contain only `name`, `description`, `isPrivate`, extra/accessor/symbol fields are rejected, descriptions are trimmed with a documented maximum, and read-back must match name, description, and visibility.

- [ ] **Step 2: Run focused tests and verify RED**

Run:

```bash
bun test tests/github/list-lifecycle-write-session.test.ts tests/shared/messages.test.ts
```

Expected: FAIL because description is not accepted or persisted.

- [ ] **Step 3: Implement the minimal domain/transport contract**

Use an explicit create intent:

```ts
{kind: 'create'; name: string; description: string | null; visibility: 'public' | 'private'}
```

Update the fixed document only with the proven official field. Return and verify description through authoritative catalog observation rather than trusting optimistic local state.

- [ ] **Step 4: Extend preview, persistence, runner, and UI**

Add an optional description textarea to the create dialog, include the description in the read-only preview and confirmation fingerprint, persist it before dispatch, and require exact complete-catalog read-back before success.

- [ ] **Step 5: Run the focused lifecycle matrix**

Run:

```bash
bun test tests/github/list-lifecycle-write-session.test.ts \
  tests/background/native-list-lifecycle-runtime.test.ts \
  tests/mutations/native-list-lifecycle-runner.test.ts \
  tests/storage/native-list-lifecycle-operations.test.ts \
  tests/dashboard/dom.test.ts
```

Expected: all pass; existing delete, stale-confirmation, focus, recovery, and no-replay tests remain green.

- [ ] **Step 6: Review and commit**

```bash
git add src/domain/types.ts src/shared/messages.ts \
  src/github/list-lifecycle-write-session.ts src/background-lifecycle-runtime.ts \
  src/mutations/native-list-lifecycle-runner.ts src/dashboard/scripts.ts \
  tests/shared/messages.test.ts tests/github/list-lifecycle-write-session.test.ts \
  tests/background/native-list-lifecycle-runtime.test.ts \
  tests/mutations/native-list-lifecycle-runner.test.ts tests/dashboard/dom.test.ts
git commit -m "feat: create native lists with descriptions"
```

---

### Task 4: Add unified session storage and idempotent migration

**Files:**
- Modify: `src/domain/types.ts`
- Modify: `src/storage/database.ts`
- Modify: `src/storage/library.ts`
- Create: `src/auth/session-store.ts`
- Create: `src/auth/session-migration.ts`
- Create: `src/auth/session-bootstrap.ts`
- Create: `tests/auth/session-store.test.ts`
- Create: `tests/auth/session-migration.test.ts`
- Create: `tests/auth/session-bootstrap.test.ts`
- Modify: `tests/storage/database.test.ts`
- Modify: `tests/storage/membership-migration.test.ts`

- [ ] **Step 1: Write failing v6 schema tests**

Require `sessions`, `migrationState`, and `nativeListUpdateOperations` stores while retaining legacy auth stores for one compatibility release. A fresh database and every v1–v5 upgrade must preserve library records.

- [ ] **Step 2: Write failing runtime migration tests**

Cover matching active pair, missing write credential, write-only orphan, identity mismatch, missing scopes, extra normalized `user` subscopes, multiple accounts, terminal credential rejection, interruption after prepare, cleanup retry, repeated startup, local active-pointer mismatch, retained local-library access without a credential, and complete-data removal. A no-credential migration must preserve the active account pointer and a non-secret account/identity record while storing no OAuth credential.

Use these states:

```ts
type UnifiedSessionMigrationPhase = 'prepared' | 'complete'
interface UnifiedSessionMigrationRecord {
  readonly id: 'unified-oauth-session'
  readonly version: 1
  readonly githubUserId: GitHubUserId
  readonly phase: UnifiedSessionMigrationPhase
  readonly updatedAt: IsoDateTime
}
```

- [ ] **Step 3: Run migration tests and verify RED**

Run:

```bash
bun test tests/storage/database.test.ts tests/auth/session-store.test.ts tests/auth/session-migration.test.ts
```

Expected: FAIL because v6 stores and migration services do not exist.

- [ ] **Step 4: Implement structural v6 only**

Create stores in `onupgradeneeded`; do not perform network validation or credential promotion there. Add transaction helpers that can atomically write `{session, prepared marker}` while leaving legacy records intact, and atomically delete matching legacy records plus mark complete.

- [ ] **Step 5: Implement account-bound runtime migration**

Validate the active pointer, legacy identities, bearer token, minimum scopes, and live `/user` identity before credential promotion. Model the unified account record with `credential: UnifiedOAuthCredential | null`: the non-secret identity and active namespace may be copied from a valid legacy read record even when no OAuth credential is promotable. After credential prepare commits, the unified session is authoritative. On restart, a prepared marker resumes validation/cleanup; a failed prepare leaves legacy state unchanged. Synchronization failure never rolls the credential back. A credential-null account remains locally browseable but cannot make any remote request.

- [ ] **Step 6: Write and implement the startup-order contract**

`SessionBootstrap.initialize()` must await migration/resume before constructing or exposing the controller/session to synchronization or mutation consumers. Test exact ordering:

```ts
expect(events).toEqual([
  'migration:start',
  'migration:complete',
  'controller:load',
  'sync:eligible'
])
```

Also test prepared-state resume and no-promotable-token fallback produce one replacement-login state before any remote sync/write consumer runs.

- [ ] **Step 7: Run focused tests and typecheck**

```bash
bun test tests/storage/database.test.ts tests/storage/membership-migration.test.ts \
  tests/auth/session-store.test.ts tests/auth/session-migration.test.ts \
  tests/auth/session-bootstrap.test.ts
bun run typecheck
```

Expected: all pass.

- [ ] **Step 8: Review transaction safety and commit**

Request an independent storage/security review, resolve all Important findings, then commit:

```bash
git add src/domain/types.ts src/storage/database.ts src/storage/library.ts \
  src/auth/session-store.ts src/auth/session-migration.ts src/auth/session-bootstrap.ts \
  tests/storage/database.test.ts tests/storage/membership-migration.test.ts \
  tests/auth/session-store.test.ts tests/auth/session-migration.test.ts \
  tests/auth/session-bootstrap.test.ts
git commit -m "feat: add unified oauth session migration"
```

---

### Task 5: Consolidate device flow, controller, and authenticated session

**Files:**
- Create: `src/auth/oauth-device-flow.ts`
- Modify: `src/auth/controller.ts`
- Modify: `src/auth/session.ts`
- Modify: `src/auth/store.ts` or replace its exports with `src/auth/session-store.ts`
- Modify: `tests/auth/controller.test.ts`
- Modify: `tests/auth/session.test.ts`
- Create: `tests/auth/oauth-device-flow.test.ts`
- Later delete: `tests/auth/device-flow.test.ts`, `tests/auth/write-controller.test.ts`, `tests/auth/write-device-flow.test.ts`, `tests/auth/write-store.test.ts`

- [ ] **Step 1: Write failing one-flow tests**

Assert the sole device-code request includes exactly:

```ts
{client_id: '<public configuration>', scope: 'public_repo user'}
```

Assert completion normalizes returned scopes, requires both minimum scopes, accepts additional normalized `user` subscopes, loads the expected identity, and never exposes the access token through `AuthorizationPrompt` or `AppState`.

- [ ] **Step 2: Write failing session invalidation tests**

Require one session to authenticate REST and GraphQL reads and fixed writes. A 401 clears only the expected active session generation and returns one reconnect state; 403 does not erase the credential. Account changes before dispatch fail without fetch.

- [ ] **Step 3: Run auth tests and verify RED**

```bash
bun test tests/auth/oauth-device-flow.test.ts tests/auth/controller.test.ts tests/auth/session.test.ts
```

Expected: FAIL because the primary flow is still the read-only GitHub App flow.

- [ ] **Step 4: Implement the unified OAuth flow and controller**

Consolidate the safe decoding/account logic from `write-device-flow.ts`. Remove refresh-token assumptions from the primary session. Store a monotonically increasing local generation with the OAuth bearer credential so stale 401 responses cannot clear a replacement session.

- [ ] **Step 5: Implement one reconnect/disconnect lifecycle**

The controller must preserve the active non-secret account record and namespace on credential loss, publish a signed-out/reconnect state that still identifies the retained local account, and delete the unified credential exactly once on disconnect. Add a controller test proving `getState()` retains that identity with no authorization secret while remote readiness is false. Complete data deletion remains a separate action.

- [ ] **Step 6: Run auth and source checks**

```bash
bun test tests/auth/oauth-device-flow.test.ts tests/auth/controller.test.ts \
  tests/auth/session.test.ts tests/auth/session-store.test.ts tests/auth/session-migration.test.ts
bun run check:source
bun run typecheck
```

Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add src/auth src/domain/types.ts tests/auth
git commit -m "feat: use one github oauth session"
```

Do not delete legacy production files until Task 10 proves no imports remain.

---

### Task 6: Rewire all fixed GitHub clients to the unified session

**Files:**
- Modify: `src/github/starring-write-session.ts`
- Modify: `src/github/safe-unstar-service.ts`
- Modify: `src/github/list-membership-write-session.ts`
- Modify: `src/github/list-lifecycle-write-session.ts`
- Modify: `src/github/list-rename-write-session.ts`
- Modify: `src/github/graphql-client.ts`
- Modify: `src/github/rest-client.ts`
- Modify: corresponding tests under `tests/github/`

- [ ] **Step 1: Change focused tests to supply only one session store**

For every write client, remove separate owner/write stores and inject one account-bound session source. Assert required scopes, expected account, fixed endpoint/document/variables, native fetch receiver behavior, 401 generation-safe invalidation, and 403 retention.

- [ ] **Step 2: Run the write-session suite and verify RED**

```bash
bun test tests/github/starring-write-session.test.ts \
  tests/github/list-membership-write-session.test.ts \
  tests/github/list-lifecycle-write-session.test.ts \
  tests/github/list-rename-write-session.test.ts
```

Expected: FAIL because constructors still require dual stores.

- [ ] **Step 3: Implement one session dependency**

Each fixed client may request an account-bound credential from `GitHubSessionStore`, but no caller may supply URLs, GraphQL, headers, operation names, or raw variables. Membership/lifecycle/rename require minimum `public_repo` and `user`; public reads and Starring use the same credential.

- [ ] **Step 4: Preserve operation-specific error mapping**

Map unified-session absence/mismatch/scope rejection into each existing typed failure. Do not collapse lifecycle/membership/rename ambiguity, rate limits, invalid identifiers, or malformed-response distinctions.

- [ ] **Step 5: Run all GitHub and synchronization tests**

```bash
bun test tests/github tests/sync
bun run typecheck
```

Expected: all pass, including complete stable observation and unrelated membership preservation.

- [ ] **Step 6: Security review and commit**

Request a fixed-operation/credential-boundary review, then commit:

```bash
git add src/github src/auth/session.ts tests/github tests/sync
git commit -m "refactor: use unified session for github operations"
```

---

### Task 7: Persist and recover native List updates

**Files:**
- Modify: `src/domain/types.ts`
- Modify: `src/storage/library.ts`
- Create: `src/github/list-update-write-session.ts`
- Create: `src/sync/native-list-update-service.ts`
- Create: `src/mutations/native-list-update-runner.ts`
- Create: `src/mutations/native-list-update-wake.ts`
- Modify: `src/shared/messages.ts`
- Modify: `src/background-runtime.ts`
- Modify: `src/background.ts`
- Modify: `src/dashboard/scripts.ts`
- Create: `tests/github/list-update-write-session.test.ts`
- Create: `tests/storage/native-list-update-operations.test.ts`
- Create: `tests/mutations/native-list-update-runner.test.ts`
- Create: `tests/mutations/native-list-update-wake.test.ts`
- Create: `tests/sync/native-list-update-service.test.ts`
- Modify: `tests/background/native-list-rename-runtime.test.ts`
- Modify: `tests/shared/messages.test.ts`
- Modify: `tests/dashboard/dom.test.ts`

- [ ] **Step 1: Write failing fixed-update transport tests**

Require `listId` and `name` in the fixed `UpdateUserList` document. Branch only from Task 2's reviewed official-schema evidence:

- if `description` and/or visibility are officially exposed and the disposable probe restored them, add those exact compile-time fields and tests;
- if absent or unproven, reject those own keys locally and add a source test proving no document/UI support exists.

No runtime environment flag or caller-supplied field list may select the document.

- [ ] **Step 2: Write failing durable storage tests**

Define a versioned operation record with account ID, operation ID, exact original and desired metadata, confirmation fingerprint, phase, attempt count, sanitized error, and timestamps. Cover atomic persist-before-dispatch, active-operation conflicts, cancellation only before dispatch, account isolation, and complete-data deletion.

- [ ] **Step 3: Write failing runner/restart tests**

Cover:

```ts
queued -> preflight -> mutating -> verifying -> succeeded
```

Assert the mutation is dispatched at most once. If the worker stops in `mutating` or `verifying`, a new runner may only observe the complete catalog: exact desired metadata succeeds, exact original metadata returns a safe retry-required terminal state, divergence requires a fresh preview, and no state automatically replays the update.

- [ ] **Step 4: Run focused tests and verify RED**

```bash
bun test tests/github/list-update-write-session.test.ts \
  tests/storage/native-list-update-operations.test.ts \
  tests/mutations/native-list-update-runner.test.ts \
  tests/mutations/native-list-update-wake.test.ts \
  tests/sync/native-list-update-service.test.ts
```

Expected: FAIL because update persistence/recovery units do not exist.

- [ ] **Step 5: Implement fixed update, persistence, and observation-only recovery**

Reuse the shared `NativeListMutationLock`. Persist the exact intent before dispatch, revalidate owner/catalog/fingerprint, send once, and finalize only from complete authoritative catalog read-back. Register immediate worker-evaluation, startup, and dedicated-alarm wakes just like lifecycle recovery.

- [ ] **Step 6: Replace immediate rename with preview/confirm protocol**

Change `rename-native-list` into credential-free preview and confirm requests. Preview is read-only and returns a fingerprint. Confirm rejects stale catalog/name conflicts, persists the operation, and schedules the runner. Preserve inline Cancel/Escape and focus; Save now opens/advances the explicit confirmation rather than dispatching directly.

- [ ] **Step 7: Run update, lock, background, and dashboard regressions**

```bash
bun test tests/github/list-update-write-session.test.ts \
  tests/storage/native-list-update-operations.test.ts \
  tests/mutations/native-list-update-runner.test.ts \
  tests/mutations/native-list-update-wake.test.ts \
  tests/sync/native-list-update-service.test.ts \
  tests/background/native-list-rename-runtime.test.ts \
  tests/mutations/native-list-mutation-lock.test.ts \
  tests/dashboard/dom.test.ts
bun run typecheck
```

Expected: all pass; create/delete/membership locks and existing focus behavior remain green.

- [ ] **Step 8: Independent safety review and commit**

```bash
git add src/domain/types.ts src/storage/library.ts src/github/list-update-write-session.ts \
  src/sync/native-list-update-service.ts src/mutations/native-list-update-runner.ts \
  src/mutations/native-list-update-wake.ts src/shared/messages.ts src/background-runtime.ts \
  src/background.ts src/dashboard/scripts.ts tests/github/list-update-write-session.test.ts \
  tests/storage/native-list-update-operations.test.ts \
  tests/mutations/native-list-update-runner.test.ts \
  tests/mutations/native-list-update-wake.test.ts \
  tests/sync/native-list-update-service.test.ts \
  tests/background/native-list-rename-runtime.test.ts tests/dashboard/dom.test.ts
git commit -m "feat: recover native list updates without replay"
```

---

### Task 8: Remove runtime release gates and collapse the background protocol

**Files:**
- Modify: `src/shared/messages.ts`
- Modify: `src/background.ts`
- Modify: `src/background-runtime.ts`
- Modify: `src/background-lifecycle-runtime.ts`
- Modify: `src/background-clear-data-runtime.ts`
- Modify: `src/mutations/native-list-lifecycle-wake.ts`
- Use: `src/auth/session-bootstrap.ts`
- Create: `src/github/native-list-operation-availability.ts`
- Modify: `tests/shared/messages.test.ts`
- Create: `tests/background/session-bootstrap-runtime.test.ts`
- Create: `tests/github/native-list-operation-availability.test.ts`
- Modify: `tests/background/native-list-lifecycle-runtime.test.ts`
- Modify: `tests/background/native-list-rename-runtime.test.ts`
- Modify: `tests/background/clear-data-runtime.test.ts`
- Modify: `tests/mutations/native-list-lifecycle-wake.test.ts`

- [ ] **Step 1: Write failing protocol tests**

Remove these accepted request types:

```ts
'show-write-auth-preview'
'start-write-device-auth'
'cancel-write-device-auth'
'disconnect-write-auth'
```

Remove `writeAuthorization` and `capability-unproven` from `AppState`. Define operation readiness as `ready | authorization-required | operation-unavailable`, where the last state carries only a fixed sanitized operation-specific error and never a build/release proof.

- [ ] **Step 2: Run protocol/background tests and verify RED**

```bash
bun test tests/shared/messages.test.ts tests/background
```

Expected: FAIL because background still composes two controllers and runtime proof booleans.

- [ ] **Step 3: Prove startup migration wiring before collapsing composition**

Add a background integration test that launches with legacy matching auth, prepared migration, and no promotable OAuth credential. In every case, assert `SessionBootstrap.initialize()` finishes before `AuthController.getState()`, automatic synchronization, queue wake, lifecycle wake, or any mutation service can load authentication. The no-token case must publish one replacement-login state, load the retained account's repositories, Lists, annotations, history, and operation records from IndexedDB, and make zero remote sync/write calls. The active account pointer remains a local namespace selector even without a credential.

- [ ] **Step 4: Collapse background composition**

At the start of the `runtimeServices` promise, await `SessionBootstrap.initialize()`, then construct one OAuth client ID, one controller, one session store, and one session. Delete secondary message routes and overlay state. Assemble the local library from the active unified account record even when its credential is null; remote sync/writes still require the credential. Disconnect clears the credential but preserves the local account namespace/data, while clear-all-data erases both exactly once.

- [ ] **Step 5: Remove proof gates without removing safety gates**

Remove membership/lifecycle release-evidence imports and the rename environment proof. Preserve active-account equality, minimum scopes, fresh catalog/membership observations, stale confirmation, durable intent, mutation lock, cancellation rules, and authoritative read-back.

- [ ] **Step 6: Write RED tests for session-scoped operation availability**

Use an in-memory `NativeListOperationAvailability` keyed by operation kind (`membership`, `create`, `delete`, `update`) and unified session generation. A deterministic permission/schema failure records an allowlisted sanitized error for only that kind. A different session generation, successful explicit operation refresh, or reconnect clears it. It is never persisted as release evidence and never disables another kind.

- [ ] **Step 7: Implement operation-specific runtime-unavailable behavior**

Publish `operation-unavailable` plus fixed guidance for the affected operation. Do not replay, sign out, or disable unrelated operations. Explicit refresh/reconnect reevaluates it; ordinary polling does not silently clear it.

- [ ] **Step 8: Run background, mutation, availability, and message tests**

```bash
bun test tests/shared/messages.test.ts tests/background tests/mutations \
  tests/github/native-list-operation-availability.test.ts
bun run typecheck
```

Expected: all pass.

- [ ] **Step 9: Commit**

```bash
git add src/shared/messages.ts src/background.ts src/background-runtime.ts \
  src/background-lifecycle-runtime.ts src/background-clear-data-runtime.ts \
  src/mutations/native-list-lifecycle-wake.ts src/auth/session-bootstrap.ts \
  src/github/native-list-operation-availability.ts tests/shared tests/background tests/mutations \
  tests/github/native-list-operation-availability.test.ts
git commit -m "feat: enable list operations after one login"
```

---

### Task 9: Replace the two-login dashboard with one connection experience

**Files:**
- Modify: `src/dashboard/scripts.ts`
- Modify: `src/dashboard/derivations.ts`
- Modify carefully: `src/dashboard/styles.css`
- Modify: `tests/dashboard/dom.test.ts`
- Modify: `tests/dashboard/derivations.test.ts`
- Modify carefully: `tests/dashboard/styles.test.ts`

- [ ] **Step 1: Write failing DOM tests for one connection**

Assert first run and reconnect show exactly one **Connect GitHub** action and one disclosure naming `public_repo user`. Add a migrated no-credential fixture that remains able to browse retained repositories, Lists, annotations, history, and operation records under its active account while every remote sync/write control is authorization-gated and sends no message except Connect. After authorization and synchronization, create/delete/rename/membership controls are enabled unless blocked by sync freshness or mutation conflicts. Settings show one connected account and one **Disconnect GitHub** action. If Task 2 proved official post-create description/visibility fields, require their edit controls and durable update preview; otherwise require those controls to be absent and transport inputs to remain rejected.

- [ ] **Step 2: Add failing removal/focus tests**

Assert no “write authorization,” second code, write preview, write disconnect, “capability unproven,” or permanently disabled unsupported metadata control exists. For `operation-unavailable`, assert fixed guidance appears only beside the affected operation, unrelated controls remain enabled, ordinary polling does not clear it, and explicit refresh/reconnect does. When a removed auth subtree owned focus, focus falls to the Settings heading or unified connection action. Preserve all lifecycle dialog and repository focus tests.

- [ ] **Step 3: Run dashboard tests and verify RED**

```bash
bun test tests/dashboard/dom.test.ts tests/dashboard/derivations.test.ts tests/dashboard/styles.test.ts
```

Expected: FAIL because the secondary authorization UI and state slice remain.

- [ ] **Step 4: Implement the one-login UI**

Remove `WriteAuthorizationCard`, secondary polling/actions, duplicate signals, readiness notice, and proof-specific messages. Keep one pending authorization prompt. After ready sync, render all officially supported controls. Render post-create description/visibility editing only for the exact compile-time field set proven in Task 2; do not use a runtime flag or show permanently disabled placeholders.

- [ ] **Step 5: Preserve safety, accessibility, and user CSS work**

Do not replace the lifecycle gate wholesale: retain active lifecycle/membership/rename conflicts, incomplete sync, queued cancellation, fixed errors, dialog trapping, associated guidance, forced colors, 320px reflow, and focus restoration. Apply only targeted style deletions/additions and reconcile with the user's unstaged CSS at integration.

- [ ] **Step 6: Run dashboard tests**

```bash
bun test tests/dashboard/dom.test.ts tests/dashboard/derivations.test.ts tests/dashboard/styles.test.ts
```

Expected: all pass.

- [ ] **Step 7: Request UI/spec review and commit**

Use independent accessibility/spec and code-quality reviewers, then commit only reviewed dashboard files:

```bash
git add src/dashboard/scripts.ts src/dashboard/derivations.ts src/dashboard/styles.css \
  tests/dashboard/dom.test.ts tests/dashboard/derivations.test.ts tests/dashboard/styles.test.ts
git commit -m "feat: connect github once for list management"
```

---

### Task 10: Remove legacy auth and runtime evidence code

**Files:**
- Delete: `src/auth/device-flow.ts`
- Delete: `src/auth/write-device-flow.ts`
- Delete: `src/auth/write-controller.ts`
- Delete: `src/auth/write-store.ts`
- Delete: `src/github/list-membership-release-evidence.ts`
- Delete: `src/github/list-lifecycle-release-evidence.ts`
- Delete after Task 7 replacement: `src/github/list-rename-write-session.ts`
- Delete after Task 7 replacement: `src/sync/native-list-rename-service.ts`
- Delete or rewrite obsolete matching tests, including old rename transport/service tests only after equivalent update tests pass
- Modify: `.env.example`
- Modify: `.github/workflows/ci.yml`
- Modify: `README.md`
- Modify: `package.json` only if script names change

- [ ] **Step 1: Add a failing source/build assertion**

Extend `tests/scripts/inspect-build.test.ts` or source checks to reject bundled secondary auth messages, `EXTENSION_PUBLIC_GITHUB_WRITE_CLIENT_ID`, `EXTENSION_PUBLIC_GITHUB_LIST_RENAME_ENABLED`, and runtime release-evidence imports.

- [ ] **Step 2: Run the assertion and verify RED**

```bash
bun test tests/scripts/inspect-build.test.ts
```

Expected: FAIL while legacy configuration/code is still bundled.

- [ ] **Step 3: Remove all legacy consumers and files**

Use one public OAuth App configuration variable. Remove duplicate auth tests only after equivalent unified-flow cases exist. Keep disposable probe scripts and capability result types when they remain useful engineering tools, but ensure production runtime never imports them.

- [ ] **Step 4: Verify no stale dual-auth language or symbols remain**

Run:

```bash
rg -n "WRITE_CLIENT_ID|LIST_RENAME_ENABLED|writeAuthorization|write authorization|releaseNativeList" \
  src tests .env.example .github README.md PRIVACY.md STORE.md PRODUCT.md
```

Expected: no production dual-auth/runtime-gate matches; any historical documentation match is explicitly labeled historical.

- [ ] **Step 5: Run source, type, and focused build inspection**

```bash
bun run check:source
bun run typecheck
bun test tests/scripts/inspect-build.test.ts
```

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add -A src/auth src/github src/sync/native-list-rename-service.ts \
  tests/auth tests/github tests/sync/native-list-rename-service.test.ts \
  .env.example .github/workflows/ci.yml README.md package.json tests/scripts/inspect-build.test.ts
git commit -m "refactor: remove dual github authorization"
```

---

### Task 11: Update product, privacy, setup, and release documentation

**Files:**
- Modify: `README.md`
- Modify: `PRODUCT.md`
- Modify: `PRIVACY.md`
- Modify: `STORE.md`
- Modify: `docs/github-app-setup.md`
- Modify: `docs/github-app-capability-results.md`
- Modify: `docs/native-list-membership-fixture.md`
- Modify: `docs/native-list-lifecycle-fixture.md`
- Modify: `docs/manual-test-checklist.md`
- Modify: `openspec/changes/unify-github-auth-list-management/tasks.md`

- [ ] **Step 1: Rewrite current product claims**

Document one OAuth authorization, GitHub's broad granted scopes, the implementation's fixed narrow routes/documents, public repositories only, one disconnect action, migration behavior, description at creation, supported rename/membership/lifecycle, authoritative read-back, and no automatic replay.

- [ ] **Step 2: Preserve honest historical evidence**

Do not rewrite old dated probe results as successes. Label dual-auth and failed membership evidence historical, then link the new sanitized feasibility evidence. Do not retain fixture identifiers or raw responses.

- [ ] **Step 3: Update manual verification matrices**

Add one-login first run, existing-token promotion, no-token migration, revoked token, one reconnect, add/remove/move, create with description and both visibilities, rename, delete empty/populated, stale confirmations, interruption recovery, operation-specific failure, and Chrome/Firefox checks.

- [ ] **Step 4: Validate text and OpenSpec**

```bash
openspec validate unify-github-auth-list-management --type change --strict --no-interactive
bun test tests/scripts/inspect-build.test.ts
git diff --check
```

Expected: all pass.

- [ ] **Step 5: Review and commit**

```bash
git add README.md PRODUCT.md PRIVACY.md STORE.md docs \
  openspec/changes/unify-github-auth-list-management
git commit -m "docs: explain one-login list management"
```

---

### Task 12: Full verification, isolated browser acceptance, and integration

**Files:**
- Modify: `openspec/changes/unify-github-auth-list-management/tasks.md`
- Create sanitized evidence only: `openspec/changes/unify-github-auth-list-management/evidence/2026-08-XX-browser-acceptance.md`
- No other production changes unless a failing test/review identifies a defect through TDD.

- [ ] **Step 1: Run the complete automated check in an isolated copy**

Avoid the existing long-running Extension.js dev process that owns the root `dist/` directory. Exclude `.env.local`, `.git`, `.worktrees`, `.pi`, `.impeccable`, and `dist`; symlink only `node_modules`.

Run with explicit creation and cleanup:

```bash
set -e
root=$PWD
verify=$(mktemp -d /tmp/star-list-manager-one-login-verify.XXXXXX)
cleanup() { rm -rf "$verify"; }
trap cleanup EXIT
rsync -a \
  --exclude='.git/' \
  --exclude='.worktrees/' \
  --exclude='.pi/' \
  --exclude='.impeccable/' \
  --exclude='.env.local' \
  --exclude='node_modules/' \
  --exclude='dist/' \
  "$root/" "$verify/"
ln -s "$root/node_modules" "$verify/node_modules"
(
  cd "$verify"
  env -u NODE_OPTIONS bun run check
  openspec validate unify-github-auth-list-management --type change --strict --no-interactive
)
cd "$root"
git diff --check
cleanup
trap - EXIT
```

Expected: source check, typecheck, every test, Chrome build, Firefox build, build inspection, and strict OpenSpec validation all pass.

- [ ] **Step 2: Request independent specification and security reviews**

Review one-login behavior, migration atomicity, credential invalidation, scope boundaries, fixed-operation allowlists, ambiguity handling, and removal of hidden gates. Resolve all Critical/Important findings through TDD and rerun the complete check.

- [ ] **Step 3: Obtain explicit live fixture authorization**

Use fresh isolated Chrome and Firefox profiles. Present exact disposable fixtures before any mutation. Do not reuse unrelated repositories or Lists and do not expose credentials or IDs.

- [ ] **Step 4: Verify new-install one-login behavior**

In both browsers, complete one device flow, confirm there is no second authorization, synchronize public stars/Lists, and verify create with description/public/private visibility, rename, add/remove/move with unrelated memberships preserved, empty/populated delete, stars retained, stale confirmation, and restart recovery.

- [ ] **Step 5: Verify migration behavior**

Using controlled local fixtures rather than production credentials, verify valid matching write-token promotion, no-token replacement authorization, mismatch rejection, prepared-migration restart, cleanup idempotence, revoked token reconnect, retained local data, and complete deletion.

- [ ] **Step 6: Clean up and record sanitized evidence**

Disconnect authorization, delete isolated profiles/builds, independently inspect disposable fixture cleanup, and retain only browser versions, commit, operation outcomes, and non-sensitive conclusions.

- [ ] **Step 7: Mark tasks complete and rerun final checks**

```bash
env -u NODE_OPTIONS bun run check
openspec validate unify-github-auth-list-management --type change --strict --no-interactive
git diff --check
git status --short
```

Expected: all checks pass; only explicitly preserved user work remains unstaged.

- [ ] **Step 8: Commit evidence and finish the branch**

```bash
git add openspec/changes/unify-github-auth-list-management
git commit -m "docs: record one-login browser acceptance"
```

Use `@superpowers:finishing-a-development-branch` to present merge/PR/cleanup options. Do not merge over the user's unstaged CSS; reconcile it explicitly first.
