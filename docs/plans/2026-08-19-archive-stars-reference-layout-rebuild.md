# Archive.Stars Reference Layout Rebuild Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Replace the dashboard’s retained card/dashboard composition with the user-approved `redesign.md` archive layout across every view, without changing any functional, remote, safety, or accessibility behavior.

**Architecture:** Retain `src/dashboard/scripts.ts` as the existing VanJS behavioral source of truth. Recompose only its dashboard hierarchy around a centered 1440px editorial frame, a real primary header, real indexed directory, and dense record/document primitives. Replace the current layout CSS rather than layering another visual patch; preserve existing interactions and test them at each structural boundary.

**Tech Stack:** TypeScript, VanJS, CSS, Bun test, Chrome/Firefox extension builds, OpenSpec.

**Source inputs:**
- User reference: `redesign.md` (untracked; never stage or commit)
- Approved design: `docs/superpowers/specs/2026-08-19-archive-stars-reference-layout-design.md`
- OpenSpec: `openspec/changes/rebuild-archive-reference-layout/`
- Existing behavior source: `src/dashboard/scripts.ts`
- Existing styles/tests: `src/dashboard/styles.css`, `tests/dashboard/dom.test.ts`, `tests/dashboard/styles.test.ts`

---

### Task 1: Establish the frame and real primary archive navigation

**Objective:** Replace the current full-bleed shell structure with a centered reference-style frame and header containing real Library, Operations, and Settings destinations.

**Files:**
- Modify: `tests/dashboard/dom.test.ts`
- Modify: `src/dashboard/scripts.ts:307-430`

**Step 1: Write failing DOM contracts**

Add ready-dashboard assertions for:

```ts
const frame = root.querySelector<HTMLElement>('.archive-frame')
const header = frame?.querySelector<HTMLElement>('.archive-app-header')
const main = frame?.querySelector<HTMLElement>('main.archive-main')
expect(frame).not.toBeNull()
expect(header?.querySelector('.archive-wordmark')?.textContent).toContain('Archive.Stars')
expect(header?.querySelectorAll('.archive-primary-link')).toHaveLength(3)
expect(main).not.toBeNull()
```

Assert each real header control activates its existing destination and `aria-current` updates. Retain exactly-one-main assertions.

**Step 2: Confirm red**

Run:

```bash
bun test tests/dashboard/dom.test.ts --test-name-pattern 'reference archive frame'
```

Expected: FAIL because `.archive-frame`, `.archive-main`, and/or the real Library primary route do not exist.

**Step 3: Recompose the minimal shell**

In `Dashboard()` and `ArchiveHeader()`:

- Add the centered structural `.archive-frame` inside `.archive-app-shell`.
- Rename/recompose main with `archive-main` while retaining `workspace`, existing dynamic `data-workspace-kind`, retention lifecycle, and sole main landmark.
- Render Library, Operations, and Settings via the existing `NavItem()` factory with an `archive-primary-link` class—never direct active-view mutation.
- Keep existing Directory and result rendering available for Task 2.

**Step 4: Confirm green and regressions**

```bash
bun test tests/dashboard/dom.test.ts --test-name-pattern 'reference archive frame'
bun test tests/dashboard/dom.test.ts
bun run typecheck
```

**Step 5: Commit**

```bash
git add src/dashboard/scripts.ts tests/dashboard/dom.test.ts
git commit -m "feat: compose reference archive frame"
```

### Task 2: Rebuild real Library data as an indexed directory and archive records

**Objective:** Turn existing List navigation and repository rows into the reference’s compact directory index and dense divided archive records without removing data or interactions.

**Files:**
- Modify: `tests/dashboard/dom.test.ts`
- Modify: `src/dashboard/scripts.ts:355-430, 561-760, 1755-1825`

**Step 1: Write failing DOM contracts**

Add a ready-state test requiring:

```ts
expect(root.querySelector('.archive-directory-index')).not.toBeNull()
expect(root.querySelector('.archive-directory-index .archive-index-number')?.textContent).toMatch(/^00\./)
expect(root.querySelector('.archive-collection-kicker')?.textContent).toMatch(/collection|archive/i)
expect(root.querySelector('.repository-row .archive-record-summary')).not.toBeNull()
expect(root.querySelector('.repository-row .archive-record-facts')).not.toBeNull()
```

Prove a real list item remains a `button[data-repository-node-id]`, retains keyboard focus, selection checkbox, and dialog activation. Do not require invented labels/counts.

**Step 2: Confirm red**

```bash
bun test tests/dashboard/dom.test.ts --test-name-pattern 'archive index|archive record'
```

Expected: FAIL because index/record structural hooks do not exist.

**Step 3: Recompose existing elements only**

- Render Directory as an ordered/indexed presentation around the actual native Lists and live counts.
- Derive a view label/kicker only from current local view data.
- Preserve Search, Refresh, View options, Advanced Filters, and all their handlers; place them in a compact archive control strip.
- Reorganize existing repository owner/name/description/facts into `.archive-record-summary` and `.archive-record-facts` wrappers while retaining every current value, class, checkbox, button, and dialog invoker.
- Do not add reference sample rows, tags, or pagination.

**Step 4: Confirm green and regressions**

```bash
bun test tests/dashboard/dom.test.ts --test-name-pattern 'archive index|archive record'
bun test tests/dashboard/dom.test.ts
bun run typecheck
```

**Step 5: Commit**

