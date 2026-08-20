# Star List Manager Reference Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Archive.Stars dashboard presentation with the approved self-contained Star List Manager UI based on the supplied Stellar reference, without changing local-first behavior, accessibility, or GitHub mutation safety.

**Architecture:** Preserve the existing VanJS state, query, dialog, focus, message, and mutation paths. Make a bounded semantic-DOM adaptation in `src/dashboard/scripts.ts`, switch the local UI default to Cards, and replace the presentation layer in `src/dashboard/styles.css`; keep List mode and all non-Library states. Tests lead each structural and styling slice, and the final pass verifies packaged builds, desktop/mobile rendering, the Impeccable direction contract, and design-system documentation.

**Tech Stack:** TypeScript 7, VanJS, plain bundled CSS, local Geist Sans/Geist Mono assets, Bun tests, happy-dom, Extension.js Chromium/Firefox builds.

**Approved design:** `docs/superpowers/specs/2026-08-20-star-list-manager-reference-redesign-design.md`  
**Product truth:** `PRODUCT.md`  
**Primary surface:** `src/dashboard/index.html`  
**Direction seed:** `82166ef0` (the user-pinned Stellar reference remains authoritative)

---

## File Map

- Modify `src/dashboard/index.html`: emitted direction contract, theme color, and document metadata only.
- Modify `src/dashboard/scripts.ts`: Star List Manager shell/header/sidebar classes and copy, global account indicator, decorative List markers, card-default state, and richer card metadata structure; do not alter runtime messages or mutation handlers.
- Replace `src/dashboard/styles.css`: bundled font faces, slate design tokens, header/sidebar/library/card/dialog/state styling, dark mode, forced colors, reduced motion, and responsive behavior.
- Modify `tests/dashboard/dom.test.ts`: new shell/card contracts plus explicit safety-state preservation.
- Modify `tests/dashboard/styles.test.ts`: replace Archive.Stars-specific source assertions with Star List Manager token/layout/accessibility contracts.
- Create `.impeccable/surfaces/src-dashboard-index-html.md` through the surface-brief helper.
- Create `scripts/generate-dashboard-review.ts`: a non-shipping happy-dom serializer that renders a safe representative ready dashboard for visual review without runtime messages or remote mutations.
- Create/update `DESIGN.md` and its exact Impeccable sidecar path at finish through the shipped documenter.
- Capture `.impeccable/review/star-list-manager-desktop.png` and `.impeccable/review/star-list-manager-mobile.png` for the bounded visual review.

## Guardrails

- Do not add Tailwind, Iconify, Google Fonts, CDN resources, fake data, fake pagination, Explore, create-List, random-repository, profile-image, or toast behavior.
- Do not change runtime message payloads, authorization gates, persistence, synchronization, operation queues, preview/confirmation, focus restoration, or remote verification.
- Preserve one `<main>`, real buttons/labels/list semantics, keyboard result navigation, `aria-current`, `aria-pressed`, targeted status semantics, and 44px narrow-screen controls.
- Do not remove List mode even though Cards becomes the default.
- Use one implementation writer. Fresh reviewers are read-only.

---

### Task 1: Lock the emitted direction contract and surface strategy

**Files:**
- Modify: `src/dashboard/index.html:1-14`
- Create: surface brief path resolved by the Impeccable helper
- Test: `tests/dashboard/dom.test.ts:1-35`

- [ ] **Step 1: Add a failing emitted-contract test**

Extend the first dashboard DOM test to require a direction-contract seed in the source document:

