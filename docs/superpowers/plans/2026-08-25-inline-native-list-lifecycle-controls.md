# Inline Native GitHub List Lifecycle Controls Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the dedicated **Manage GitHub Lists** page with a `+` action beside **My Lists**, a separate remove action on every native GitHub List row, and compact lifecycle readiness/recovery status in the rail.

**Architecture:** Keep the existing lifecycle transport, durable operation runner, release gate, message protocol, and confirmation dialogs unchanged. Move only the lifecycle UI ownership: the dashboard shell owns the dialog host, the List rail owns create/remove invokers and compact status, and shell-level rail reconciliation—independent of `.library-page`—owns fallback focus when a row is disabled or later disappears. Remove the obsolete management route from `LibraryView` and `DashboardWorkspace`.

**Tech Stack:** TypeScript, VanJS, CSS, Bun test/happy-dom, Extension.js, OpenSpec, Impeccable design artifacts.

**Approved design:** `docs/superpowers/specs/2026-08-25-inline-native-list-lifecycle-controls-design.md`

**Workspace constraint:** Work directly on `master`; do not create a worktree. Preserve the existing staged, unstaged, and untracked dashboard/Impeccable work with an external full-content backup plus an immutable stash OID. After implementation, account for every original hunk as restored, semantically incorporated by a named implementation commit, or explicitly reported as incompatible with the approved design; never silently discard overlapping user intent.

---

## File map

- Modify `openspec/changes/add-native-list-lifecycle/design.md` — replace the management-page decision with inline rail controls and retained recovery behavior.
- Modify `openspec/changes/add-native-list-lifecycle/specs/native-list-lifecycle/spec.md` — make inline create/remove availability, disabled guidance, sync status, and lifecycle refresh normative.
- Modify `openspec/changes/add-native-list-lifecycle/tasks.md` — add and track the approved UI refinement tasks without changing deferred live-release tasks 8.2–8.4.
- Modify `src/dashboard/library.ts` — remove the obsolete `native-list-management` view variant.
- Modify `src/dashboard/derivations.ts` — remove the obsolete workspace classification.
- Modify `src/dashboard/scripts.ts` — render inline controls/status, mount the dialog host at shell scope, remove the management workspace, and reconcile remove-control focus.
- Modify `src/dashboard/styles.css` — add compact rail control/status styles and remove management-page-only styles while retaining dialog styles.
- Modify `tests/dashboard/dom.test.ts` — migrate lifecycle UI tests to rail invokers/status and add structural/focus/recovery coverage.
- Modify `tests/dashboard/styles.test.ts` — test heading action, sibling row actions, narrow sizing, forced colors, and removed management selectors.
- Modify `DESIGN.md` — replace the management-panel token and prose with inline lifecycle-control patterns.
- Modify `.impeccable/design.json` — replace the management-page component example and synchronize narrative guidance.
- No new runtime source file: the lifecycle UI shares substantial state and focus machinery with `src/dashboard/scripts.ts`; splitting it during this focused interaction change would create a wider refactor.

---

### Task 0: Protect existing uncommitted work

**Files:**
- Preserve exactly: every staged, unstaged, and untracked path reported by Git
- Create outside the repository: full-file archive, staged/unstaged binary patches, status manifest, and exact stash OID

- [ ] **Step 1: Record the current state and create an external backup directory**

Run:

```bash
test "$(git branch --show-current)" = master
backup_dir="$(mktemp -d /tmp/star-list-manager-inline-lifecycle.XXXXXX)"
printf '%s\n' "$backup_dir" > /tmp/star-list-manager-inline-lifecycle-backup-path
git status --porcelain=v2 -z > "$backup_dir/status.porcelain-v2.z"
git diff --binary > "$backup_dir/unstaged.patch"
git diff --cached --binary > "$backup_dir/staged.patch"
git diff --name-only -z > "$backup_dir/unstaged-paths.z"
git diff --cached --name-only -z > "$backup_dir/staged-paths.z"
git ls-files --others --exclude-standard -z > "$backup_dir/untracked-paths.z"
```

Do not inspect or print ignored credential files such as `.env.local`; `git ls-files --others --exclude-standard` excludes them.

- [ ] **Step 2: Archive complete copies of every changed/untracked path**

