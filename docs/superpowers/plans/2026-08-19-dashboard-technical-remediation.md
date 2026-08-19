# Dashboard Technical Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resolve every P1 and P2 dashboard audit finding while preserving the existing Star List Manager product model and warm parchment/sage identity.

**Architecture:** Move expensive dashboard derivations into pure, tested helpers and publish library, mutation, and workspace slices independently so mutation polling does not replace the ready library shell. Restore complete navigation, then harden focus, landmarks, responsive behavior, typography, semantic light/dark/high-contrast tokens, and build assets through focused regression tests.

**Tech Stack:** TypeScript 7, Bun test runner, VanJS 1.6, Happy DOM, Extension.js, CSS custom properties/media queries, Sharp (development-only icon generation), PNG extension assets.

---

## File map

- Create `src/dashboard/derivations.ts`: pure latest-job indexing, repository-result projection, and state-slice fingerprint helpers.
- Create `tests/dashboard/derivations.test.ts`: correctness, scaling, and call-count regression tests for those helpers.
- Create `scripts/benchmark-dashboard.ts`: reproducible 10,000-repository/50,000-job timing evidence with a bounded legacy sample and normalized per-lookup reporting; informational, not a flaky pass/fail gate.
- Create `scripts/png.ts` and `tests/scripts/png.test.ts`: side-effect-free PNG signature/IHDR dimension parsing shared by tests and build inspection.
- Create `scripts/generate-icons.ts`: cross-platform Sharp-based generation of the manifest icon set.
- Modify `package.json` and `bun.lock`: declare Sharp as a dev dependency and add `generate:icons`.
- Modify `src/dashboard/library.ts`: retain one library population model, remove unreachable legacy view kinds, and align default archived scope counts.
- Modify `src/dashboard/scripts.ts`: reachable navigation, coherent view/filter copy, independent state publication, stable ready shell, O(1) job access, and focus restoration.
- Modify `src/dashboard/index.html`: make `#app` a neutral mount node and declare light/dark color-scheme support.
- Modify `src/dashboard/styles.css`: semantic theme tokens, composed dark/forced-colors themes, typography roles, contrast, focus, reflow, touch, and loading fixes; remove dead navigation selectors.
- Modify `tests/dashboard/library.test.ts`: retained view/count semantics.
- Modify `tests/dashboard/dom.test.ts`: navigation, headings, scoped live regions, stable focus/scroll, and success-path focus tests.
- Modify `tests/dashboard/styles.test.ts`: theme, typography, contrast-token, focus, responsive, touch, and dead-selector tests.
- Create `src/images/icon-{16,32,48,64,128}.png`: slot-sized extension icons generated from the current `src/images/icon.png` source artwork.
- Modify `src/manifest.json`: map each extension icon slot to its matching PNG while retaining the unreferenced high-resolution source for regeneration.
- Modify `scripts/inspect-build.ts` and `tests/scripts/inspect-build.test.ts`: consume the side-effect-free PNG helper and verify every built icon exists at the declared dimensions.

Keep the work as one plan because all seven stages converge on the same dashboard state/rendering contract. Do not introduce routing, a manual theme setting, a UI framework, a new font dependency, or changes to GitHub mutation semantics.

### Task 1: Pure derivations and measurable scaling evidence

**Files:**
- Create: `src/dashboard/derivations.ts`
- Create: `tests/dashboard/derivations.test.ts`
- Create: `scripts/benchmark-dashboard.ts`
- Modify: `src/dashboard/scripts.ts:29-34, 1390-1405, 2454-2473, 2514-2520`
- Modify: `tests/dashboard/dom.test.ts`

- [ ] **Step 1: Write failing latest-job index tests**

Create fixtures with multiple accounts, repositories, timestamps, and equal-timestamp job IDs. Require one latest account-owned job per repository and no cross-account entries:

```ts
import {expect, test} from 'bun:test'
import {indexLatestRepositoryJobs} from '../../src/dashboard/derivations'

test('indexes one deterministic latest job per repository for the active account', () => {
  const jobs = [
    mutationJob('42', 'R_one', '2026-08-01T10:00:00Z', 'J_1'),
    mutationJob('42', 'R_one', '2026-08-02T10:00:00Z', 'J_2'),
    mutationJob('7', 'R_one', '2026-08-03T10:00:00Z', 'J_other'),
    mutationJob('42', 'R_two', '2026-08-02T10:00:00Z', 'J_3')
  ]
  const index = indexLatestRepositoryJobs(jobs, '42')
  expect(index.get('R_one')?.jobId).toBe('J_2')
  expect(index.get('R_two')?.jobId).toBe('J_3')
  expect(index.size).toBe(2)
})
```

Also test `githubUserId === null` returns an empty map and same-timestamp jobs select the lexically greater `jobId`, matching the existing sort.

- [ ] **Step 2: Run the focused test to verify RED**

Run: `bun test tests/dashboard/derivations.test.ts`

Expected: FAIL because `src/dashboard/derivations.ts` does not exist.

- [ ] **Step 3: Implement the single-pass index**

Create:

```ts
export function indexLatestRepositoryJobs(
  jobs: readonly MutationJobRecord[],
  githubUserId: string | null
): ReadonlyMap<string, MutationJobRecord> {
  const latest = new Map<string, MutationJobRecord>()
  if (githubUserId === null) return latest
  for (const job of jobs) {
    if (job.githubUserId !== githubUserId) continue
    const current = latest.get(job.repositoryNodeId)
    if (
      !current ||
      job.createdAt > current.createdAt ||
      (job.createdAt === current.createdAt && job.jobId > current.jobId)
    ) latest.set(job.repositoryNodeId, job)
  }
  return latest
}
```

In `scripts.ts`, replace `latestRepositoryJob()` filtering/sorting with lookup from a published/derived `latestJobsByRepository` signal. Its invalidation key must include both the mutations fingerprint and active `identity.githubUserId`, as specified and regression-tested in Task 3. Keep `hasActiveRepositoryJob()` as the single status predicate wrapper.