```ts
expect(indexHtml).toContain('THESIS:')
expect(indexHtml).toContain('OWN-WORLD:')
expect(indexHtml).toContain('STORY:')
expect(indexHtml).toContain('FIRST VIEWPORT:')
expect(indexHtml).toContain('FORM:')
expect(indexHtml).toContain('seed 82166ef0')
expect(indexHtml).toContain(
  'FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, and DESIGN.md'
)
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```bash
rtk bun test tests/dashboard/dom.test.ts --test-name-pattern "mounts one main landmark"
```

Expected: FAIL because `src/dashboard/index.html` has no direction contract.

- [ ] **Step 3: Add the contract as the first child of `<body>`**

Insert an emitted HTML comment before `<noscript>` using five blocks and at most 150 words:

```html
<!--
THESIS: Star List Manager is a calm working library for real GitHub stars, refusing the category-default developer-tool table and the discarded Archive.Stars brutalism.
OWN-WORLD: Cool white and slate surfaces, locally bundled Geist Sans, softened rectangles, quiet borders, one restrained shadow, dark ink actions, and explicit semantic status color.
STORY: The user identifies the active local collection, finds a repository, understands its local and remote state, and safely acts without losing mutation context.
FIRST VIEWPORT: A 64px sticky brand/nav/account header sits above a 256px My Lists rail and a spacious library heading, local search, compact filters, and a three-column real repository-card grid.
FORM: Reference-pinned minimal Git star manager; replacement direction; seed 82166ef0.
FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, and DESIGN.md
-->
```

Also update `<meta name="theme-color">` from the old archive color to the new light shell token value selected in Task 4.

- [ ] **Step 4: Record the route-level brief**

Resolve and verify the path:

```bash
rtk node /Users/jolo/.pi/agent/skills/impeccable/scripts/surface-brief.mjs path src/dashboard/index.html
```

Expected: `.impeccable/surfaces/src-dashboard-index-html.md`.

Create `.impeccable/surface-brief-body.md` containing only: scope/mode; audience/job/task; real content and safety constraints; chosen reference direction; memorable card-library moment; unresolved decisions (`none`). Then write and verify the brief explicitly:

```bash
rtk node /Users/jolo/.pi/agent/skills/impeccable/scripts/surface-brief.mjs write src/dashboard/index.html .impeccable/surface-brief-body.md
rtk node /Users/jolo/.pi/agent/skills/impeccable/scripts/surface-brief.mjs read src/dashboard/index.html
rtk rm .impeccable/surface-brief-body.md
```

The `read` command may exit 2 before the first write; do not treat it as a source of a write command.

- [ ] **Step 5: Re-run the focused test**

Run:

```bash
rtk bun test tests/dashboard/dom.test.ts --test-name-pattern "mounts one main landmark"
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
rtk git add src/dashboard/index.html tests/dashboard/dom.test.ts .impeccable/surfaces/src-dashboard-index-html.md
rtk git commit -m "docs: lock dashboard redesign direction"
```

---

### Task 2: Specify the new shell and default result behavior in DOM tests

**Files:**
- Modify: `tests/dashboard/dom.test.ts` (all presentation-coupled selectors and default-mode assumptions, not only the primary shell/card tests)
- Test: `tests/dashboard/dom.test.ts`

- [ ] **Step 1: Inventory and replace every Archive.Stars-coupled DOM assertion before implementation**

Find the complete migration surface:

```bash
rtk rg -n "archive-|repository-row-shell|repository-row-main|result-mode|repository-card-grid" tests/dashboard/dom.test.ts
```

Update every presentation-only selector in the test file to the approved shell/sidebar/card vocabulary. Preserve behavioral selectors such as `.repository-row`, `data-repository-node-id`, dialog classes, and accessible labels when they remain part of the implementation contract. Tests that specifically exercise dense row internals (for example old `.archive-record-summary`/`.repository-row-shell` assertions) must click `[data-result-mode="list"]` and await VanJS completion before querying the row; do not assume List is still the initial mode.

Update the frame tests to assert the approved structure and copy:

```ts
expect(root.querySelector('.app-shell')).not.toBeNull()
expect(root.querySelector('.app-header')).not.toBeNull()
expect(root.querySelector('.brand-wordmark')?.textContent).toBe('Star List Manager')
expect(root.querySelector('.list-sidebar-heading')?.textContent).toBe('My Lists')
expect(root.querySelector('.archive-wordmark')).toBeNull()
expect(root.querySelectorAll('main')).toHaveLength(1)
```

Retain and adapt the existing assertions that Library, Operations, and Settings are real buttons with correct `aria-current` behavior.

Add an identity-bearing ready state assertion:

```ts
const account = root.querySelector('.account-indicator')
expect(account?.getAttribute('aria-label')).toBe('Connected as octocat')
expect(account?.closest('.app-header')).not.toBeNull()
```

Navigate to Operations and Settings and assert the same account indicator remains in `.app-header`. Assert `#library-search` is inside `.library-header`, not `.app-header`.