```bash
backup_dir="$(cat /tmp/star-list-manager-inline-lifecycle-backup-path)"
{
  cat "$backup_dir/unstaged-paths.z"
  cat "$backup_dir/staged-paths.z"
  cat "$backup_dir/untracked-paths.z"
} | sort -zu > "$backup_dir/all-paths.z"
node - "$backup_dir/all-paths.z" "$backup_dir/archive-paths.z" <<'NODE'
const fs = require('node:fs')
const [input, output] = process.argv.slice(2)
const paths = fs.readFileSync(input, 'utf8').split('\0').filter(Boolean)
const existing = paths.filter((path) => fs.existsSync(path))
fs.writeFileSync(output, `${existing.join('\0')}${existing.length ? '\0' : ''}`)
NODE
tar --null -T "$backup_dir/archive-paths.z" -czf "$backup_dir/original-tree.tar.gz"
```

Expected: the archive contains full contents for every path that exists in the working tree. Deleted-path state remains preserved in `status.porcelain-v2.z`, `staged.patch`, and `unstaged.patch`, so a missing path cannot make `tar` fail.

- [ ] **Step 3: Save a named safety stash and record its immutable OID**

```bash
git stash push -u -m "pi-preserve-dashboard-before-inline-list-lifecycle"
backup_dir="$(cat /tmp/star-list-manager-inline-lifecycle-backup-path)"
git rev-parse stash@{0} > "$backup_dir/stash-oid"
stash_oid="$(cat "$backup_dir/stash-oid")"
git cat-file -e "$stash_oid^{commit}"
```

Never resolve the stash later by message or ordinal; use only this recorded OID.

- [ ] **Step 4: Verify the implementation baseline is clean**

```bash
git status --short
git log -1 --oneline
```

Expected: clean tracked/untracked status and the reviewed plan commit at `HEAD`.

---

### Task 1: Revise the active OpenSpec change before code

**Files:**
- Modify: `openspec/changes/add-native-list-lifecycle/design.md:71-74`
- Modify: `openspec/changes/add-native-list-lifecycle/specs/native-list-lifecycle/spec.md:105-110`
- Modify: `openspec/changes/add-native-list-lifecycle/tasks.md:40-47`

- [ ] **Step 1: Replace the management-surface design decision**

Write the decision so it requires:

```markdown
### UI places lifecycle controls directly in My Lists

Render an accessible `+` create control beside the My Lists heading and a
separate remove control beside every synchronized native GitHub List. Unlist
has no remove action. Keep controls visible but disabled with programmatically
associated guidance when lifecycle writes are unsafe. Preserve lifecycle sync,
refresh, queued cancellation, progress, recovery, and ambiguous-outcome status
in a compact rail surface; ordinary star refresh does not replace the fixed
`refresh-native-list-lifecycle` path.
```

- [ ] **Step 2: Replace the lifecycle UI requirement and scenarios**

First revise the earlier release/account gate wording from “expose … only when” to “enable … only when,” so visibility and enablement are not contradictory. Then use normative UI requirements equivalent to:

```markdown
### Requirement: Lifecycle controls are available inline independently of existing Lists
The dashboard SHALL expose native List creation beside the My Lists heading even when synchronization returns zero Lists, SHALL expose a separate removal control for each synchronized native GitHub List, and SHALL NOT expose removal for Unlist. It MUST keep lifecycle controls visible but disabled with programmatically associated readiness guidance when writes are unsafe. It MUST show material synchronization and operation status, retain queued cancellation, and retain a manual `refresh-native-list-lifecycle` recovery path distinct from ordinary Library Refresh. It MUST keep action controls outside live-region text while programmatically associating them, and MUST NOT report success before authoritative read-back.

#### Scenario: Account has no native Lists
- **WHEN** synchronization completes with zero native Lists
- **THEN** the visible create control can begin the preview flow when lifecycle writes are ready

#### Scenario: Lifecycle writes are unavailable
- **WHEN** release capability, account authorization, unsafe synchronization state, an in-flight confirmation, or conflicting work prevents a safe lifecycle write
- **THEN** create and remove controls remain visible but disabled and reference concise visible guidance

#### Scenario: Account has synchronized native Lists
- **WHEN** one or more native GitHub Lists are synchronized
- **THEN** each native List has a separate remove control and Unlist has none

#### Scenario: Operation needs recovery or cancellation
- **WHEN** an operation is queued/preflight, failed, blocked-unknown, or needs renewed confirmation
- **THEN** the rail shows truthful status and the safe cancel, reauthorization, inspection, or fixed lifecycle-refresh action required for that phase

#### Scenario: Lifecycle action updates status text
- **WHEN** the user invokes lifecycle refresh or queued cancellation
- **THEN** the action is outside the status live region, programmatically references that status, and success remains unreported until authoritative read-back
```

- [ ] **Step 3: Add explicit refinement tasks**

Add task items for inline rail markup, retained status/recovery, asynchronous focus fallback, migrated tests, and design-system refresh. Leave tasks 8.2, 8.3, and 8.4 unchecked.

