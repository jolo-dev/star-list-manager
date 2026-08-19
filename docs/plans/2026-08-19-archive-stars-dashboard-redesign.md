# Archive.Stars Dashboard Redesign Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Replace Star List Manager’s dashboard presentation with the approved self-contained Archive.Stars brutalist archive while retaining every existing local-first workflow and remote-write safety guarantee.

**Architecture:** Keep the VanJS state, query, runtime-message, modal, and focus machinery untouched. Recompose only the dashboard shell and relevant library markup in `scripts.ts`, then replace the component-token/layout rules in `styles.css`. New regression tests assert observable document structure and accessibility/design-system contracts rather than mock reference content.

**Tech Stack:** TypeScript, Bun, VanJS, happy-dom, CSS custom properties, Chrome/Firefox extension build tooling.

---

### Task 1: Specify the Archive.Stars DOM contract

**Objective:** Add focused, user-observable DOM assertions that fail before the new frame exists.

**Files:**
- Modify: `tests/dashboard/dom.test.ts`
- Modify: `src/dashboard/scripts.ts` (only after a verified red test)

**Step 1: Write failing test**

Add a test that mounts `readyDashboardState()` and expects:

```ts
expect(root.querySelector('.archive-app-header')).not.toBeNull()
expect(root.querySelector('.archive-wordmark')?.textContent).toContain('Archive.Stars')
expect(root.querySelector('.archive-directory')).not.toBeNull()
expect(root.querySelector('.archive-results')).not.toBeNull()
expect([...root.querySelectorAll('.archive-utility-link')]
  .map((entry) => entry.textContent?.trim()))
  .toEqual(expect.arrayContaining(['Operations', 'Settings']))
```

Add a second test that expects a `.repository-row` to be contained in `.archive-results` and keeps its existing button role, `data-repository-node-id`, keyboard result-list container, and inspection activation.

**Step 2: Run test to verify failure**

Run: `bun test tests/dashboard/dom.test.ts --test-name-pattern 'Archive.Stars'`

Expected: FAIL because the Archive.Stars selectors do not yet exist.

**Step 3: Implement minimal shell markup**

In `src/dashboard/scripts.ts`, wrap `Navigation()` and the existing `<main class="workspace">` in an Archive-Stars shell. Change the navigation root from a dark `sidebar` to a directory navigation class, add a header with a star mark, wordmark, and real Operations/Settings navigation controls. Preserve `aria-label="Library"`, every existing `NavItem` callback, and the single main landmark:

```ts
return div(
  {class: 'archive-app-shell'},
  ArchiveHeader(),
  div(
    {class: 'archive-workspace-frame'},
    Navigation(),
    main({class: 'workspace archive-results', ...}, ...)
  )
)
```

Do not duplicate fixed `LibraryView` routes: extract/reuse `NavItem` so Operations and Settings in the header activate their existing views. Keep the directory’s GitHub List entries intact.

**Step 4: Run test to verify pass**

Run: `bun test tests/dashboard/dom.test.ts --test-name-pattern 'Archive.Stars'`

Expected: PASS.

**Step 5: Commit**

```bash
git add tests/dashboard/dom.test.ts src/dashboard/scripts.ts
git commit -m "feat: add Archive Stars dashboard frame"
```

### Task 2: Recompose the library header, directory, and repository archive entries

**Objective:** Make the real library controls and results scan like the reference without changing their behavior.

**Files:**
- Modify: `tests/dashboard/dom.test.ts`
- Modify: `src/dashboard/scripts.ts:534-798,1729-1789`

**Step 1: Write failing test**

Add assertions that the ready library renders:

```ts
expect(root.querySelector('.archive-directory-heading')?.textContent).toContain('Directory')
expect(root.querySelector('.archive-filter-heading')?.textContent).toContain('Status')
expect(root.querySelector('.archive-result-count')?.textContent).toMatch(/repositories/)
expect(root.querySelector('.repository-row .archive-repository-reference')).not.toBeNull()
```

Keep assertions for the existing Search label, Refresh button, current view, selection controls, targeted status regions, and `aria-current` behavior.

**Step 2: Run test to verify failure**

Run: `bun test tests/dashboard/dom.test.ts --test-name-pattern 'archive directory|archive result'`

Expected: FAIL only for new Archive-Stars structure/classes.

**Step 3: Implement minimal markup**

- Add a labelled directory heading and place existing native List entries beneath it.
- Add a compact filter heading/group around the existing View options and advanced filter controls; do not add fake filter buttons or remove any selector/event handlers.
- Add archive-specific classes to the existing header result count and repository facts. A repository row must still use the existing `button`, selection checkbox, details dialog invoker, and metadata values.
- Use real current data rather than sample rows or synthetic pagination.

**Step 4: Run test to verify pass**

Run: `bun test tests/dashboard/dom.test.ts --test-name-pattern 'archive directory|archive result'`

Expected: PASS, and run `bun test tests/dashboard/dom.test.ts` to protect existing focus and dialog contracts.

**Step 5: Commit**

```bash
git add tests/dashboard/dom.test.ts src/dashboard/scripts.ts
git commit -m "feat: compose dashboard as repository archive"
```

### Task 3: Replace design tokens and layout with the self-contained Archive.Stars system

