# Dashboard Focus and Accessibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Star List Manager easier to scan and operate across desktop, mobile, mouse, and keyboard without changing its GitHub safety model.

**Architecture:** Keep the dashboard's existing Van.js state model and data flow. Reshape only the presentation layer: progressive disclosures for view controls and sidebar groups, structurally separate local organization from remote GitHub changes, and accessible confirmation-dialog keyboard handling. Expand the CSS token system with responsive navigation, readable text roles, and touch-safe interaction sizing.

**Tech Stack:** TypeScript, Van.js, CSS, Happy DOM, Bun tests, Extension.js.

---

### Task 1: Lock workspace focus and mobile navigation in tests

**Files:**
- Modify: `tests/dashboard/dom.test.ts`
- Modify: `tests/dashboard/styles.test.ts`

- [ ] **Step 1: Write failing DOM tests**

Assert that a rendered library keeps the five primary views separate from History and uses a labelled, mobile-visible utility group for History, Operations, and Settings. Assert that GitHub Lists and local tags render inside discoverable sidebar groups, and that row triage state remains available at mobile widths.

Add a stylesheet contract that the mobile media query does not hide `.triage-pill` and that mobile navigation summaries and primary controls have a 44px minimum touch target.

- [ ] **Step 2: Run the dashboard test file**

Run: `bun test tests/dashboard/dom.test.ts tests/dashboard/styles.test.ts`

Expected: FAIL because the current header exposes all controls, History is primary navigation, and mobile CSS hides secondary navigation and triage state.

- [ ] **Step 3: Write failing dialog tests**

Assert that both unstar and native List confirmation overlays cancel when Escape is pressed, and retain explicit accessible dialog naming.

- [ ] **Step 4: Run the targeted tests**

Run: `bun test tests/dashboard/dom.test.ts`

Expected: FAIL because native List confirmation currently has no Escape handler.

### Task 2: Distill controls and adapt navigation

**Files:**
- Modify: `src/dashboard/scripts.ts:128-197`
- Modify: `src/dashboard/scripts.ts:320-424`
- Modify: `src/dashboard/styles.css`

- [ ] **Step 1: Restructure navigation**

Keep Inbox, Backlog, Due, Organized, and All stars as the visible primary library views. Move history and utility destinations into labelled groups. Render dynamic Lists and tags in native `<details>` groups so they remain reachable on mobile while avoiding an unbounded sidebar.

- [ ] **Step 2: Add View options progressive disclosure**

Keep search and Refresh prominent. Put language, sorting, direction, and archive visibility inside one labelled `details.view-options` control, retaining the existing state and filter behavior.

- [ ] **Step 3: Update responsive CSS**

At mobile widths, retain all navigation groups, use compact scrollable primary navigation, make summaries and buttons at least 44px tall, preserve readable triage state, and reflow view options and filters into a single-column touch layout.

- [ ] **Step 4: Run focused tests**

Run: `bun test tests/dashboard/dom.test.ts --test-name-pattern "navigation|view options"` and `bun test tests/dashboard/styles.test.ts`

Expected: PASS.

### Task 3: Complete keyboard and confirmation-dialog behavior

**Files:**
- Modify: `src/dashboard/scripts.ts:651-830`
- Modify: `src/dashboard/scripts.ts:294-318`
- Modify: `src/dashboard/styles.css`
- Test: `tests/dashboard/dom.test.ts`

- [ ] **Step 1: Write failing keyboard and dialog tests**

Assert that result-row selection uses a conventional keyboard pattern with a visible focused button, both dialogs accept Escape only when cancellation is available, focus their cancel action when mounted, retain focus within the dialog on Tab, and restore focus to the opener after cancellation.

- [ ] **Step 2: Run the targeted tests**

Run: `bun test tests/dashboard/dom.test.ts --test-name-pattern "keyboard|confirmation"`

Expected: FAIL because membership confirmation lacks Escape handling and neither confirmation owns a complete focus lifecycle.

- [ ] **Step 3: Implement one reusable modal lifecycle**

Capture the opener before the pending state changes; then, after the dialog renders, focus its cancel control. Handle Tab / Shift+Tab within the dialog, Escape only while work is not queueing, and restore the opener when cancelling. Preserve all disabled and readiness gates. Use a conventional button list for repository rows rather than a partial listbox pattern.