- [ ] **Step 4: Add failing pure and integrated shared-result tests**

Define `deriveRepositoryResults(repositories, query, now, inspectedId, limit, runQuery = queryRepositories)` and inject a counted `runQuery` in the pure test. Assert it calls the query exactly once and returns `{all, visible, count, inspectedRemainsVisible}` from the same array.

```ts
let calls = 0
const derived = deriveRepositoryResults(items, query, now, 'R_2', 200, (...args) => {
  calls += 1
  return queryRepositories(...args)
})
expect(calls).toBe(1)
expect(derived.count).toBe(derived.all.length)
expect(derived.visible).toEqual(derived.all.slice(0, 200))
expect(derived.inspectedRemainsVisible).toBe(true)
```

Add a Happy DOM integration test using a counted `RepositoryQueryRunner` injected through the existing exported `renderLibraryState()` test helper. `ReadyLibraryState(runQuery = queryRepositories)` must construct exactly one persistent `van.derive` for its lifetime. After initial rendering, reset the counter, change Search, Language, Star state, and Sort one at a time, and after each change await `browserWindow.happyDOM.whenAsyncComplete()` before asserting exactly one new query call. Read the result count, repository rows, and inspector-presence state between assertions and prove those three consumers do not trigger extra calls.

```ts
search.dispatchEvent(new browserWindow.Event('input', {bubbles: true}))
await browserWindow.happyDOM.whenAsyncComplete()
expect(queryCalls).toBe(1)
expect(resultCount.textContent).toContain('repositories')
expect(visibleRepositoryIds(root)).toEqual(expectedIds)
expect(root.querySelector('.repository-inspection-dialog')).toBeNull()
expect(queryCalls).toBe(1)
```

- [ ] **Step 5: Run the derivation tests to verify RED, then implement one persistent derivation**

Run: `bun test tests/dashboard/derivations.test.ts tests/dashboard/dom.test.ts --test-name-pattern 'shared repository result|one query per filter change'`

Expected before implementation: FAIL because `deriveRepositoryResults`, query-runner injection, and the persistent result derivation do not exist.

Implement the helper with one `runQuery()` invocation. In `ReadyLibraryState`, create one long-lived `const repositoryResults = van.derive(...)`; do not create separate derivations in the header, list, or inspector. Make result-count text, rows/limit, and inspector validity read `repositoryResults.val` only. The derive inputs are `publishedLibrary`, `activeView`, Search, Language, Archive, Star state, Disabled, Triage, date, sort, direction, and inspected ID. Do not call `queryRepositories()` anywhere else in mounted dashboard rendering. Do not add debounce until timing evidence demonstrates it is needed.

Run: `bun test tests/dashboard/derivations.test.ts tests/dashboard/library.test.ts tests/dashboard/dom.test.ts`

Expected: PASS, including exactly one query evaluation per flushed filter change and no consumer-triggered duplicate evaluations.

- [ ] **Step 6: Add a reproducible informational benchmark**

Create `scripts/benchmark-dashboard.ts` that deterministically generates the full 10,000 `LibraryRepository` and 50,000 `MutationJobRecord` datasets. Bound only the quadratic legacy job path to the first 200 repository lookups so the benchmark cannot perform 500 million comparisons. Run the indexed path over all 50,000 jobs and all 10,000 repository lookups, and run both repeated/shared query paths over all 10,000 repositories.

Report normalized job cost as:

- `legacyLookupSampleSize: 200` and `legacyMsPerLookup = legacySampleMs / 200`;
- `indexedLookupCount: 10000` and `indexedAmortizedMsPerLookup = (indexBuildMs + indexedLookupMs) / 10000`;
- `normalizedLookupSpeedup = legacyMsPerLookup / indexedAmortizedMsPerLookup`.

Also report raw index-build/lookup medians and repeated/shared query medians. Use `performance.now()`, at least five warmed measured iterations, and a median helper. Print ratios but do not fail on a wall-clock threshold:

```ts
console.log(JSON.stringify({
  dataset: {repositories: 10_000, jobs: 50_000, legacyLookupSampleSize: 200},
  jobs: {legacyMsPerLookup, indexBuildMs, indexedLookupMs, indexedAmortizedMsPerLookup, normalizedLookupSpeedup},
  query: {repeatedMs, sharedMs, speedup: repeatedMs / sharedMs}
}, null, 2))
```

- [ ] **Step 7: Capture benchmark and regression evidence**

Run: `bun scripts/benchmark-dashboard.ts`

Expected: JSON output declares the 10,000/50,000 full dataset and 200-lookup legacy sample. `normalizedLookupSpeedup` and query `speedup` should be greater than `1` on the development machine. Record the sample size, normalized per-lookup values, raw medians, and actual ratios in the task completion note; do not hard-code timing assertions.

Run: `bun run typecheck && bun test tests/dashboard`

Expected: PASS.

- [ ] **Step 8: Commit Task 1**

```bash
git add src/dashboard/derivations.ts src/dashboard/scripts.ts tests/dashboard/derivations.test.ts tests/dashboard/dom.test.ts scripts/benchmark-dashboard.ts
git commit -m "perf: share dashboard repository derivations"
```

### Task 2: Reachable navigation and coherent repository scope

**Files:**
- Modify: `src/dashboard/library.ts:9-27, 124-164, 210-270`
- Modify: `src/dashboard/scripts.ts:158-190, 1840-1865, 2029-2047, 2700-2730, 2820-2855`
- Modify: `tests/dashboard/library.test.ts`
- Modify: `tests/dashboard/dom.test.ts:40-320`

- [ ] **Step 1: Replace the stale navigation-removal test with failing reachability tests**

Require two open navigation groups in order: **GitHub Lists** (Unlist plus alphabetized Lists) and **Utilities** (Operations, Settings). Click each utility item and assert the matching page heading and `aria-current="page"`.

```ts
expect(navigationLabels(directNavigationList(utilities))).toEqual([
  'Operations',
  'Settings'
])
operationsButton.click()
expect(root.querySelector('.operations-page h1')?.textContent).toBe('Operations')
settingsButton.click()
expect(root.querySelector('.settings-page h1')?.textContent).toBe('Settings')
```