**Objective:** Implement the approved light-first brutalist style, responsive layout, and required accessibility modes.

**Files:**
- Modify: `tests/dashboard/styles.test.ts`
- Modify: `src/dashboard/styles.css`

**Step 1: Write failing test**

Add a test that reads the stylesheet and asserts:

```ts
expect(styles).toMatch(/--archive-canvas:\s*#[0-9a-f]{6}/i)
expect(ruleFor(styles, '.archive-app-header')).toMatch(/position:\s*sticky/)
expect(ruleFor(styles, '.archive-workspace-frame')).toMatch(/grid-template-columns/)
expect(ruleFor(styles, '.archive-directory')).toMatch(/border-right:\s*1px solid/)
expect(ruleFor(styles, '.repository-row')).toMatch(/border-top:\s*1px solid/)
expect(styles).not.toMatch(/https?:\/\//)
```

Extend existing dark, forced-color, reduced-motion, and mobile tests to target the new frame while retaining the existing contrast assertions or their semantic equivalent.

**Step 2: Run test to verify failure**

Run: `bun test tests/dashboard/styles.test.ts --test-name-pattern 'Archive.Stars'`

Expected: FAIL because the new tokens/layout selectors do not exist.

**Step 3: Implement minimal CSS**

Replace old warm-sidebar tokens/rules with a semantic Archive-Stars token system. Include:

```css
:root {
  --archive-canvas: #f7f7f4;
  --archive-ink: #101010;
  --archive-muted: #616161;
  --archive-line: #101010;
  --focus-ring: #005fcc;
}
.archive-app-header { position: sticky; top: 0; z-index: var(--z-sticky); border-bottom: 1px solid var(--archive-line); }
.archive-workspace-frame { display: grid; grid-template-columns: minmax(15rem, 18rem) minmax(0, 1fr); }
```

Apply the tokens to every dashboard component: header, directory, controls, filters, rows, dialogs, states, status banners, Operations, and Settings. Preserve semantic status colors and accessible contrast. Add media queries for 700px reflow, `prefers-color-scheme: dark`, `prefers-reduced-motion`, and `forced-colors: active`. Never use CDN imports, remote URLs, Tailwind, or icon scripts.

**Step 4: Run test to verify pass**

Run: `bun test tests/dashboard/styles.test.ts`

Expected: PASS, including contrast, forced-colors, and 44px mobile contracts.

**Step 5: Commit**

```bash
git add tests/dashboard/styles.test.ts src/dashboard/styles.css
git commit -m "feat: style dashboard as Archive Stars"
```

### Task 4: Integrate state pages and visual regressions

**Objective:** Confirm non-library states retain safety information and receive the same visual grammar.

**Files:**
- Modify: `tests/dashboard/dom.test.ts`
- Modify: `src/dashboard/scripts.ts` only if a markup class is needed
- Modify: `src/dashboard/styles.css`

**Step 1: Write failing test**

Add focused DOM assertions that loading, signed-out/error, Operations, Settings, and repository inspection continue to expose their required headings/actions when mounted in the new shell. Test actual existing text and roles, e.g. `role="dialog"`, status regions, confirmation labels, and Operations/Settings navigation.

**Step 2: Run test to verify failure**

Run: `bun test tests/dashboard/dom.test.ts --test-name-pattern 'Archive.Stars state pages'`

Expected: FAIL only if newly required shared classes/structure are absent.

**Step 3: Implement minimal integration styling**

Apply shared archive surfaces, headings, controls, borders, and responsive spacing to state pages and dialogs. Do not alter state-copy text, confirmation wording, runtime messages, modal focus code, or mutation conditions.

**Step 4: Run test to verify pass**

Run: `bun test tests/dashboard/dom.test.ts`

Expected: PASS.

**Step 5: Commit**

```bash
git add tests/dashboard/dom.test.ts src/dashboard/scripts.ts src/dashboard/styles.css
git commit -m "test: protect Archive Stars state pages"
```

### Task 5: Validate release artifacts and review scope

**Objective:** Prove the redesign builds correctly without functional/safety regressions.

**Files:**
- Modify: `openspec/changes/redesign-dashboard-archive-stars/tasks.md` (evidence-based task completion only)

**Step 1: Run static checks**

Run:

```bash
bun run check:source
bun run typecheck
bun test
```

Expected: all commands exit 0.

**Step 2: Build both extension targets**

Run:

```bash
env -u NODE_OPTIONS bun run build:chrome
env -u NODE_OPTIONS bun run build:firefox
env -u NODE_OPTIONS bun run inspect:build
```

Expected: both production builds and inspection succeed.

**Step 3: Inspect implementation diff**

Run:

```bash
git diff --check HEAD~4..HEAD
git diff --stat HEAD~4..HEAD
git status --short
```

Confirm only the approved dashboard source/tests/spec task state changed; do not stage `redesign.md` or generated `dist/` output.

**Step 4: Record evidence-backed OpenSpec task status**

Check only automated tasks supported by command output. Leave the packaged-extension desktop/320px manual inspection unchecked unless an isolated browser profile was actually used.

**Step 5: Commit**

```bash
git add openspec/changes/redesign-dashboard-archive-stars/tasks.md
git commit -m "docs: record Archive Stars validation"
```