```bash
git add src/dashboard/scripts.ts tests/dashboard/dom.test.ts
git commit -m "feat: compose indexed archive records"
```

### Task 3: Recompose secondary, state, and modal documents

**Objective:** Make Operations, Settings, signed-out/loading/error, confirmations, and inspection views use the same archive document structure while preserving their behavior and safety content.

**Files:**
- Modify: `tests/dashboard/dom.test.ts`
- Modify: `src/dashboard/scripts.ts` (only view/container functions demonstrated by failing tests)

**Step 1: Write failing behavioral structure tests**

For real state fixtures, assert every view is inside `.archive-frame main.archive-main`, with an `.archive-document-header` and real existing actions/semantics:

```ts
expect(main?.querySelector('.operations-page .archive-document-header h1')?.textContent).toBe('Operations')
expect(main?.querySelector('.settings-page .archive-document-header h1')?.textContent).toBe('Settings')
expect(main?.querySelector('.repository-inspection-dialog .archive-dialog-header')).not.toBeNull()
```

Retain checks for signed-out safety copy, loading `aria-busy`, error/status semantics, modal roles, Close/Cancel paths, confirmation wording, and no mutation dispatch before confirmation.

**Step 2: Confirm red**

```bash
bun test tests/dashboard/dom.test.ts --test-name-pattern 'archive document|archive dialog'
```

**Step 3: Add semantic class hooks only**

- Add document/header and dialog/header wrappers around existing content functions.
- Do not change message payloads, authorization gates, mutation callbacks, focus lifecycle, copy, roles, or current state logic.

**Step 4: Confirm green and regressions**

```bash
bun test tests/dashboard/dom.test.ts --test-name-pattern 'archive document|archive dialog'
bun test tests/dashboard/dom.test.ts
bun run typecheck
```

**Step 5: Commit**

```bash
git add src/dashboard/scripts.ts tests/dashboard/dom.test.ts
git commit -m "feat: align archive state documents"
```

### Task 4: Replace layout CSS with the reference composition

**Objective:** Implement the visual hierarchy from `redesign.md` across all actual structural hooks without external assets or another overlay patch.

**Files:**
- Modify: `tests/dashboard/styles.test.ts`
- Modify: `src/dashboard/styles.css`

**Step 1: Write failing CSS contracts**

Add tests for:

- `.archive-frame` maximum width of 1440px and centered margins;
- `.archive-app-header` desktop minimum height of 96px and thin boundary;
- wide directory/main grid with no card treatment for `.repository-row`;
- record summary/fact-grid rules and adjacent row boundaries;
- compact primary/header/control primitives;
- document/dialog primitives shared by secondary views;
- <=700px sequential reflow, visible primary routes, 44px touch targets, and no global x clipping;
- self-contained CSS, dark mode, reduced motion, forced-colors, and focus/current/selected/status treatment.

**Step 2: Confirm red**

```bash
bun test tests/dashboard/styles.test.ts --test-name-pattern 'reference layout'
```

Expected: FAIL on reference frame/header/record selectors or values.

**Step 3: Replace composition CSS**

- Use local/system typography only.
- Style the header as an editorial bar and index as compact text lines, not elevated surfaces.
- Style rows as full-width divided records with a responsive facts grid.
- Remove/rewrite obsolete panel/card layout rules rather than appending contradictory overrides.
- Apply equivalent document/divider/action grammar to state pages and dialogs.
- Preserve explicit alternate-mode declarations and native control focus.

**Step 4: Confirm style and functional checks**

```bash
bun test tests/dashboard/styles.test.ts --test-name-pattern 'reference layout'
bun test tests/dashboard/styles.test.ts
bun test tests/dashboard/dom.test.ts
bun run check:source
bun run typecheck
```

**Step 5: Commit**

```bash
git add src/dashboard/styles.css tests/dashboard/styles.test.ts
git commit -m "feat: rebuild Archive Stars reference layout"
```

### Task 5: Visual, accessibility, and release validation

**Objective:** Validate real packaged output at desktop and mobile before any push.

**Files:**
- Modify: `openspec/changes/rebuild-archive-reference-layout/tasks.md` (mark evidence-backed tasks only)

**Step 1: Build and inspect**

```bash
bun run check
bunx --yes @fission-ai/openspec@latest validate rebuild-archive-reference-layout --strict
git diff --check origin/master..HEAD
```

Expected: all checks pass, Chrome/Firefox production builds succeed, and build inspection passes.

**Step 2: Browser visual review**

Load the packaged Chrome dashboard with representative ready/signed-out/loading data at:

- desktop 1440px viewport;
- 700px viewport;
- 320px viewport;
- dark and forced-colors where browser tooling permits.

Verify against `redesign.md`: centered header/frame, indexed rail, dense records, intentional secondary views, no oversized card remnants, no clipping, and readable safety states. Record screenshots/evidence; fix concrete mismatches before approval.

**Step 3: Independent review gates**

Request a spec-compliance review, then a code-quality/accessibility review. Repair all critical and important findings with TDD and re-review.

**Step 4: Commit evidence only if changed**

```bash
git add openspec/changes/rebuild-archive-reference-layout/tasks.md
git commit -m "docs: verify reference archive layout"
```

**Step 5: Push only after explicit final approval**

Fetch origin, prove `origin/master` is an ancestor of HEAD, then fast-forward push `HEAD:master` and re-fetch to verify the remote SHA.