- [ ] **Step 4: Run the targeted tests**

Run: `bun test tests/dashboard/dom.test.ts --test-name-pattern "keyboard|confirmation"`

Expected: PASS.

### Task 4: Separate local triage from remote GitHub changes

**Files:**
- Modify: `src/dashboard/scripts.ts:1133-1257`
- Modify: `src/dashboard/styles.css`
- Test: `tests/dashboard/dom.test.ts`

- [ ] **Step 1: Write a failing inspector test**

Assert that repository details identify local organization and GitHub changes as distinct labelled sections, and that the GitHub section makes its account consequence visible before mutation controls. Retain unstar readiness / active-job disabling, native-List capability gating, and the preview-before-confirmation sequence.

- [ ] **Step 2: Run the focused test**

Run: `bun test tests/dashboard/dom.test.ts`

Expected: FAIL because the current inspector interleaves membership, unstar, and local-editing controls.

- [ ] **Step 3: Restructure the inspector**

Wrap repository metadata, local triage, and GitHub changes in visually and semantically distinct groups. Keep Native List membership and unstar actions within the GitHub group; preserve every existing action, gate, and status.

- [ ] **Step 4: Run the focused test**

Run: `bun test tests/dashboard/dom.test.ts`

Expected: PASS.

### Task 5: Clarify safety copy and recovery paths

**Files:**
- Modify: `src/dashboard/scripts.ts:651-731`
- Modify: `src/dashboard/scripts.ts:960-964`
- Modify: `src/dashboard/scripts.ts:1565-1580`
- Modify: `tests/dashboard/dom.test.ts`

- [ ] **Step 1: Lead with the outcome**

Rewrite List confirmation copy to state the repositories affected, the resulting Lists, and the required reconfirmation. Keep non-atomic and complete-set mechanics as concise supporting notices rather than the first message users scan.

- [ ] **Step 2: Add actionable error recovery where it is safe**

For stale List observations, direct users to the existing refreshed-preview action. For `blocked-unknown`, state that the repository must be refreshed and reviewed before retry; do not add automatic retry or weaken confirmation gates.

- [ ] **Step 4: Run dashboard tests**

Run: `bun test tests/dashboard/dom.test.ts`

Expected: PASS.

### Task 6: Tune the typography system and verify builds

**Files:**
- Modify: `src/dashboard/styles.css`
- Modify: `tests/dashboard/styles.test.ts`

- [ ] **Step 1: Write a failing typography contract**

Assert readable body and utility text floors, a proportional reading stack for prose, touch-safe controls, and the retained local Geist Mono asset for identifiers and metadata.

- [ ] **Step 2: Apply role-based typography**

Use Geist Mono for data-rich controls, repository identifiers, dates, and codes. Use a local/system proportional reading stack for descriptive copy and warnings. Increase routine utility text to 12-13px on desktop and 16px inputs on mobile.

- [ ] **Step 3: Run typography and dashboard tests**

Run: `bun test tests/dashboard/styles.test.ts tests/dashboard/dom.test.ts`

Expected: PASS.

### Task 7: Full validation and Helium rebuild

**Files:**
- Build output: `dist/chromium-based/`
- Modify: `scripts/inspect-build.ts`

- [ ] **Step 1: Add explicit Helium artifact inspection**

Extend `scripts/inspect-build.ts` to accept an optional browser target argument, validate `chromium-based` with the same manifest, host-permission, and bundle constraints as Chrome, and assert that the collected output contains a `GeistMono-Variable*.woff2` asset.

Run: `bun scripts/inspect-build.ts chromium-based`

Expected: the Chromium-based manifest, local font asset, and bundles pass the same safety checks as the store builds.

- [ ] **Step 2: Run all checks**

Run: `bun run check`

Expected: source check, typecheck, all tests, Chrome and Firefox builds, and bundle inspection pass.

- [ ] **Step 3: Rebuild the Helium bundle**

Run: `bunx --no-install extension build --browser chromium-based`

Expected: `dist/chromium-based/` contains the dashboard and local font asset.

- [ ] **Step 4: Inspect the worktree**

Run: `git diff --check` and `git status --short`

Expected: no whitespace errors; only intended source, test, dependency, documentation, and ignored local configuration changes.
