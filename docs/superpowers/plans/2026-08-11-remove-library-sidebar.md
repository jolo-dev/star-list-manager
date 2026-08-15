# List-Only Sidebar Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Replace the multi-section dashboard sidebar with GitHub Lists-only navigation and a derived Unlist view for every locally stored repository without a native GitHub List membership.

**Architecture:** Extend the existing pure `LibraryView`, query, and count model with a non-persistent `unlist` built-in view. The Van.js dashboard will make that view initial, force its star-state filter to `all` so retained unstarred records remain visible, and render a single always-present GitHub Lists group with Unlist before imported Lists. No storage, sync, API, or mutation code changes are needed.

**Tech Stack:** TypeScript, Van.js, Happy DOM, Bun tests, Extension.js.

---

### Task 1: Add the derived Unlist query and count contract

**Objective:** Make `unlist` a pure local-library view that counts and returns every repository with zero currently stored native-List memberships, including unstarred History records.

**Files:**
- Modify: `tests/dashboard/library.test.ts:47-59,88-105`
- Modify: `src/dashboard/library.ts:11-23,56-65,122-152,206-227`

**Step 1: Write failing unit tests**

Extend the existing fixture assertions so the snapshot’s member repository `R_alpha` remains excluded while its non-member starred repository `R_beta` and unstarred History repository `R_history` are included. Require the derived count to be `2`.

```ts
expect(counts).toEqual({
  inbox: 1,
  backlog: 1,
  due: 1,
  organized: 0,
  all: 2,
  history: 1,
  unlist: 2,
  lists: {UL_tools: 1},
  tags: {Research: 1, Queue: 1}
})

const results = queryRepositories(repositories, {
  view: {kind: 'unlist'},
  search: '',
  filters: {...defaultRepositoryFilters(), starState: 'all'},
  sort: 'name',
  ascending: true
}, now)
expect(results.map((item) => item.repository.repositoryNodeId)).toEqual([
  'R_beta',
  'R_history'
])
```

**Step 2: Run the focused test to verify failure**

Run:

```bash
bun test tests/dashboard/library.test.ts
```

Expected: FAIL because `unlist` is not a valid view and `ViewCounts` has no `unlist` field.

**Step 3: Implement the minimal local derivation**

In `src/dashboard/library.ts`:

1. Add `'unlist'` to `BuiltInView` and `unlist: number` to `ViewCounts`.
2. Initialize `let unlist = 0` in `deriveViewCounts`.
3. Increment it before the `!repository.isStarred` early-continue, so retained unstarred records count too:

```ts
if (item.nativeLists.length === 0) unlist += 1
if (!item.repository.isStarred) {
  history += 1
  continue
}
```

4. Return `unlist` with the existing count fields.
5. In `matchesView`, before the existing `all` and `history` cases, match Unlist solely from local membership:

```ts
if (view.kind === 'unlist') return item.nativeLists.length === 0
```

Do not create a synthetic `NativeListRecord`, change any filter model, or issue a network request.

**Step 4: Run the focused test to verify pass**

Run:

```bash
bun test tests/dashboard/library.test.ts
```

Expected: PASS, including the new Unlist count and result-set assertions.

**Step 5: Commit the query-model change**

```bash
git add src/dashboard/library.ts tests/dashboard/library.test.ts
git commit -m "feat: add derived unlist library view"
```

### Task 2: Replace sidebar rendering with GitHub Lists and Unlist

**Objective:** Make Unlist the initial, clearly derived dashboard view and render it first inside the only sidebar group.

**Files:**
- Modify: `tests/dashboard/dom.test.ts:18-106,1642-1665`
- Modify: `src/dashboard/scripts.ts:87,138-212,1733-1752,2201,2289,2334-2356,2496-2504`

**Step 1: Write failing DOM tests**

Replace the current Triage, Utilities, local-tag, and dynamic-group-collapse tests with one navigation contract:

```ts
const sidebar = sidebarNavigation(root)
const groups = [...(sidebar?.querySelectorAll('details.nav-group') ?? [])]
expect(groups).toHaveLength(1)
expect(navigationGroupSummary(groups[0] ?? null)?.textContent).toBe('GitHub Lists')
expect(navigationLabels(directNavigationList(groups[0] ?? null))).toEqual([
  'Unlist',
  'Current List'
])
expect(sidebar?.textContent).not.toContain('Triage')
expect(sidebar?.textContent).not.toContain('Local tags')
expect(sidebar?.textContent).not.toContain('Utilities')
```