For rendered native Lists, assert any `.list-marker` has `aria-hidden="true"` and the button still exposes visible name/count/current state.

- [ ] **Step 2: Change the card-mode test to specify Cards as the initial mode**

Replace the initial assertions with:

```ts
expect(mode('list')?.getAttribute('aria-pressed')).toBe('false')
expect(mode('cards')?.getAttribute('aria-pressed')).toBe('true')
expect(root.querySelector('.repository-card-grid')).not.toBeNull()
```

Then activate List, assert the dense `.repository-list` has no `.repository-card-grid`, switch back to Cards, and retain all existing selection, inspection, real-data, and no-runtime-message assertions.

- [ ] **Step 3: Preserve representative safety-state DOM contracts**

Add or strengthen focused assertions using existing fixtures:

```ts
expect(root.querySelector('.status-banner.is-warning')?.textContent).toContain('stale')
expect(root.querySelector('.mutation-status.status-retry-waiting')?.textContent).not.toBe('')
expect(root.querySelector('.mutation-status.status-failed')?.textContent).not.toBe('')
expect(root.querySelector('.mutation-status.status-blocked-unknown')?.textContent).not.toBe('')
expect(root.querySelector('.danger-action')?.getAttribute('disabled')).not.toBeNull()
```

Reuse the existing unstar confirmation test to prove a row/selection action does not dispatch before the confirmation action is activated. Do not create a parallel mock mutation path.

- [ ] **Step 4: Run the complete DOM test file and verify it fails for presentation-only reasons**

Run:

```bash
rtk bun test tests/dashboard/dom.test.ts
```

Expected: FAIL on missing new classes/wordmark and initial Cards state; existing behavior/safety assertions should continue to pass where unaffected.

- [ ] **Step 5: Commit the red tests**

```bash
rtk git add tests/dashboard/dom.test.ts
rtk git commit -m "test: specify Star List Manager dashboard shell"
```

---

### Task 3: Adapt the VanJS shell without changing product behavior

**Files:**
- Modify: `src/dashboard/scripts.ts:200-210, 306-405, 624-830, 1828-1944, 4083-4130`
- Test: `tests/dashboard/dom.test.ts`

- [ ] **Step 1: Switch only the default local presentation state to Cards**

Change both declarations that initialize/reset result mode:

```ts
let resultMode = van.state<ResultMode>('cards')
// ...
resultMode = van.state<ResultMode>('cards')
```

Do not persist the preference or change query data.

- [ ] **Step 2: Rework the application shell and global header**

Rename presentation classes while preserving semantics:

```ts
function Dashboard(...) {
  return div(
    {class: 'app-shell'},
    AppHeader(),
    div(
      {class: 'app-frame'},
      Navigation(),
      main({class: 'workspace app-main', ...}, ...)
    )
  )
}
```

`AppHeader` must contain:

- star glyph in `.brand-mark`
- `.brand-wordmark` text `Star List Manager`
- the same three `NavItem` calls for Library, Operations, Settings
- a reactive `.account-indicator` derived from `publishedIdentity` and labeled `Connected as <login>`

Keep navigation buttons and `aria-current`; do not convert them to inert anchors.

- [ ] **Step 3: Rework Navigation into the real My Lists sidebar**

Use `.list-sidebar`, `.list-sidebar-heading`, and `.list-navigation`. Rename the visible heading to `My Lists`, retain the real Unlist/native List ordering and counts, and add only decorative markers:

```ts
span({class: `list-marker list-marker-${index % 4}`, 'aria-hidden': 'true'})
```

The Unlist item may use the existing star/grid mark, but no create control appears.

- [ ] **Step 4: Clarify Library header grouping**

Keep `#library-search`, Refresh, View options, advanced filters, rename controls, result count, and status output attached to their current state and handlers. Add presentation wrappers/classes only where needed for the reference hierarchy, for example:

```ts
header(
  {class: 'library-header'},
  div({class: 'library-heading'}, ...),
  div({class: 'library-toolbar'}, searchLabel, refreshButton, filterSection)
)
```