- [ ] **Step 4: Strictly validate the change**

Run:

```bash
openspec validate add-native-list-lifecycle --type change --strict --no-interactive
```

Expected: `Change 'add-native-list-lifecycle' is valid`.

- [ ] **Step 5: Commit the planning revision**

```bash
git add openspec/changes/add-native-list-lifecycle/design.md \
  openspec/changes/add-native-list-lifecycle/specs/native-list-lifecycle/spec.md \
  openspec/changes/add-native-list-lifecycle/tasks.md
git commit -m "docs: revise lifecycle controls for list rail"
```

---

### Task 2: Remove the management route and establish inline DOM structure with failing tests

**Files:**
- Modify: `tests/dashboard/dom.test.ts:808-840, 5356-5372`
- Modify: `src/dashboard/library.ts:11-16, 183-188`
- Modify: `src/dashboard/derivations.ts:12, 74-84`
- Modify: `src/dashboard/scripts.ts:356-390, 433-510, 578-605, 664-790`

- [ ] **Step 1: Rewrite navigation tests first**

Add assertions equivalent to:

```ts
const heading = sidebar?.querySelector('.list-sidebar-heading-row')
const create = heading?.querySelector<HTMLButtonElement>(
  '[data-native-list-create-invoker]'
)
expect(heading?.querySelector('h2')?.textContent).toBe('My Lists')
expect(create?.textContent).toBe('+')
expect(create?.getAttribute('aria-label')).toBe('Create GitHub List')
expect(navigationLabels(directNavigationList(sidebar))).toEqual([
  'Unlist',
  'Alpha List',
  'Middle List',
  'Zulu List'
])
expect(root.textContent).not.toContain('Manage GitHub Lists')
expect(root.querySelector('[data-native-list-management]')).toBeNull()
```

For each native List `<li>`, assert direct-list structure and sibling controls:

```ts
const row = root.querySelector('[data-native-list-row="L_alpha"]')
const navigate = row?.querySelector(':scope > .nav-item')
const remove = row?.querySelector(':scope > [data-native-list-delete-invoker="L_alpha"]')
expect(row?.parentElement).toBe(directNavigationList(sidebar))
expect(navigate?.contains(remove ?? null)).toBe(false)
expect(remove?.getAttribute('aria-label')).toBe('Remove Alpha List GitHub List')
expect(root.querySelector('[data-native-list-row="unlist"] [data-native-list-delete-invoker]')).toBeNull()
```

- [ ] **Step 2: Run the structural tests and verify failure**

```bash
bun test tests/dashboard/dom.test.ts -t "renders inline GitHub List lifecycle controls"
```

Expected: FAIL because the `+` and sibling remove controls do not exist and the management item still renders.

- [ ] **Step 3: Remove obsolete view/workspace variants**

Change the types to:

```ts
export type LibraryView =
  | {readonly kind: 'unlist'}
  | {readonly kind: 'list'; readonly listNodeId: string}
  | {readonly kind: 'operations'}
  | {readonly kind: 'settings'}

export type DashboardWorkspace =
  | AppPhase
  | 'library'
  | 'operations'
  | 'settings'
```

Remove `native-list-management` branches from `queryRepositories`, `classifyWorkspace`, and `createWorkspace`.

- [ ] **Step 4: Mount the lifecycle dialog host once at shell scope**

In `Dashboard`, add `createNativeListLifecycleDialogHost()` as a sibling after `.app-frame`, so dialogs can open from any List-rail invoker and survive Library/Operations/Settings workspace replacement.

Remove `NativeListManagementState`, `NativeListManagementContent`, `managementFocusKey`, `restoreManagementFocus`, and the `nativeListManagementRevision` state. Rename any remaining revision trigger to a rail-specific state only if VanJS needs one; prefer direct reactive reads from `nativeListLifecycleError` and published slices.

- [ ] **Step 5: Render exact direct-list markup**

Keep `Unlist` through `NavItem`. Add a dedicated native List row function:

```ts
function NativeListNavigationRow(
  list: NativeListRecord,
  count: number,
  index: number,
  disabled: boolean,
  describedBy: string | null
) {
  return li(
    {class: 'native-list-nav-row', 'data-native-list-row': list.listNodeId},
    NavButton(list.name, {kind: 'list', listNodeId: list.listNodeId}, count, index),
    button({
      class: 'native-list-remove-button',
      type: 'button',
      'aria-label': `Remove ${list.name} GitHub List`,
      'aria-describedby': disabled ? describedBy : null,
      'data-native-list-delete-invoker': list.listNodeId,
      disabled,
      onclick: (event: MouseEvent) =>
        void previewNativeListDelete(
          list.listNodeId,
          event.currentTarget as HTMLElement
        )
    }, '−')
  )
}
```