Preserve assertions that removed triage/tag/history sidebar destinations stay absent.

- [ ] **Step 2: Run the navigation tests to verify RED**

Run: `bun test tests/dashboard/dom.test.ts --test-name-pattern 'navigation|Operations|Settings'`

Expected: FAIL because Utilities, Operations, and Settings are absent.

- [ ] **Step 3: Restore persistent utility navigation**

Add a second `details.nav-group` to `Navigation()`:

```ts
details(
  {class: 'nav-group nav-group-utilities', open: true},
  summary('Utilities'),
  ul(
    {class: 'nav-list nav-list-secondary'},
    NavItem('Operations', {kind: 'operations'}, null),
    NavItem('Settings', {kind: 'settings'}, null)
  )
)
```

Do not hide these destinations on mobile. Keep selection/dialog reset behavior centralized in `NavItem()`.

- [ ] **Step 4: Write failing tests for the single population model and exact headings**

Simplify `LibraryView` exactly to:

```ts
export type LibraryView =
  | {readonly kind: 'unlist'}
  | {readonly kind: 'list'; readonly listNodeId: string}
  | {readonly kind: 'operations'}
  | {readonly kind: 'settings'}
```

Star state is a filter within the current Unlist/List population; it must never switch to an `all` or `history` view. Add DOM tests that change the Star state select and assert the library `h1` values exactly:

- `starred` → **Starred repositories**;
- `unstarred` → **Unstarred history**;
- `all` → **All repositories**.

Keep the active context visible separately: the eyebrow/context element says **Unlist** or the selected native List name, and native List rename remains attached to that List context rather than becoming the population heading.

Add a test that the default Filters badge is absent even though “Archived hidden” remains in View options. Search/language/archive must not contribute to `activeAdvancedFilterLabels()`.

Add archived-scope fixtures containing one active and one archived unlisted repository. At the default `hideArchived === true`, assert the Unlist sidebar count and visible result count are both `1`; after showing archived repositories, await VanJS flushing and assert both counts become `2`. Apply the same current archive scope to native List counts so navigation and results never silently count different populations.

- [ ] **Step 5: Run the scope tests to verify RED**

Run: `bun test tests/dashboard/library.test.ts tests/dashboard/dom.test.ts`

Expected: FAIL on stale view kinds, Star state changing view identity, noncanonical headings, the default filter badge, and archived count/result mismatch.

- [ ] **Step 6: Implement the chosen population, heading, filter, and count semantics**

Remove `BuiltInView`, `inbox`, `backlog`, `due`, `organized`, `all`, `history`, and `tag` from `LibraryView`, `matchesView()`, titles, and branches. `matchesView()` handles only Unlist and a native List constraint; Operations and Settings never enter repository querying. Delete the Star-state handler's `setActiveView()` call so Unlist/List identity remains unchanged.

Add the exact pure helper:

```ts
function populationTitle(value: StarFilter): string {
  return {
    starred: 'Starred repositories',
    unstarred: 'Unstarred history',
    all: 'All repositories'
  }[value]
}
```

Render this as the library `h1` directly from `starState`. Render `Unlist` or the selected List name as separately reactive context, preserving the native List edit control. Rename `activeFilterLabels()` to `activeAdvancedFilterLabels()` and include only controls physically inside `.advanced-filters`: star state, triage, disabled, and date constraints. `clearAdvancedFilters()` resets only those controls; search, language, archive, and sort stay unchanged.

Make `deriveViewCounts()` accept the same archive inclusion used by `currentQuery()`. Navigation passes `hideArchived.val ? 'exclude' : 'all'`, so the default Unlist/List counts exclude archived repositories and toggling archived visibility updates both sidebar and results from the same scope. Do not apply Search, Language, Star state, or advanced filters to sidebar counts.

- [ ] **Step 7: Remove stale recovery/navigation references**

Replace the native-List-disappearance fallback that selects hidden Inbox with `{kind: 'unlist'}`. Delete dead `viewTitle()`/`viewEyebrow()` branches and dead `LibraryView` cases. Keep local triage annotations and controls; only remove unreachable navigation concepts.

- [ ] **Step 8: Run dashboard tests and typecheck**

Run: `bun run typecheck && bun test tests/dashboard`

Expected: PASS, including utility reachability, the four-kind `LibraryView`, all three exact population headings, stable Unlist/List selection across Star state changes, an empty default advanced-filter badge, and archive-aligned sidebar/result counts.

- [ ] **Step 9: Commit Task 2**

```bash
git add src/dashboard/library.ts src/dashboard/scripts.ts tests/dashboard/library.test.ts tests/dashboard/dom.test.ts
git commit -m "fix: restore complete dashboard navigation"
```

### Task 3: Stable ready shell and slice-based state publication

**Files:**
- Modify: `src/dashboard/derivations.ts`
- Modify: `src/dashboard/scripts.ts:50-130, 138-165, 243-380, 2497-2540, 2850-2910`
- Modify: `tests/dashboard/derivations.test.ts`
- Modify: `tests/dashboard/dom.test.ts`

- [ ] **Step 1: Write failing material-equality tests for every published slice**

Create a generic side-effect-free `materialFingerprint(value)` and a `dashboardSliceFingerprints(state)` helper covering every mounted-UI input: `phase`, `identity`, `authorization`, `writeAuthorization`, `sync`, `nativeListSync`, `nativeListMembership`, `nativeListRename`, `triageCounts`, `library`, `mutations`, and `error`. Primitive `phase` uses direct equality; nullable structured slices use deterministic serialization of their existing ordered fields without sorting or mutating domain arrays.

Tests must prove a deep clone produces identical fingerprints for every slice, then change one slice at a time and prove exactly that slice's fingerprint changes—including each existing `readiness` variant in `nativeListMembership` and `nativeListRename`. Do not add error/evidence fields to those readiness-only interfaces. The library cases include repository metadata/star state, annotation, native List metadata, and membership; mutation cases include jobs, batches, and history. This is the material-equality contract used to suppress every no-op signal assignment, not just library assignments.