Remove the account indicator from `LibraryHeader` after it has moved to `AppHeader`.

- [ ] **Step 5: Enrich card markup using existing repository facts only**

Retain the card’s outer button, `data-repository-node-id`, selection control, click handler, triage, mutation state, and description. Add a decorative repository icon tile and structured footer:

```ts
span({class: 'repository-icon', 'aria-hidden': 'true'}, '⌘')
div(
  {class: 'repository-card-reference'},
  span({class: 'repository-owner'}, repository.ownerLogin),
  span({class: 'repository-slash', 'aria-hidden': 'true'}, '/'),
  h2(repository.name)
)
div(
  {class: 'repository-card-footer'},
  div({class: 'repository-card-facts'}, ...real facts),
  span({class: `triage-pill triage-${...}`}, ...)
)
```

Do not add GitHub star counts or “updated ago” because those fields are not in the existing product record.

- [ ] **Step 6: Run the focused DOM suite**

Run:

```bash
rtk bun test tests/dashboard/dom.test.ts
```

Expected: PASS. If a test fails on message dispatch, focus restoration, keyboard navigation, selection, or dialog semantics, fix the structural regression before styling.

- [ ] **Step 7: Commit**

```bash
rtk git add src/dashboard/scripts.ts tests/dashboard/dom.test.ts
rtk git commit -m "feat: rebuild dashboard shell around repository library"
```

---

### Task 4: Specify and implement the self-contained visual system

**Files:**
- Modify: `tests/dashboard/styles.test.ts:1-600`
- Replace: `src/dashboard/styles.css`
- Test: `tests/dashboard/styles.test.ts`

- [ ] **Step 1: Replace Archive.Stars-specific style assertions with failing new-world contracts**

Keep reusable parser, contrast, forced-colors, reduced-motion, modal, target-size, and shimmer tests. Replace old `--archive-*` and square/brutalist assertions with named roles such as:

```ts
const root = declarationsFor(styles, ':root')
expect(root).toContain('--canvas: #f8fafc;')
expect(root).toContain('--surface: #ffffff;')
expect(root).toContain('--text-primary: #0f172a;')
expect(root).toContain('--radius-card: 16px;')
expect(root).toContain('--shadow-card: 0 4px 20px')
expect(styles).toMatch(/font-family:\s*"Geist Sans"/)
expect(styles).not.toMatch(/https?:\/\//i)
```

Assert:

- `.app-header` is sticky, approximately 64px tall, and translucent using an alpha surface plus `backdrop-filter`/`-webkit-backdrop-filter` blur with a solid fallback.
- `.app-frame` is a desktop sidebar/content grid capped at 1440px.
- `.list-sidebar` is sticky below the header.
- `.repository-card-grid` uses three responsive columns at wide widths, two at tablet, one at mobile.
- `.repository-card-shell` has a cool border, 16px radius, and restrained shadow.
- `.repository-card` has a light hover/focus treatment, not full black inversion.
- `.nav-item[aria-current="page"]` has a dark filled current state.
- pills are reserved for counts/status/tag-like values; page sections are not pill containers.
- one bounded `dashboard-enter` keyframe supplies a short opacity/translate entry rhythm to the library heading/sidebar/cards with stagger expressed through a CSS custom property or `nth-child`; content remains visible by default and reduced motion suppresses the animation.

- [ ] **Step 2: Run style tests and verify they fail**

Run:

```bash
rtk bun test tests/dashboard/styles.test.ts
```

Expected: FAIL on old Archive.Stars tokens, dimensions, and component treatment.

- [ ] **Step 3: Load the Impeccable craft floor immediately before editing UI**

Read completely:

```text
/Users/jolo/.pi/agent/skills/impeccable/reference/craft-floor.md
```

Apply its bans and quality floor to all following CSS work.

- [ ] **Step 4: Replace the font and token foundation**

Bundle local fonts:

```css
@font-face {
  font-family: "Geist Sans";
  src: url("../../node_modules/geist/dist/fonts/geist-sans/Geist-Variable.woff2") format("woff2");
  font-weight: 100 900;
  font-style: normal;
  font-display: swap;
}
```