Do not nest `NavItem`’s `<li>` inside another `<li>`; split its button construction into a reusable `NavButton` helper or render the native navigation button directly.

- [ ] **Step 6: Run focused tests**

```bash
bun test tests/dashboard/dom.test.ts -t "renders inline GitHub List lifecycle controls"
bun test tests/dashboard/derivations.test.ts tests/dashboard/library.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit route and structure**

```bash
git add src/dashboard/library.ts src/dashboard/derivations.ts \
  src/dashboard/scripts.ts tests/dashboard/dom.test.ts
git commit -m "feat: move GitHub List lifecycle controls into rail"
```

---

### Task 3: Migrate create/delete dialog behavior to rail invokers

**Files:**
- Modify: `tests/dashboard/dom.test.ts:5374-5800`
- Modify: `src/dashboard/scripts.ts:2890-3170`

- [ ] **Step 1: Update create-flow tests to invoke `+` directly**

Remove every navigation click for **Manage GitHub Lists**. Query the create invoker from `.list-sidebar-heading-row`, then retain the existing assertions for required name, explicit visibility, read-only preview, pending state, cancellation, stale account response, and focus restoration.

Add an empty-catalog assertion:

```ts
expect(root.querySelectorAll('[data-native-list-row]')).toHaveLength(0)
expect(create?.disabled).toBe(false)
create?.click()
expect(root.querySelector('.native-list-lifecycle-confirmation')).not.toBeNull()
```

- [ ] **Step 2: Update deletion tests to invoke each row’s remove button**

Use `[data-native-list-delete-invoker="L_current"]` directly from the sidebar. Preserve all existing empty/populated preview, exact-name, partial import, repository-retention wording, cancellation, and no-dispatch assertions.

- [ ] **Step 3: Run migrated dialog tests before implementation adjustments**

```bash
bun test tests/dashboard/dom.test.ts -t "visibility|populated List|empty GitHub List|lifecycle dialog|stale lifecycle preview"
```

Expected: any tests still coupled to management markup FAIL; protocol and dialog behavior should remain otherwise unchanged.

- [ ] **Step 4: Adjust invoker fallback selectors**

Keep `openNativeListCreate` and `previewNativeListDelete` unchanged except for selector ownership. Update fallback focus to prefer:

```ts
'[data-native-list-create-invoker]:not(:disabled), [data-native-list-delete-invoker]:not(:disabled), [data-view-kind="unlist"]'
```

Ensure `setNativeListLifecycleError` rerenders the rail status and the dialog without referring to management-page revision state.

- [ ] **Step 5: Run the complete lifecycle DOM subset**

```bash
bun test tests/dashboard/dom.test.ts -t "lifecycle|GitHub List management|GitHub List lifecycle"
```

Expected: PASS after test names are updated to “inline”/“rail”; no test should require `[data-native-list-management]` or **Manage GitHub Lists**.

- [ ] **Step 6: Commit dialog migration**

```bash
git add src/dashboard/scripts.ts tests/dashboard/dom.test.ts
git commit -m "test: exercise lifecycle dialogs from list rail"
```

---

### Task 4: Add deterministic disabled guidance, sync status, refresh, and cancellation

**Files:**
- Modify: `tests/dashboard/dom.test.ts:5800-5945`
- Modify: `src/dashboard/scripts.ts:650-820, 3121-3148`

- [ ] **Step 1: Write failing status and protocol tests**

Cover the exact blocker precedence:

1. pending lifecycle request or active lifecycle operation
2. in-flight membership confirmation (`confirmingMembership` or `activeMembershipConfirmationToken`) or active native List membership job
3. active native List rename work
4. write authorization required
5. unproven lifecycle release capability
6. unsafe native List sync state

Define sync safety explicitly: `complete` and `partial` are safe for lifecycle preview because partial deletion already uses GitHub-reported counts and the stronger warning; `null`, `idle`, `running`, `stale`, and `unavailable` are blockers. `SyncPhase` has no `error` member; display `lastError` within its actual phase.

Assert shared description wiring:

```ts
expect(create?.disabled).toBe(true)
expect(create?.getAttribute('aria-describedby')).toBe(
  'native-list-lifecycle-guidance'
)
expect(remove?.getAttribute('aria-describedby')).toBe(
  'native-list-lifecycle-guidance'
)
expect(root.querySelector('#native-list-lifecycle-guidance')?.textContent)
  .toContain('lifecycle capability is unproven')
