# Hide Successful Unstars from Overview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove verified unstars from the default Unlist/Overview results and count while retaining them in explicit unstarred history and Operations.

**Architecture:** Keep durable mutation and storage behavior unchanged. Align the derived Unlist count and dashboard query with the existing `isStarred` source of truth: default Unlist shows only currently starred repositories without native List membership, while an explicit unstarred filter reveals retained records.

**Tech Stack:** TypeScript 7, VanJS, Bun test, Happy DOM

---

### Task 1: Align the Unlist navigation count

**Files:**
- Modify: `tests/dashboard/library.test.ts:40-53`
- Modify: `src/dashboard/library.ts:138-143`

- [ ] **Step 1: Change the count expectation first**

In `tests/dashboard/library.test.ts`, update the `derives fixed view, List, tag, and due counts` expectation:

```ts
unlist: 1,
```

The fixture contains one starred unlisted repository (`R_beta`) and one retained unstarred unlisted repository (`R_history`), so only one belongs in the default Unlist count.

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
bun test tests/dashboard/library.test.ts --test-name-pattern 'derives fixed view'
```

Expected: FAIL because `deriveViewCounts()` still reports `unlist: 2`.

- [ ] **Step 3: Implement the minimal count change**

In `src/dashboard/library.ts`, move the Unlist increment after the unstarred early return:

```ts
for (const item of repositories) {
  if (!item.repository.isStarred) {
    history += 1
    continue
  }
  if (item.nativeLists.length === 0) unlist += 1
  all += 1
```

This leaves history counting intact and aligns Unlist with its default starred population.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run:

```bash
bun test tests/dashboard/library.test.ts --test-name-pattern 'derives fixed view'
```

Expected: PASS.

- [ ] **Step 5: Commit Task 1**

```bash
git add tests/dashboard/library.test.ts src/dashboard/library.ts
git commit -m "fix: count only starred unlisted repositories"
```

### Task 2: Hide completed unstars from default Unlist

**Files:**
- Modify: `tests/dashboard/dom.test.ts:81-143`
- Modify: `src/dashboard/scripts.ts:2032-2042`

- [ ] **Step 1: Rewrite the existing DOM regression test before production code**

Rename the test to:

```ts
test('hides completed unstars from default Unlist and retains explicit unstarred history', async () => {
```

Expand its fixture to include:

- starred, unlisted repositories with `queued`, `checking`, `deleting`, `verifying`, `retry-waiting`, `failed`, `blocked-unknown`, and `cancelled` unstar jobs;
- two unstarred, unlisted repositories with retained `succeeded` and `succeeded-external` jobs;
- one starred repository belonging to a native List.

Build job fixtures with the existing `mutationJob()` helper and override each job's `repositoryNodeId`, `ownerLogin`, and `repositoryName` to match its repository. Set the two successful repositories to `isStarred: false` with a non-null `unstarredAt`; keep every other repository starred. Add the jobs to `state.mutations` with empty batches/history.

Assert the default Unlist:

```ts
expect(visibleRepositoryIds(root)).toEqual(
  expect.arrayContaining([
    'R_queued',
    'R_checking',
    'R_deleting',
    'R_verifying',
    'R_retry-waiting',
    'R_failed',
    'R_blocked-unknown',
    'R_cancelled'
  ])
)
expect(visibleRepositoryIds(root)).not.toContain('R_succeeded')
expect(visibleRepositoryIds(root)).not.toContain('R_succeeded-external')
expect(visibleRepositoryIds(root)).not.toContain('R_starred-listed')
```

Then select `unstarred` through the existing Star state control and assert:

```ts
expect(visibleRepositoryIds(root)).toEqual([
  'R_succeeded',
  'R_succeeded-external'
])
```

Restore the shared module-level filter to `starred` at the end, as the existing test does.

- [ ] **Step 2: Run the focused DOM test and verify RED**

Run:

```bash
bun test tests/dashboard/dom.test.ts --test-name-pattern 'hides completed unstars'
```

Expected: FAIL because `currentQuery()` still forces Unlist to `starState: 'all'`, exposing both completed unstars.

- [ ] **Step 3: Implement the minimal query change**

In `src/dashboard/scripts.ts`, remove the Unlist override:

```ts
starState:
  activeView.val.kind === 'history'
    ? 'unstarred'
    : starState.val,
```

Do not filter by mutation-job status. Repository `isStarred` remains the authoritative visibility boundary.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run:

```bash
bun test tests/dashboard/dom.test.ts --test-name-pattern 'hides completed unstars'
bun test tests/dashboard/library.test.ts tests/dashboard/dom.test.ts
```

Expected: both commands PASS.

- [ ] **Step 5: Commit Task 2**

```bash
git add tests/dashboard/dom.test.ts src/dashboard/scripts.ts
git commit -m "fix: hide completed unstars from overview"
```

### Task 3: Verify the complete change

**Files:**
- Verify only; no intended modifications

- [ ] **Step 1: Run complete automated verification**

```bash
bun run check:source
bun run typecheck
bun test
```

Expected: all commands exit 0 with no failures or diagnostics.

- [ ] **Step 2: Build and inspect Chrome**

```bash
env -u NODE_OPTIONS bun run build:chrome
bun run inspect:build chrome
```

Expected: both commands exit 0.

- [ ] **Step 3: Run the Impeccable detector once**

```bash
node /Users/jolo/.pi/agent/skills/impeccable/scripts/detect.mjs --json src/dashboard/scripts.ts src/dashboard/library.ts
```

Expected: no blocking UI findings related to the change.

- [ ] **Step 4: Inspect repository state**

```bash
git status --short
git diff --check master...HEAD
```

Expected: clean worktree and no whitespace errors.