- [ ] **Step 2: Write failing DOM identity/focus tests for identical and mutation-only polls**

Expose a test-only production-safe `renderAppState(state)` that delegates to real `applyState()`. Mount a ready dashboard and capture exact references to `.sidebar`, `.library-page`, `.repository-list`, and every `.repository-row-shell`. Focus a repository row and set list scroll to `96`; apply (a) an identical deep-cloned state and (b) a mutation-only state. After each `await browserWindow.happyDOM.whenAsyncComplete()`, assert all captured nodes are `===` the current nodes, the focused row and scroll offset are unchanged, and only the row's nested mutation status/control state changes for case (b).

Add separate focused-navigation assertions: focus the current Unlist nav button, apply identical and mutation-only polls, flush VanJS, and assert the same `.sidebar` and same nav button instances remain connected and focused. These tests must also reset the counted repository-query runner and assert neither poll evaluates the query again.

Add a material metadata-only library poll with unchanged repository IDs and result membership but a changed repository name/description and native List display name. Assert the new content renders and the query runs once. Cover both focus locations: (a) a focused repository row is restored to the reconstructed row with the same `data-repository-node-id` and list scroll remains `96`; (b) a focused Search input remains connected, retains its value/selection, and remains focused while affected row/context content updates.

```ts
expect(root.querySelector('.sidebar')).toBe(sidebar)
expect(root.querySelector('.library-page')).toBe(page)
expect(root.querySelector('.repository-list')).toBe(list)
expect([...root.querySelectorAll('.repository-row-shell')]).toEqual(rows)
expect(document.activeElement).toBe(focusedElement)
expect(list.scrollTop).toBe(96)
```

- [ ] **Step 3: Write failing workspace, authentication, and account-switch tests**

Click a native List navigation item while Unlist is active. Because both views classify as workspace kind `library`, assert `.library-page` remains the same node while the directly reactive context/heading, `aria-current`, query results, and native List edit affordance update after VanJS flushing. Click Unlist and assert the same page node remains while results/context return. This prevents a workspace-kind optimization from making `activeView` changes invisible.

Add a ready-to-reauthentication test through the real authentication action path. Expose a narrow test helper that delegates to `sendAction()`; stub a deferred `start-device-auth` response. After dispatch, call `await browserWindow.happyDOM.whenAsyncComplete()` before asserting that full `emptyState` publication has removed the ready library, identity, Lists, mutation status, membership readiness, and rename readiness from mounted UI—not merely changed aggregate `appState`. Resolve the response with `phase: 'reauthentication'`, flush VanJS again, and assert the reauthentication loading state renders without stale ready content.

Add an account-switch regression with one unchanged `mutations` object containing jobs for accounts `42` and `7`. Publish identity `42` and assert repository status comes from account `42`; then publish an otherwise equivalent state with identity `7` and the exact same mutations reference/fingerprint. After flushing, assert `latestJobsByRepository` and rendered status use account `7`, proving identity changes invalidate the index.

- [ ] **Step 4: Run focused tests to verify RED**

Run: `bun test tests/dashboard/derivations.test.ts tests/dashboard/dom.test.ts --test-name-pattern 'material equality|identical poll|mutation-only poll|metadata-only poll|stable library workspace|reauthentication|account switch'`

Expected: FAIL because the complete slice set, stable node/focus behavior, metadata-only restoration, full authentication reset publication, account-aware job-index invalidation, and direct Unlist/List reactivity do not exist.

- [ ] **Step 5: Publish all UI slices only on material change**

Keep `appState` as the authoritative response for imperative action handlers only. Add published signals for `phase`, `identity`, `authorization`, `writeAuthorization`, `sync`, `nativeListSync`, `nativeListMembership`, `nativeListRename`, `triageCounts`, `library`, `mutations`, and `error`, plus a cached fingerprint for every structured signal. Implement one `publishIfMateriallyChanged()` path and use it for all structured slices; use direct primitive equality for phase.

Rebuild `latestJobsByRepository` when either the mutations fingerprint **or** active `identity.githubUserId` changes. Cache an index input key containing both values, so an account switch cannot reuse the previous account's map when mutations are materially unchanged:

```ts
const latestJobsInputKey = `${publishedIdentity.val?.githubUserId ?? ''}:${mutationsFingerprint}`
```

After this migration, no mounted reactive renderer may read `appState.val`; mounted UI reads the narrow published signals. `applyState()` may still assign `appState` for synchronous command logic, but a semantically identical response must publish zero UI-signal assignments. Authentication actions must replace the existing `appState.val = emptyState` shortcut with `applyState(emptyState)` (or a single equivalent function that publishes every slice and performs the same account/reset/poll cleanup) before sending the runtime message. Add source/behavior regression coverage proving no authentication path clears only the aggregate state.

```ts
const publishedPhase = van.state<AppPhase>('loading')
const publishedIdentity = van.state<AppState['identity']>(null)
const publishedNativeListMembership = van.state<AppState['nativeListMembership']>(undefined)
const publishedNativeListRename = van.state<AppState['nativeListRename']>(undefined)
const publishedLibrary = van.state<AppState['library']>(null)
const publishedMutations = van.state<AppState['mutations']>(null)
const latestJobsByRepository = van.state<ReadonlyMap<string, MutationJobRecord>>(new Map())
const workspaceKind = van.derive(() => classifyWorkspace(publishedPhase.val, activeView.val))
```

`classifyWorkspace()` returns `library` for both `unlist` and `list`, `operations` for Operations, `settings` for Settings, and a phase-specific kind otherwise.

- [ ] **Step 6: Make navigation, headings, results, and mutation UI depend on exact slices**

Mount `Navigation()` once. Its only reactive dependencies are `publishedLibrary`, `activeView`, and `hideArchived` (the current navigation count scope); it must not read mutations, sync, authorization, errors, or the aggregate `appState`. Bind each nav item's `aria-current`/class directly to `activeView` without replacing the sidebar or button, so focused navigation survives polls.