Retain the correct existing Geist Mono file. Define semantic light tokens for cool canvas/surfaces, slate text, borders, controls, focus, status, radii, and one card shadow. Keep every token needed by existing operational/status components so no state falls back to browser defaults.

- [ ] **Step 5: Implement the reference shell and Library composition**

Write the CSS in responsibility order:

1. reset, fonts, focus, typography;
2. sticky `.app-header`, brand, primary nav, account indicator;
3. `.app-frame` sidebar/content grid;
4. My Lists navigation/current/count/markers;
5. library heading/search/toolbar/view/filter controls;
6. cards and alternate rows;
7. progressive controls and empty/status panels.

Use a translucent header material (`rgb(... / <alpha>)`, blur, border, and an opaque fallback) and one short orchestrated `dashboard-enter` opacity/translate rhythm across the sidebar, library heading, and cards. Use restrained transitions on border, shadow, color, and transform; avoid animating layout properties. Ensure the no-animation/default state never hides content.

- [ ] **Step 6: Implement dialogs, Operations, Settings, authorization, and safety states in the same world**

Restyle existing selectors rather than replacing behavior. Maintain visible borders/backgrounds and text labels for:

- success/warning/error banners;
- retrying/queued/failed/blocked mutation chips;
- disabled controls;
- destructive actions and no-undo notices;
- inspection and confirmation dialogs;
- selection bar, membership preview, operation history, Settings cards, and first-run/auth states.

- [ ] **Step 7: Implement responsive, dark, forced-color, and reduced-motion rules**

Required breakpoints:

- wide: 3-card grid and 256px sidebar;
- medium: 2-card grid and narrower sidebar;
- `max-width: 700px`: stacked/sidebar selector flow, 1-card grid, 16px form controls, 44px targets, bottom-sheet dialogs where already used;
- 320px: no clipping or hidden primary routes.

Dark mode must define every critical semantic token and a suitable translucent header surface/fallback. Forced-colors rules must explicitly cover current navigation, selected cards/rows, focus, buttons/inputs, status banners, and links. Reduced motion must suppress `dashboard-enter`, hover lift, shimmer, and transition duration; style tests must assert the named entry animation exists and is neutralized inside the reduced-motion media query.

- [ ] **Step 8: Run style and DOM tests**

Run:

```bash
rtk bun test tests/dashboard/styles.test.ts tests/dashboard/dom.test.ts
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
rtk git add src/dashboard/styles.css tests/dashboard/styles.test.ts
rtk git commit -m "feat: apply minimal slate dashboard visual system"
```

---

### Task 5: Harden edge cases and preserve operational state legibility

**Files:**
- Modify: `src/dashboard/scripts.ts` only if semantic wrappers/labels are missing
- Modify: `src/dashboard/styles.css`
- Modify: `tests/dashboard/dom.test.ts`
- Modify: `tests/dashboard/styles.test.ts`

- [ ] **Step 1: Add failing edge-case assertions**

Use existing fixtures to cover:

- long repository owner/name and long List names do not remove visible text or accessible names;
- null description renders `No description provided.`;
- absent language does not render an empty decorative fact;
- status chips remain readable beside long metadata;
- Operations/Settings still render inside the one main landmark;
- account indicator is absent—not an empty control—when identity is null;
- destructive actions remain disabled while authorization/readiness blocks them.

CSS source assertions should require `min-width: 0`, intentional `overflow-wrap`, bounded line clamp only on descriptions, and non-clipping dialog overflow.

- [ ] **Step 2: Run focused tests and verify any new assertions fail**

Run:

```bash
rtk bun test tests/dashboard/dom.test.ts tests/dashboard/styles.test.ts
```

Expected: only newly exposed layout/semantic gaps fail.

- [ ] **Step 3: Apply one bounded hardening patch**

Fix wrappers, wrapping, disabled/status contrast, and responsive overflow without adding new features or changing business logic.

- [ ] **Step 4: Re-run focused tests**

Run:

```bash
rtk bun test tests/dashboard/dom.test.ts tests/dashboard/styles.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
rtk git add src/dashboard/scripts.ts src/dashboard/styles.css tests/dashboard/dom.test.ts tests/dashboard/styles.test.ts
rtk git commit -m "fix: harden redesigned dashboard states"
```