```

Assert contextual actions are outside live text but programmatically associated:

```ts
const status = root.querySelector('[data-native-list-lifecycle-status]')
const refresh = status?.querySelector<HTMLButtonElement>('[data-native-list-refresh]')
expect(status?.querySelector('[role="status"]')?.contains(refresh ?? null)).toBe(false)
expect(refresh?.getAttribute('aria-describedby')).toBe('native-list-lifecycle-status-text')
expect(refresh?.getAttribute('aria-controls')).toContain('native-list-navigation')
refresh?.click()
expect(messages).toContainEqual({type: 'refresh-native-list-lifecycle'})
```

For queued/preflight operations, assert **Cancel queued operation** dispatches only `cancel-native-list-lifecycle` and uses the same `aria-describedby`/`aria-controls` association.

Test deterministic Refresh visibility:

- visible for sync `null`, `idle`, `partial`, `stale`, or `unavailable`;
- visible for `blocked-unknown` and `needs-confirmation` outcomes;
- hidden while sync is `running`, while lifecycle work is active, and after clean `complete`/verified/cancelled states;
- hidden for authentication/permission failures, which show reauthorization guidance instead.

- [ ] **Step 2: Run tests and verify failure**

```bash
bun test tests/dashboard/dom.test.ts -t "lifecycle guidance|lifecycle refresh|queued lifecycle"
```

Expected: FAIL because status and controls still belong to the removed page.

- [ ] **Step 3: Implement one gate derivation helper**

Create a small pure helper in `scripts.ts`:

```ts
interface NativeListLifecycleGate {
  readonly disabled: boolean
  readonly reason: string | null
}

function nativeListLifecycleGate(state: AppState): NativeListLifecycleGate {
  const operation = activeNativeListLifecycleOperation(state)
  if (nativeListLifecyclePending.val || operation) {
    return {disabled: true, reason: 'A GitHub List lifecycle operation is active.'}
  }
  if (
    confirmingMembership.val ||
    activeMembershipConfirmationToken !== null ||
    hasActiveNativeListMembershipMutation(state)
  ) {
    return {disabled: true, reason: 'A native GitHub List membership operation is active.'}
  }
  if (savingNativeListRename.val || activeNativeListRenameRequest !== null) {
    return {disabled: true, reason: 'A native GitHub List rename request is active.'}
  }
  const readiness = state.nativeListLifecycle?.readiness ?? 'capability-unproven'
  if (readiness === 'write-authorization-required') {
    return {disabled: true, reason: 'Authorize this GitHub account before changing Lists.'}
  }
  if (readiness !== 'ready') {
    return {disabled: true, reason: 'GitHub List lifecycle capability is unproven for this build.'}
  }
  const syncPhase = state.nativeListSync?.phase ?? null
  if (syncPhase === null || ['idle', 'running', 'stale', 'unavailable'].includes(syncPhase)) {
    return {disabled: true, reason: nativeListSyncGuidance(state.nativeListSync)}
  }
  return {disabled: false, reason: null}
}
```

Use one gate instance for the `+` and every remove control.

- [ ] **Step 4: Implement compact rail status**

Render status outside the navigation `<ul>` with:

- `id="native-list-navigation"` on the direct navigation `<ul>`
- `#native-list-lifecycle-guidance` for the shared disabled reason
- `#native-list-lifecycle-status-text` for sync/operation/error text
- native List sync phase when null/idle/running/partial/stale/unavailable, including `lastError` where present
- current lifecycle phase and existing sanitized guidance
- `role="alert"` only for current errors
- a separate `.native-list-lifecycle-actions` container outside live-region elements
- `aria-describedby="native-list-lifecycle-status-text"` and `aria-controls="native-list-navigation native-list-lifecycle-status-text"` on Refresh/Cancel actions
- deterministic **Refresh GitHub Lists** visibility exactly as tested in Step 1, using existing `refreshNativeListLifecycle`
- queued/preflight **Cancel queued operation** using existing `cancelNativeListLifecycle`

Factor current `lifecyclePhaseLabel` and guidance copy out of the page-sized `LifecycleOperationStatus`; delete the page-sized renderer.

- [ ] **Step 5: Run status tests**

```bash
bun test tests/dashboard/dom.test.ts -t "lifecycle guidance|lifecycle refresh|queued lifecycle|unknown and failed lifecycle|membership work is active"
```

Expected: PASS.

- [ ] **Step 6: Commit status/recovery UI**

```bash
git add src/dashboard/scripts.ts tests/dashboard/dom.test.ts
git commit -m "feat: retain lifecycle recovery status in list rail"
```