Assert that the active page is Unlist and that the ready-state header displays `Unlist` with a derived/local eyebrow. Add a fixture variation with `nativeLists: []` and `nativeMemberships: []`; it must still render the GitHub Lists group and Unlist.

**Step 2: Run the focused DOM test to verify failure**

Run:

```bash
bun test tests/dashboard/dom.test.ts --test-name-pattern "navigation|Unlist|mounts accessible dashboard"
```

Expected: FAIL because the dashboard starts on Inbox and renders Triage, Local tags, and Utilities.

**Step 3: Implement the single-group sidebar and view behavior**

In `src/dashboard/scripts.ts`:

1. Change the initial `activeView` to `{kind: 'unlist'}`.
2. Replace `Navigation()`’s Triage, conditional GitHub Lists, Local tags, and Utilities blocks with one always-open GitHub Lists `details` element. Render:

```ts
NavItem('Unlist', {kind: 'unlist'}, counts.unlist),
...lists.map((nativeList) =>
  NavItem(
    nativeList.name,
    {kind: 'list', listNodeId: nativeList.listNodeId},
    counts.lists[nativeList.listNodeId] ?? 0
  )
)
```

Keep the existing alphabetical `lists` calculation and the sidebar’s `aria-label`. Do not alter row controls, filters, mutations, settings, sync, or storage.

3. In `currentQuery()`, force Unlist to use `starState: 'all'`, ahead of the normal `starState.val` branch, so its approved result set includes retained unstarred records:

```ts
starState:
  activeView.val.kind === 'history'
    ? 'unstarred'
    : activeView.val.kind === 'unlist'
      ? 'all'
      : starState.val,
```

4. Add `unlist: 'Unlist'` to `viewTitle()` and return a clear local-derived eyebrow for `view.kind === 'unlist'` (for example, `'Derived local view'`).
5. Replace each reset of the active view at disconnect, complete data removal, and `renderLibraryState()` with `{kind: 'unlist'}` so test rendering and state lifecycle cannot return to an unexposed initial Inbox view.

**Step 4: Run the focused DOM test to verify pass**

Run:

```bash
bun test tests/dashboard/dom.test.ts --test-name-pattern "navigation|Unlist|mounts accessible dashboard"
```

Expected: PASS: exactly one GitHub Lists group appears, Unlist is first and active, no imported List is required for the group to exist, and removed navigation labels are absent.

**Step 5: Commit the dashboard navigation change**

```bash
git add src/dashboard/scripts.ts tests/dashboard/dom.test.ts
git commit -m "feat: simplify sidebar to github lists"
```

### Task 3: Run regression and release validation

**Objective:** Prove the reduced sidebar did not regress dashboard behavior or extension builds.

**Files:**
- Verify: `src/dashboard/library.ts`
- Verify: `src/dashboard/scripts.ts`
- Verify: `tests/dashboard/library.test.ts`
- Verify: `tests/dashboard/dom.test.ts`

**Step 1: Run all dashboard-focused tests**

Run:

```bash
bun test tests/dashboard/library.test.ts tests/dashboard/dom.test.ts
```

Expected: PASS. This covers pure Unlist membership semantics, unstarred inclusion, initial state, sidebar ordering, and the preserved dashboard interaction suite.

**Step 2: Run the project’s complete check**

Run:

```bash
env -u NODE_OPTIONS bun run check
```

Expected: exit code `0`; source guard, strict TypeScript, all Bun tests, Chromium and Firefox builds, and built-artifact inspection complete successfully.

**Step 3: Inspect the final change set**

Run:

```bash
git diff master...HEAD --check
git status --short --branch
```

Expected: no whitespace errors and a clean `issue-1-remove-library-sidebar` worktree after the two implementation commits.

**Step 4: Commit any verification-only adjustment, if needed**

If validation required a narrowly scoped correction, commit it separately with a conventional message describing the correction. Otherwise, make no empty commit.