Mount one persistent `ReadyLibraryState()` whenever `workspaceKind === 'library'`. The population `h1`, Unlist/List context, native List rename affordance, and query derive must read `activeView` directly, because Unlist↔List does not change workspace kind. Use the single persistent `repositoryResults` derive specified in Task 1. Membership controls/readiness bind to `publishedNativeListMembership`; rename readiness binds to `publishedNativeListRename`, while inline rename validation/runtime errors remain in the existing local `nativeListRenameError` signal. No mounted binding may fall back to the aggregate state for either capability. Publish library changes only when materially different; mutation-only changes update row status and checkbox-disabled bindings through the account-aware `latestJobsByRepository` without replacing list/row nodes. Settings and Operations similarly read only their necessary published slices and retain their page node while their workspace kind is unchanged.

- [ ] **Step 7: Preserve scroll/focus across legitimate result replacement**

When active view, search/filter, or any materially changed library reconstructs rows—even when repository IDs and result membership are unchanged—capture list scroll, the focused repository ID, and Search focus/value/selection before publication. Prefer retaining keyed row/search nodes; where VanJS reconstruction is unavoidable, restore the focused repository to the new row with the same ID, restore Search focus/selection, and restore scroll after VanJS microtask flushing. If a repository is removed, use the existing available-result/dialog-invoker fallback rather than focusing `body`. Do not run this restoration path for identical or mutation-only polls because those paths retain list/row identity.

- [ ] **Step 8: Verify GREEN and unchanged behavior**

Run: `bun test tests/dashboard/derivations.test.ts tests/dashboard/dom.test.ts`

Expected: PASS for equality/publication of every slice including membership and rename, one-query-per-filter integration, identical/mutation-only page/list/row/sidebar identity, metadata-only content refresh with row/Search focus and scroll preservation, full ready-to-reauthentication clearing, account-switch job-index invalidation, nested mutation updates, and Unlist↔List reactivity within one library page.

Run: `bun run typecheck && bun test tests/dashboard`

Expected: PASS.

- [ ] **Step 9: Re-run benchmark after integration**

Run: `bun scripts/benchmark-dashboard.ts`

Expected: same result semantics; output retains the bounded 200-lookup legacy sample, full 10,000/50,000 indexed/query datasets, normalized per-lookup job comparison, and ratios greater than `1`. Record numbers for final reporting.

- [ ] **Step 10: Commit Task 3**

```bash
git add src/dashboard/derivations.ts src/dashboard/scripts.ts tests/dashboard/derivations.test.ts tests/dashboard/dom.test.ts
git commit -m "perf: keep dashboard shell stable during polling"
```

### Task 4: Focus lifecycle, landmarks, and scoped announcements

**Files:**
- Modify: `src/dashboard/index.html:5-12`
- Modify: `src/dashboard/scripts.ts:138-155, 565-640, 2060-2430, 1646-1685`
- Modify: `src/dashboard/styles.css:98-115, 1623-1635`
- Modify: `tests/dashboard/dom.test.ts`
- Modify: `tests/dashboard/styles.test.ts`

- [ ] **Step 1: Write failing landmark/live-region tests**

Parse `index.html` and mount the dashboard into a neutral `div#app`. Assert exactly one rendered `main`, no `aria-live` on `#app`, and only targeted `.result-count`, `.selection-bar`, and `.status-stack` live regions.

Expected markup:

```html
<meta name="color-scheme" content="light dark">
<div id="app"></div>
```

- [ ] **Step 2: Write failing success-focus tests**

Extend the existing membership, unstar, and native List rename success tests:

- membership success returns focus to the captured repository row or review invoker;
- unstar queue success focuses the first surviving repository row, or the Operations nav item when no selected row survives;
- rename success restores focus to the same List's Edit button.

Assert a connected, visible element owns focus; never merely assert the dialog disappeared.

- [ ] **Step 3: Run focused tests to verify RED**

Run: `bun test tests/dashboard/dom.test.ts --test-name-pattern 'landmark|live region|focus after|rename'`

Expected: FAIL on nested main/broad live region and success-path active element assertions.

- [ ] **Step 4: Fix document semantics and announcement scope**

Replace the static `<main id="app" aria-live="polite">` with `<div id="app">`; keep the `main.workspace` created by `Dashboard()`. Retain concise result/selection/status live regions, add `role="status"` where appropriate, and avoid nesting dialogs/navigation under a live region.

- [ ] **Step 5: Restore focus after successful asynchronous operations**

Capture the invoker before calling each reset function because reset nulls it:

```ts
const invoker = membershipDialogInvoker
resetMembershipPreview()
applyState(response.data)
restoreDialogInvoker(invoker)
```

For unstar success, choose a surviving row based on the prior selection and updated query; otherwise focus the Operations nav item identified by a stable `data-view-kind`. For rename, retain `listNodeId`, reset the editor, then focus its Edit control after the verified state renders. Guard every target with `isConnected`; use the existing fallback helper rather than `document.body.focus()`.

- [ ] **Step 6: Add visible Import JSON focus**

Add a style regression test requiring `.file-action:focus-within` to use the same 3px focus token and offset as other controls. Implement it without making the hidden input visible:

```css
.file-action:focus-within {
  outline: 3px solid var(--focus-ring);
  outline-offset: 2px;
}
```

- [ ] **Step 7: Run accessibility regressions**

Run: `bun test tests/dashboard/dom.test.ts tests/dashboard/styles.test.ts && bun run typecheck`

Expected: PASS.

- [ ] **Step 8: Commit Task 4**

```bash
git add src/dashboard/index.html src/dashboard/scripts.ts src/dashboard/styles.css tests/dashboard/dom.test.ts tests/dashboard/styles.test.ts
git commit -m "fix: harden dashboard focus and landmarks"
```

### Task 5: Semantic themes, typography, contrast, reflow, and loading