---

### Task 5: Reconcile shell-level rail focus across queueing and authoritative deletion

**Files:**
- Modify: `tests/dashboard/dom.test.ts:2100-2160, lifecycle test section`
- Modify: `src/dashboard/scripts.ts:356-390, 3796-3875, 3920-4175`

- [ ] **Step 1: Write the immediate queued-state focus test**

Confirm deletion from the rail while Library is active. When confirmation returns a queued/verifying state, the remove invoker becomes natively disabled, so it must not receive focus. Assert focus moves to its still-enabled sibling List navigation button (or **Unlist** for create):

```ts
expect(removeCurrent?.disabled).toBe(true)
expect(document.activeElement).toBe(
  root.querySelector('[data-native-list-row="L_current"] > .nav-item')
)
```

- [ ] **Step 2: Write shell-level asynchronous deletion tests**

From each ready workspace—Library, Operations, and Settings—focus a native List navigation/remove control in the persistent rail, then publish authoritative state without that List. Assert the same fallback order independent of `.library-page`:

1. enabled `+` control;
2. nearest surviving native List navigation control;
3. **Unlist**.

Also test the two-publication lifecycle flow: queued state keeps the List row and moves focus off the disabled remove button; later verified state removes the row and moves focus again only if the currently focused rail target disappears.

- [ ] **Step 3: Run tests and verify failure**

```bash
bun test tests/dashboard/dom.test.ts -t "queued lifecycle focus|shell rail focus|authoritative List deletion"
```

Expected: FAIL because dialog restoration can target a disabled invoker and existing `DashboardPosition` capture requires `.library-page`.

- [ ] **Step 4: Add independent rail-focus capture**

Do not extend `DashboardPosition`. Add a shell-level structure captured before any library slice publication:

```ts
interface NativeListRailFocus {
  readonly mountId: number
  readonly accountId: string | null
  readonly scope: HTMLElement
  readonly element: HTMLElement
  readonly kind: 'create' | 'remove' | 'navigate'
  readonly listNodeId: string | null
  readonly listIndex: number
}
```

Implement `captureNativeListRailFocus()` from `mountedDashboardRoot?.querySelector('.app-shell')` and `document.activeElement`. It must not query or depend on `.library-page` or `LibraryPageLifecycle`.

In `applyState`, capture this rail focus whenever the library fingerprint or account changes, publish slices, then schedule reconciliation in a microtask guarded by mount ID, account ID, connected shell, and intentional focus movement.

- [ ] **Step 5: Implement deterministic immediate and later fallback**

Update dialog restoration:

- return to the invoker only when connected, visible, and not natively disabled;
- after queued create, fall back to **Unlist**;
- after queued delete, prefer the invoker’s sibling `.nav-item`, then **Unlist**.

For later shell-level reconciliation, locate matching elements by filtering `dataset` values rather than interpolating unescaped IDs. If the original focused element remains connected and enabled, preserve it. If it disappears or becomes disabled, choose:

```ts
const create = scope.querySelector<HTMLElement>(
  '[data-native-list-create-invoker]:not(:disabled)'
)
const nativeNavigation = [
  ...scope.querySelectorAll<HTMLElement>(
    '[data-native-list-row] > .nav-item:not(:disabled)'
  )
]
const nearest = nativeNavigation[focus.listIndex] ??
  nativeNavigation[Math.max(focus.listIndex - 1, 0)] ??
  null
const unlist = scope.querySelector<HTMLElement>('[data-view-kind="unlist"]')
;(create ?? nearest ?? unlist)?.focus()
```

Do not override focus if the user intentionally moved it to another connected focus target after capture.

- [ ] **Step 6: Run focus tests**

```bash
bun test tests/dashboard/dom.test.ts -t "focus|queued lifecycle focus|shell rail focus|authoritative List deletion"
```

Expected: PASS across Library, Operations, Settings, existing repository focus, dialog focus, and account-lifecycle tests.

- [ ] **Step 7: Commit focus reconciliation**

```bash
git add src/dashboard/scripts.ts tests/dashboard/dom.test.ts
git commit -m "fix: reconcile List rail focus across lifecycle updates"
```

---

### Task 6: Style compact lifecycle controls and remove page-only CSS

**Files:**
- Modify: `tests/dashboard/styles.test.ts:140-160, 296-365, 373-430`
- Modify: `src/dashboard/styles.css:273-360, 2006-2070, 2220-2290, 2315-2504`

- [ ] **Step 1: Write failing style assertions**

Require:

```ts
expect(exactRuleFor(styles, ['.list-sidebar-heading-row']))
  .toMatch(/grid-template-columns:\s*minmax\(0, 1fr\) auto/)
expect(exactRuleFor(styles, ['.native-list-nav-row']))
  .toMatch(/grid-template-columns:\s*minmax\(0, 1fr\) auto/)
expect(exactRuleFor(styles, ['.native-list-create-button', '.native-list-remove-button']))
  .toMatch(/min-width:\s*40px/)
expect(styles).not.toMatch(/\.native-list-management\b/)
expect(styles).not.toMatch(/\.native-list-management-section\b/)
```

At `max-width: 700px`, require 44px create/remove targets. In forced colors, require visible system-color borders and focus outlines for both controls.

- [ ] **Step 2: Run style tests and verify failure**

```bash
bun test tests/dashboard/styles.test.ts
```

Expected: FAIL on missing inline-control selectors and retained management selectors.

- [ ] **Step 3: Implement rail styles**

Add restrained rules consistent with the existing design system:

```css
.list-sidebar-heading-row,
.native-list-nav-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  min-width: 0;
  align-items: center;
  gap: 8px;
}

.list-sidebar-heading-row {
  margin-bottom: 12px;
}

.list-sidebar-heading-row .list-sidebar-heading {
  margin: 0;
}

.native-list-create-button,
.native-list-remove-button {
  width: 40px;
  min-width: 40px;
  min-height: 40px;
  border: 1px solid var(--border-control);
  border-radius: var(--radius-control);
}

.native-list-remove-button {
  color: var(--action-danger-text);
  background: var(--action-danger);
}

.native-list-lifecycle-status {
  display: grid;
  gap: 8px;
  margin: 0 0 12px;
  padding: 10px;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-control);
}
```

Keep long names within the shrinking `.nav-item`; the remove button never shrinks. Preserve selected navigation styling only on `.nav-item`, not the remove sibling.

- [ ] **Step 4: Remove only obsolete page rules**

Delete `.native-list-management*` and `.native-list-management-section*` selectors. Retain and, where needed, retarget:

- `.native-list-delete-confirmation`
- `.native-list-lifecycle-form`
- `.native-list-visibility`
- `.native-list-lifecycle-preview`
- `.native-list-lifecycle-confirmation`
- `.partial-native-list-note`
- compact lifecycle semantic status rules

- [ ] **Step 5: Run style and DOM tests**

```bash
bun test tests/dashboard/styles.test.ts tests/dashboard/dom.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit styling**

```bash
git add src/dashboard/styles.css tests/dashboard/styles.test.ts
git commit -m "style: place lifecycle actions in My Lists rail"
```

---

### Task 7: Refresh design-system documentation

**Files:**
- Modify: `DESIGN.md:139-146, 179, 244, 305-325, 346-351`
- Modify: `.impeccable/design.json`
- Modify: `openspec/changes/add-native-list-lifecycle/tasks.md`

- [ ] **Step 1: Update `DESIGN.md`**

Replace `list-management-panel` with an inline component token such as:

```yaml
list-rail-action:
  backgroundColor: "{colors.paper-white}"
  textColor: "{colors.ink}"
  rounded: "{rounded.control}"
  width: "40px"
  height: "40px"
```

Remove retained-workspace prose. Document the `+` heading action, separate native List remove siblings, disabled guidance, contextual recovery actions, and compact rail status. Keep the approved Creative North Star and all existing palette/type choices.

- [ ] **Step 2: Synchronize `.impeccable/design.json`**

- replace the custom **GitHub List Management** component with **Inline List Lifecycle Controls**;
- keep schema version 2 and 5–10 self-contained components;
- update `generatedAt`;
- remove narrative claims about a dedicated management surface;
- add Do/Don’t guidance for sibling controls, read-only visibility, and verified recovery.

- [ ] **Step 3: Mark only implemented refinement tasks complete**

Check the new inline-UI tasks in `tasks.md`. Keep 8.2–8.4 unchecked and release evidence `null`.

- [ ] **Step 4: Validate documentation**

```bash
node -e 'const d=JSON.parse(require("fs").readFileSync(".impeccable/design.json","utf8")); if(d.schemaVersion!==2 || d.components.length<5 || d.components.length>10) process.exit(1)'
openspec validate add-native-list-lifecycle --type change --strict --no-interactive
git diff --check
```

Expected: JSON parses, component count is valid, strict OpenSpec validation passes, and diff check is clean.

- [ ] **Step 5: Commit documentation**

```bash
git add DESIGN.md .impeccable/design.json \
  openspec/changes/add-native-list-lifecycle/tasks.md