---

### Task 6: Run release verification and preserve the emitted contract

**Files:**
- Verify all changed files
- Verify built output under `dist/chrome` and `dist/firefox`

- [ ] **Step 1: Run source and type checks**

```bash
rtk bun run check:source
rtk bun run typecheck
```

Expected: both exit 0.

- [ ] **Step 2: Run the complete test suite**

```bash
rtk bun test tests
```

Expected: all tests pass with zero failures.

- [ ] **Step 3: Build both extension targets and inspect them**

```bash
rtk env -u NODE_OPTIONS bun run build:chrome
rtk env -u NODE_OPTIONS bun run build:firefox
rtk bun run inspect:build
```

Expected: both builds and inspection exit 0; no remote design dependency is emitted.

- [ ] **Step 4: Verify the direction contract survived production builds**

```bash
rtk grep -R "seed 82166ef0" dist/chrome dist/firefox
```

Expected: the contract appears in both built dashboard HTML files.

- [ ] **Step 5: Run the combined project check**

```bash
rtk env -u NODE_OPTIONS bun run check
```

Expected: exit 0.

- [ ] **Step 6: Commit any verification-only fixes as one bounded patch**

If verification required changes, re-run the exact failing command and commit only those fixes:

```bash
rtk git add <changed-files>
rtk git commit -m "fix: satisfy dashboard release checks"
```

---

### Task 7: Perform the bounded visual finish, detector, independent review, and documentation

**Files:**
- Create: `scripts/generate-dashboard-review.ts`
- Modify if required by the single fix batch: `src/dashboard/scripts.ts`, `src/dashboard/styles.css`, related tests
- Create: `.impeccable/review/dashboard-fixture.html` (temporary, do not commit)
- Create: `.impeccable/review/star-list-manager-desktop.png`
- Create: `.impeccable/review/star-list-manager-mobile.png`
- Create/update: `DESIGN.md` and the exact Impeccable sidecar emitted by the documenter

- [ ] **Step 1: Create a non-shipping, no-network visual-review fixture generator**

Create `scripts/generate-dashboard-review.ts`. It must:

1. instantiate happy-dom and install the same required globals as `tests/dashboard/dom.test.ts`;
2. create a host element, call exported `mountDashboard(host, representativeState)` with a deterministic `AppState` containing real-shaped local repositories, native Lists, long text, stale/partial banners, and queued/retrying/failed/blocked-unknown jobs, and await `browserWindow.happyDOM.whenAsyncComplete()` before serialization;
3. keep write authorization unavailable and provide no `chrome.runtime.sendMessage`, so selection/destructive controls are visibly gated and no remote mutation can be sent;
4. assert the mounted host contains `.app-shell`, `.app-header`, `.list-sidebar`, and `Star List Manager` before writing output;
5. read `src/dashboard/styles.css`, serialize the complete mounted host, and write a static document with inline CSS to `.impeccable/review/dashboard-fixture.html`;
6. label the fixture in an HTML comment as synthetic review data and never include it in extension source/build inputs.

Generate it:

```bash
rtk bun scripts/generate-dashboard-review.ts
```

Expected: `.impeccable/review/dashboard-fixture.html` exists, contains `Star List Manager`, and contains no `https://` resource.

- [ ] **Step 2: Open the local fixture and capture desktop/mobile in one inspection batch**

Open the static file without a server or extension profile:

```bash
terminal-browser open .impeccable/review/dashboard-fixture.html --split right
terminal-browser action -- set viewport 1440 1000
terminal-browser action -- screenshot .impeccable/review/star-list-manager-desktop.png
terminal-browser action -- set viewport 390 844
terminal-browser action -- screenshot .impeccable/review/star-list-manager-mobile.png
```

Save exactly:

```text
.impeccable/review/star-list-manager-desktop.png
.impeccable/review/star-list-manager-mobile.png
```

Inspect both together against the approved reference and direction contract: first-viewport hierarchy, header translucency/height, sidebar proportion, 3/2/1 card behavior, real control density, long text, focus, representative status/destructive state clarity, and no horizontal clipping. Interaction and mutation safety remain covered by DOM tests; the static fixture is visual evidence only.