**Files:**
- Modify: `src/dashboard/styles.css`
- Modify: `tests/dashboard/styles.test.ts`

- [ ] **Step 1: Replace typography-lock tests with failing role tests**

Require separate role tokens and fallbacks:

```css
--font-prose: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
--font-technical: "Geist Mono", "SFMono-Regular", Consolas, "Liberation Mono", monospace;
--type-reading-size: 1rem;
--measure-prose: 66ch;
```

Assert `body`, forms, dialogs, and long explanatory copy use `--font-prose`; brand, repository metadata, counts, status codes, and technical values use `--font-technical`. Keep the existing local Geist Mono asset and `font-display: swap`; do not add a font dependency.

- [ ] **Step 2: Add failing resolved light/dark contrast and forced-colors tests**

Parse declarations into two complete maps: light tokens from `:root`, and dark tokens formed by overlaying the `@media (prefers-color-scheme: dark) :root` declarations on the light map. Add a recursive `resolveToken(map, name)` that follows `var(--role)` references, rejects cycles/missing roles, and returns an opaque hex color for every contrast-critical role. Run the same contrast matrix against both resolved maps:

- `--text-primary` and `--text-secondary` on `--canvas`, `--surface`, and `--surface-strong`: at least 4.5:1;
- `--text-noop` on `--surface-noop` and `--text-nav-count-active` on `--surface-nav-active`: at least 4.5:1;
- `--text-success|warning|danger` on their matching `--surface-success|warning|danger`: at least 4.5:1;
- `--action-primary-text` on `--action-primary`: at least 4.5:1;
- `--border-control` against `--canvas`, `--surface`, and `--surface-strong`: at least 3:1;
- `--focus-ring` against `--canvas`, `--surface`, `--surface-strong`, and `--surface-nav-active`: at least 3:1;
- selected/current boundaries against adjacent surfaces: at least 3:1.

Require the dark block to explicitly override every canvas/surface/text/control/focus/action/status role in that matrix; a passing dark test may not silently inherit a light critical color. Do not use alpha colors for tested text/border roles because contrast must not depend on an implicit backdrop.

Parse the `@media (forced-colors: active)` block and assert required selectors are bound to system colors, not merely that the media query exists:

- `.nav-item[aria-current="page"]` and `.repository-row.is-selected`: `background: Highlight`, `color: HighlightText`, `border-color: Highlight`;
- `button`, `input`, `select`, `textarea`, and `.file-action`: `background: ButtonFace`, `color: ButtonText`, `border-color: ButtonText`;
- `:focus-visible` and `.file-action:focus-within`: outline using `Highlight`;
- `.status-banner` and success/warning/danger variants: `background: Canvas`, `color: CanvasText`, `border-color: CanvasText`;
- links: `color: LinkText`.

`forced-color-adjust: none` is allowed only on the selected/current and status elements whose explicit system-color mapping the tests verify.

- [ ] **Step 3: Add failing responsive/content stress tests**

Require:

- `.nav-label`, native List choice labels, repository headings, inspector titles, and account names to use `overflow-wrap: anywhere` or wrapping rather than mandatory ellipsis;
- no global mobile `overflow-x: hidden` masking defects;
- `.selection-control` to have a 44px minimum inline/block target at `max-width: 700px` and/or coarse pointer;
- inspector heading/actions to stack at narrow widths;
- prose to retain a `max-width` measure and 16px ordinary reading floor;
- no dead `.nav-list-primary`, `.topbar`, `.privacy-chip`, `.state-index`, or `.feature-grid` selectors.

- [ ] **Step 4: Add failing loading-animation test**

Require that skeleton shimmer does not animate `background-position`. Accept either a static gradient or a bounded `::after` pseudo-element animated only with `transform`; preserve `prefers-reduced-motion` suppression.

- [ ] **Step 5: Run style tests to verify RED**

Run: `bun test tests/dashboard/styles.test.ts`

Expected: FAIL on prose role, unresolved or missing light/dark roles, any failing pair in either contrast matrix, missing forced-colors selector bindings, wrapping/touch rules, dead selectors, and shimmer property.

- [ ] **Step 6: Refactor the light palette into semantic roles**

Preserve the current parchment/navy/sage/copper relationships but stop using whole-element opacity for readable text. Introduce explicit no-op text/background and active-count tokens whose computed pairs pass 4.5:1. Introduce a dedicated control border that passes 3:1; keep quieter separator tokens for nonessential lines.

Replace repeated literals (`#d1a477`, `#cda49c`, `#9cafa2`, `#b6a891`) with narrowly named semantic tokens. Replace component declarations with role tokens rather than duplicating light values.

- [ ] **Step 7: Compose dark and forced-colors themes to the tested contracts**

Under `prefers-color-scheme: dark`, explicitly remap every contrast-matrix role: canvas/elevated surfaces, primary/secondary/no-op/nav-count text, control/current boundaries, action text/background, focus, selection, and success/warning/danger text/surfaces. Verify dark elevation through lightness differences, not shadows alone, then run the resolver test so both complete maps satisfy the same thresholds.

Under `forced-colors: active`, add the exact selector/system-color bindings from Step 2 using `Canvas`, `CanvasText`, `ButtonFace`, `ButtonText`, `Highlight`, `HighlightText`, and `LinkText`. Set `forced-color-adjust: none` only where the tested explicit mapping preserves a boundary that automatic adjustment would remove.

- [ ] **Step 8: Apply typography roles and responsive fixes**

Use proportional prose for body/forms/dialog explanations and Geist Mono only for brand/technical roles. Raise ordinary reading copy from 13px to `1rem`, retune line height, and keep dense metadata/labels at accessible smaller roles.

Allow names to wrap, add `min-width: 0` to flex/grid children, stack inspector heading/actions at narrow widths, remove mobile overflow masking, and make checkbox selection controls 44×44px. Preserve all existing functionality at 320px.

- [ ] **Step 9: Replace paint-heavy shimmer and remove dead CSS**

Use a static skeleton or `transform: translateX()` pseudo-element; do not animate layout or background position. Delete orphaned navigation/marketing selectors only after confirming no matching dashboard markup via:

Run: `rg 'topbar|privacy-chip|state-index|feature-grid|nav-list-primary' src/dashboard tests/dashboard`

Expected after implementation: no live selector/markup references, except an explicit negative regression assertion if retained in tests.

- [ ] **Step 10: Run style, dashboard, and type checks**

Run: `bun test tests/dashboard/styles.test.ts tests/dashboard/dom.test.ts && bun run typecheck`

Expected: PASS.

- [ ] **Step 11: Run the scoped Impeccable detector**

Run: `node /Users/jolo/.pi/agent/skills/impeccable/scripts/detect.mjs --scope type src/dashboard/index.html src/dashboard/scripts.ts src/dashboard/styles.css src/dashboard/library.ts`

Expected: exit 0, or only the known font-face declaration location documented as an intentional local Geist Mono technical role. Do not change product typography merely to silence a declaration-site false positive.

- [ ] **Step 12: Commit Task 5**

```bash
git add src/dashboard/styles.css tests/dashboard/styles.test.ts
git commit -m "feat: add accessible responsive dashboard themes"
```

### Task 6: Cross-platform slot-sized extension icon assets

**Files:**
- Create: `scripts/png.ts`
- Create: `scripts/generate-icons.ts`
- Create: `tests/scripts/png.test.ts`
- Create: `src/images/icon-16.png`
- Create: `src/images/icon-32.png`
- Create: `src/images/icon-48.png`
- Create: `src/images/icon-64.png`
- Create: `src/images/icon-128.png`
- Modify: `package.json`
- Modify: `bun.lock`
- Modify: `src/manifest.json:14-40`
- Modify: `scripts/inspect-build.ts`
- Modify: `tests/scripts/inspect-build.test.ts`
- Retain: `src/images/icon.png` as the unreferenced high-resolution generator source

- [ ] **Step 1: Write failing tests for a side-effect-free PNG helper and build contract**

Create `tests/scripts/png.test.ts` against a not-yet-created `scripts/png.ts`. Test `readPngDimensions(bytes: Uint8Array)` with a minimal valid PNG header containing known big-endian IHDR width/height, then assert fixed errors for a bad signature, truncated IHDR, zero dimension, and non-IHDR first chunk. The helper module must perform no file I/O and have no top-level execution.

Extend `tests/scripts/inspect-build.test.ts` fixtures/expectations so every manifest icon section (`icons`, Chromium action, Firefox browser action) has exact size keys and maps key `N` to `images/icon-N.png`, with built PNG dimensions matching `N`. Explicitly test that reusing the same `images/icon-16.png` path for size `16` across all three sections is valid. Add a failing fixture where different size keys (for example `16` and `32`) reuse one path and require rejection. Tests must import `readPngDimensions` from `scripts/png.ts`, never import top-level `scripts/inspect-build.ts` (which executes inspection on import).

- [ ] **Step 2: Run focused tests to verify RED**

Run: `bun test tests/scripts/png.test.ts tests/scripts/inspect-build.test.ts`

Expected: FAIL because `scripts/png.ts` and slot-specific assets/manifest entries do not exist.

- [ ] **Step 3: Implement the pure PNG parser**

Create `scripts/png.ts` with only types/constants and:

```ts
export interface PngDimensions {
  readonly width: number
  readonly height: number
}

export function readPngDimensions(bytes: Uint8Array): PngDimensions {
  // Validate the 8-byte PNG signature, minimum IHDR bytes, first chunk type
  // "IHDR", and positive big-endian width/height at byte offsets 16 and 20.
}
```

Use `DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(offset, false)`. Return dimensions only; file reading remains the caller's responsibility.

Run: `bun test tests/scripts/png.test.ts`

Expected: PASS.

- [ ] **Step 4: Declare Sharp and add the cross-platform generator**

Run: `bun add --dev sharp`

Expected: `package.json` and `bun.lock` declare a frozen Sharp development dependency.

Add `"generate:icons": "bun scripts/generate-icons.ts"` to package scripts. Create `scripts/generate-icons.ts` using the declared `sharp` package, `fileURLToPath`, and repository-relative URLs so it works regardless of the caller's current directory. Export `generateIconSet(sourcePath, outputDirectory)` for focused use, and guard command execution with `if (import.meta.main)`.

```ts
const iconSizes = [16, 32, 48, 64, 128] as const
for (const size of iconSizes) {
  await sharp(sourcePath)
    .resize(size, size, {fit: 'contain'})
    .png({compressionLevel: 9})
    .toFile(join(outputDirectory, `icon-${size}.png`))
}
```

Do not use `sips`, ImageMagick, or another platform executable. Keep `src/images/icon.png` as source artwork; it must not be referenced by the manifest or copied to production builds.

- [ ] **Step 5: Generate and verify source assets cross-platform**

Run: `bun run generate:icons`

Expected: creates all five `src/images/icon-N.png` files.

Run:

```bash
bun -e 'import {readFile} from "node:fs/promises"; import {readPngDimensions} from "./scripts/png.ts"; for (const size of [16,32,48,64,128]) console.log(size, readPngDimensions(await readFile(`src/images/icon-${size}.png`)))'
```

Expected: each line reports matching square dimensions. Inspect 16px and 128px visually for transparent edges and recognizability; retain the source file for reproducible regeneration.

- [ ] **Step 6: Point every manifest slot to its matching asset**

Update `icons`, `chromium:action.default_icon`, and `firefox:browser_action.default_icon` so key `N` points to `images/icon-N.png`. No production manifest entry may reference `images/icon.png`.

- [ ] **Step 7: Enforce dimensions through the pure helper**

Import `readPngDimensions` into `scripts/inspect-build.ts`. Require exact icon keys `16,32,48,64,128`, matching filenames, and PNG dimensions for each built file. Build one cross-section `Map<path, size>`: allow repeated appearances of the same `(size, path)` pair across `icons`, Chromium action, and Firefox browser action, but reject a path if it is associated with more than one distinct size key. Also reject missing keys, mismatched dimensions, and any manifest reference to the high-resolution source. Keep existing host, permission, font, remote-code, and forbidden-text checks unchanged.