git commit -m "docs: document inline List lifecycle controls"
```

---

### Task 8: Full verification, build evidence, and user-work restoration

**Files:**
- Verify all modified files
- Restore the exact stash OID and compare against the external Task 0 backup

- [ ] **Step 1: Run source and behavior verification**

```bash
bun run check:source
bun run typecheck
bun test
```

Expected: no source violations, no TypeScript errors, and all tests pass with zero failures.

- [ ] **Step 2: Build and inspect both browsers**

```bash
env -u NODE_OPTIONS bun run build:chrome
env -u NODE_OPTIONS bun run build:firefox
env -u NODE_OPTIONS bun run inspect:build
rg -l "Create GitHub List" dist/chrome/options/index.js dist/firefox/options/index.js
```

Expected: both production builds succeed, inspection passes, and both bundles contain the accessible create label.

- [ ] **Step 3: Re-run strict OpenSpec validation and diff checks**

```bash
openspec validate add-native-list-lifecycle --type change --strict --no-interactive
git diff --check
git status --short
```

Expected: validation succeeds; implementation commits are clean before restoring user work.

- [ ] **Step 4: Restore the pre-existing user changes by immutable stash OID**

Apply, do not pop, with index restoration:

```bash
backup_dir="$(cat /tmp/star-list-manager-inline-lifecycle-backup-path)"
stash_oid="$(cat "$backup_dir/stash-oid")"
git cat-file -e "$stash_oid^{commit}"
git stash apply --index "$stash_oid" || true
git status --short
```

Never select the stash by ordinal or message. Keep the stash object and external backup until the user confirms the restored result.

- [ ] **Step 5: Resolve every overlap as an explicit three-way intent merge**

For each unmerged or originally changed path, use:

1. the pre-implementation base from the stash first parent (`$stash_oid^1:<path>`);
2. the user’s complete original file from `original-tree.tar.gz`;
3. the committed inline implementation at `HEAD:<path>`.

Extract the original snapshot outside the repository:

```bash
mkdir -p "$backup_dir/original-tree"
tar -xzf "$backup_dir/original-tree.tar.gz" -C "$backup_dir/original-tree"
git diff --name-only --diff-filter=U
```

Do not discard an overlapping user hunk merely because implementation touched the same area. Classify every original hunk as either:

- restored as an uncommitted change;
- semantically incorporated by a specific implementation commit; or
- intentionally incompatible with the approved inline design, with the conflict and disposition reported to the user.

Restore untracked files byte-for-byte from the archive if stash application did not do so. Preserve the original staged/unstaged distinction for cleanly applied paths via `--index`; leave manually merged overlapping paths unstaged unless they were staged originally and can be staged without including unrelated implementation.

- [ ] **Step 6: Verify restoration against the backups**

Run:

```bash
backup_dir="$(cat /tmp/star-list-manager-inline-lifecycle-backup-path)"
test -z "$(git diff --name-only --diff-filter=U)"
! rg -n '^(<<<<<<<|=======|>>>>>>>)' \
  src/dashboard/scripts.ts src/dashboard/styles.css \
  tests/dashboard/dom.test.ts tests/dashboard/styles.test.ts
git diff --check
bun run typecheck
bun test tests/dashboard/dom.test.ts tests/dashboard/styles.test.ts
git status --porcelain=v2 -z > "$backup_dir/restored-status.porcelain-v2.z"
git log --oneline -8
```

For every path in `$backup_dir/all-paths.z`, branch on whether `$backup_dir/original-tree/<path>` exists. Existing originals are compared with the final working-tree file using `git diff --no-index --binary`. Originally deleted paths have no archived file: verify their deletion from `status.porcelain-v2.z` plus `staged.patch`/`unstaged.patch`, then record whether the path remains absent, its deletion was semantically incorporated by a named implementation commit, or the approved implementation intentionally recreated it. Record every path as exact, restored plus approved implementation, incorporated, or intentionally superseded. Expected: no unmerged entries or conflict markers; dashboard tests pass; every original path—including deletions—is accounted for; unrelated untracked artifacts remain present.

- [ ] **Step 7: Request final code review**

Use `superpowers:requesting-code-review` against the full commit range from the OpenSpec revision through design-document refresh. Resolve any High/Medium findings and rerun the affected verification commands.

- [ ] **Step 8: Report residual release and restoration state**

Report explicitly:

- inline controls are present in source and both builds;
- lifecycle mutations remain disabled because reviewed release evidence is still `null`;
- live tasks 8.2–8.4 remain incomplete;
- no live GitHub mutation was run;
- every pre-existing user path/hunk is accounted for;
- the exact safety stash OID and external backup remain retained until user approval.