- [ ] **Step 3: Apply one batched correction and confirm once**

Fix all material issues from the first inspection in one patch. Regenerate the static fixture from current code before reloading and recapturing both viewports once:

```bash
rtk bun scripts/generate-dashboard-review.ts
terminal-browser action -- reload
terminal-browser action -- set viewport 1440 1000
terminal-browser action -- screenshot .impeccable/review/star-list-manager-desktop.png
terminal-browser action -- set viewport 390 844
terminal-browser action -- screenshot .impeccable/review/star-list-manager-mobile.png
```

Stop in-thread polishing after this confirmation round.

- [ ] **Step 4: Run the Impeccable detector once**

```bash
rtk node /Users/jolo/.pi/agent/skills/impeccable/scripts/detect.mjs --json src/dashboard/index.html src/dashboard/scripts.ts src/dashboard/styles.css
```

Fix mechanical findings in one batch. Do not run the detector again. If any source changed, regenerate and recapture without starting another inspection pass so the reviewer sees current code:

```bash
rtk bun scripts/generate-dashboard-review.ts
terminal-browser action -- reload
terminal-browser action -- set viewport 1440 1000
terminal-browser action -- screenshot .impeccable/review/star-list-manager-desktop.png
terminal-browser action -- set viewport 390 844
terminal-browser action -- screenshot .impeccable/review/star-list-manager-mobile.png
```

Record remaining detector findings for the independent reviewer.

- [ ] **Step 5: Dispatch the shipped finish reviewer fresh**

Spawn `impeccable-finish-reviewer` with:

- original request and approved brand answer;
- artifact path `src/dashboard/index.html`;
- desktop/mobile screenshot paths;
- direction contract and seed;
- detector findings;
- approved spec path;
- craft-floor path `/Users/jolo/.pi/agent/skills/impeccable/reference/craft-floor.md`.

Require the five contract sections and a verdict. If it requests material fixes, apply one batch, then regenerate the fixture before rebuilding/recapturing:

```bash
rtk bun scripts/generate-dashboard-review.ts
terminal-browser action -- reload
terminal-browser action -- set viewport 1440 1000
terminal-browser action -- screenshot .impeccable/review/star-list-manager-desktop.png
terminal-browser action -- set viewport 390 844
terminal-browser action -- screenshot .impeccable/review/star-list-manager-mobile.png
```

Resume the same reviewer with the current screenshots for disposition. Follow the two-round ceiling from Impeccable.

- [ ] **Step 6: Dispatch the shipped documenter**

Spawn `impeccable-documenter` with project root, artifact path, direction contract, `PRODUCT.md`, `/Users/jolo/.pi/agent/skills/impeccable/reference/document.md`, and the dashboard boundary. Verify it writes `DESIGN.md` and the sidecar from the built implementation.

- [ ] **Step 7: Run final evidence checks**

```bash
rtk git diff --check
rtk git status --short
rtk env -u NODE_OPTIONS bun run check
```

Expected: no whitespace errors; only intended review/documentation artifacts are uncommitted before the final commit; complete check exits 0.

- [ ] **Step 8: Commit finish artifacts and documentation**

Remove the temporary fixture before staging:

```bash
rtk rm .impeccable/review/dashboard-fixture.html
```

Determine the exact sidecar path written by the documenter from `rtk git status --short`, then stage only named outputs:

```bash
rtk git add src/dashboard/index.html src/dashboard/scripts.ts src/dashboard/styles.css tests/dashboard/dom.test.ts tests/dashboard/styles.test.ts scripts/generate-dashboard-review.ts DESIGN.md .impeccable/surfaces/src-dashboard-index-html.md .impeccable/review/star-list-manager-desktop.png .impeccable/review/star-list-manager-mobile.png <exact-design-sidecar-path> docs/superpowers/plans/2026-08-20-star-list-manager-reference-redesign.md
rtk git commit -m "docs: record redesigned dashboard system"
```

- [ ] **Step 9: Report the final reviewer verdict exactly**

Include changed files, commands run, screenshot paths, detector residuals, the reviewer’s disposition/table, and any open material findings. Do not describe an open-material-finding verdict as a pass.