- [ ] **Step 8: Build both browsers and verify GREEN**

Run: `rm -rf dist && bun run build:chrome && bun run build:firefox && bun run inspect:build && bun test tests/scripts/png.test.ts tests/scripts/inspect-build.test.ts`

Expected: both builds succeed; inspection prints `Built manifest and bundle inspection passed`; pure PNG and build tests pass; no built manifest references or includes the high-resolution source.

- [ ] **Step 9: Verify the dependency lock and commit Task 6**

Run: `bun install --frozen-lockfile`

Expected: PASS without modifying `bun.lock`.

```bash
git add package.json bun.lock scripts/png.ts scripts/generate-icons.ts tests/scripts/png.test.ts src/manifest.json src/images/icon-*.png scripts/inspect-build.ts tests/scripts/inspect-build.test.ts
git commit -m "perf: generate slot-sized extension icons"
```

### Task 7: Final polish and complete verification

**Files:**
- Modify only as required by verified defects: `src/dashboard/index.html`, `src/dashboard/library.ts`, `src/dashboard/scripts.ts`, `src/dashboard/styles.css`, `tests/dashboard/*`, `scripts/benchmark-dashboard.ts`, `scripts/png.ts`, `scripts/generate-icons.ts`, `scripts/inspect-build.ts`, `tests/scripts/png.test.ts`, `tests/scripts/inspect-build.test.ts`, `package.json`, `bun.lock`, `src/manifest.json`, `src/images/icon-*.png`
- Modify: `docs/superpowers/plans/2026-08-19-dashboard-technical-remediation.md` (check completed steps only)

- [ ] **Step 1: Run focused dashboard QA**

Run: `bun test tests/dashboard`

Expected: all dashboard library, derivation, DOM, and style tests pass.

- [ ] **Step 2: Run source and type safety checks**

Run: `bun install --frozen-lockfile && bun run check:source && bun run typecheck`

Expected: frozen install leaves `bun.lock` unchanged; source/type commands pass with no forbidden `any` syntax or TypeScript errors.

- [ ] **Step 3: Run the complete test suite from a clean build state**

Run: `rm -rf dist && bun run build:chrome && bun test`

Expected: all tests pass. Building Chrome first is required because `tests/scripts/inspect-build.test.ts` fingerprints an existing build artifact.

- [ ] **Step 4: Build and inspect both production targets**

Run: `rm -rf dist && bun run build:chrome && bun run build:firefox && bun run inspect:build`

Expected: Chrome and Firefox builds succeed and inspection passes, including local font, minimal permissions/hosts, no remote code, and exact icon dimensions.

- [ ] **Step 5: Re-run detector and benchmark**

Run:

```bash
node /Users/jolo/.pi/agent/skills/impeccable/scripts/detect.mjs src/dashboard/index.html src/dashboard/scripts.ts src/dashboard/styles.css src/dashboard/library.ts
bun scripts/benchmark-dashboard.ts
```

Expected: no unexplained detector findings; benchmark declares the bounded 200-lookup legacy sample, full 10,000-repository/50,000-job indexed/query datasets, raw medians, normalized job cost per lookup, and indexed/shared paths faster than legacy/repeated paths. Record all actual output in the completion report.

- [ ] **Step 6: Perform representative manual browser checks**

Load the Chrome production build's options page and inspect at wide desktop and 320px viewport:

1. Navigate to Unlist, a GitHub List, Operations, and Settings.
2. Tab through navigation, repository rows, Import JSON, dialogs, and rename controls; verify visible focus.
3. Start or simulate pending work; verify one-second state updates do not move focus or scroll.
4. Verify successful rename, membership queue, and unstar queue move focus to the documented destination.
5. Set 200% text zoom and test long unbroken repository/List/account names without clipped core content or horizontal page scrolling.
6. Switch the OS/browser emulation between light and dark and inspect all status/selection/control states.
7. Enable forced colors and confirm current navigation, selection, focus, inputs, and statuses remain distinguishable.
8. Enable reduced motion and confirm loading has no motion.

Expected: no blocked tasks, lost focus, clipped core labels, hidden overflow, or theme/state ambiguity. If extension loading is unavailable, document this exact residual rather than claiming the check passed.

- [ ] **Step 7: Inspect the final diff for accidental churn**

Run:

```bash
git status --short
git diff --check
git diff master...HEAD --stat
git diff master...HEAD -- package.json bun.lock src/dashboard src/manifest.json src/images scripts/benchmark-dashboard.ts scripts/png.ts scripts/generate-icons.ts scripts/inspect-build.ts tests/dashboard tests/scripts/png.test.ts tests/scripts/inspect-build.test.ts
```

Expected: no whitespace errors, temporary files, debug logging, unrelated code, stale selectors, or generated `dist/` files. Every change maps to the approved spec.

- [ ] **Step 8: Commit final polish only if defects required edits**

If Step 6 or 7 found and fixed real defects:

```bash
git add package.json bun.lock src/dashboard src/manifest.json src/images scripts/benchmark-dashboard.ts scripts/png.ts scripts/generate-icons.ts scripts/inspect-build.ts tests/dashboard tests/scripts/png.test.ts tests/scripts/inspect-build.test.ts
git commit -m "fix: polish dashboard remediation"
```

If no source changes remain, do not create an empty commit.

- [ ] **Step 9: Mark the plan complete and commit documentation**

Check only steps actually completed, then run:

```bash
git add docs/superpowers/plans/2026-08-19-dashboard-technical-remediation.md
git commit -m "docs: complete dashboard remediation plan"
```

- [ ] **Step 10: Request final code review before branch integration**

Use `@superpowers/requesting-code-review` with the approved spec, this plan, commit range, benchmark output, detector output, test/build evidence, and any manual-browser residual. Resolve all P0/P1 findings and re-run affected verification before using `@superpowers/finishing-a-development-branch`.
