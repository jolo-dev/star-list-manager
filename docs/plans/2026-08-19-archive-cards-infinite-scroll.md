# Archive Cards and Infinite Local Results Implementation Plan

> **For Hermes:** Use subagent-driven-development skill task-by-task.

**Goal:** Add the reference List/Cards toggle and safe local progressive result rendering without changing remote behavior.

**Architecture:** Keep one existing derived local result set. Add ephemeral result-mode and visible-count state; reset it for any query/source change. Render existing interactive repository content in list or card containers, and grow only visible local items through an observer sentinel or accessible fallback.

---

### Task 1: Test and implement mode/batch state

**Files:** `tests/dashboard/dom.test.ts`, `src/dashboard/scripts.ts`

1. Add failing tests for real accessible List/Cards controls, default List, real card selection/inspection, observer batch growth, fallback button, and reset on query/filter/list changes with no runtime dispatch.
2. Run focused tests; expect missing mode/sentinel failure.
3. Add typed ephemeral mode/count state, deterministic reset, observer cleanup, and reuse current query/row behavior. Do not persist or fetch.
4. Run DOM/typecheck and commit `feat: add archive result modes`.

### Task 2: Implement card composition and styles

**Files:** `tests/dashboard/styles.test.ts`, `src/dashboard/styles.css`

1. Add failing contracts for card grid, card selected/focus state, mobile reflow, mode controls, sentinel/fallback, dark/forced/reduced modes.
2. Implement Cards using actual repository contents, responsive grid, and no card behavior that masks controls/facts.
3. Run full DOM/style/source/type tests and commit `feat: style archive card view`.

### Task 3: Validate

Run `bun run check`, strict OpenSpec validation, spec/quality review, and verify no remote messages/pagination are introduced before pushing.
