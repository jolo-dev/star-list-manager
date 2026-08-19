# Archive.Stars Reference Layout Rebuild

**Date:** 2026-08-19
**Status:** Approved design direction; implementation requires review of this written spec
**Scope:** Every dashboard view in `src/dashboard/`; preserve all application behavior.

## Problem

The prior Archive.Stars work changed the theme and added an archive shell, but retained the old product's dashboard composition: oversized panels, independently card-like controls, and inconsistent secondary views. It does not reproduce the information hierarchy in the user-supplied `redesign.md`.

This change rebuilds the interface layout around the reference while retaining the existing VanJS state, queries, controls, messages, confirmation flows, keyboard behavior, and extension boundaries.

## Reference-derived layout rules

1. **Single editorial frame.** A centered wide frame (up to 1440px) owns the complete interface. It has a 96px bordered top header; it is not a full-bleed admin-app shell.
2. **Three information bands.** The header carries the Archive.Stars mark and real primary destinations. The body is a strict directory column and an archive-content column. Within archive content, an indexed collection/status strip precedes repository records.
3. **Directory is an index, not a card.** Native Lists remain real navigation, but appear as numbered, compact index entries under the Directory/Lists label. Real counts stay real. No sample lists or fake counts are introduced.
4. **Repository records are rows, not cards.** Every existing repository remains a real interactive row/button and keeps its checkbox, inspection behavior, state, facts, language, dates, notes, and action affordances. The row is rendered as a full-width divided record: reference/owner/name and description on the left; compact facts aligned in a right-side data grid.
5. **Controls become archive utilities.** Search, Refresh, view controls, and advanced filters remain the same functional controls. They are composed as small, inline archive utilities rather than boxed panels. Selected/current state uses line, underline, or inversion—not oversized surfaces.
6. **Every view shares the grammar.** Operations, Settings, initial/loading/signed-out/error states, confirmations, and inspection dialogs all render within the same editorial frame. They use document-like headings, thin rules, compact form rows, and the same utility alignment. They must not revert to generic cards.
7. **Mobile is intentional.** At narrow widths, the header condenses without hiding reachable destinations; the directory becomes a sequential index; repository fact grids flow below the description. Full-width cards are not introduced as the mobile fallback.

## Structure

### Header

- `archive-app-shell` contains a centered `archive-frame` or equivalent structural wrapper.
- `archive-app-header` is 96px on desktop, with the mark/wordmark at left and the existing real Library, Operations, and Settings destinations at right or centered navigation.
- Current destination remains exposed with existing `aria-current` semantics.

### Body

- The frame body is a grid with a compact directory index and archive main column.
- Directory starts with `Directory / Lists`; existing GitHub Lists are numbered from real order. It contains no brand duplication, fake navigation, or utility-only routes.
- Archive main begins with a small collection identifier based on the current real view, followed by existing search/filter/refresh controls and the reactive result count.

### Library rows

- Row activation, list semantics, checkbox selection, arrow navigation, inspection dialog invocation, and data attributes remain exactly as today.
- Existing metadata must be reflowed into a dense archive row, never discarded. Row content may wrap; it must not clip or depend on fixed sample text.
- Empty, stale, partial, error, and write-readiness messages remain visible in their existing semantic status regions.

### Secondary and state views

- Operations and Settings use the archive main column, editorial titles, divided activity/settings rows, and compact form/action controls.
- Signed-out, loading, and error states retain existing copy, action semantics, `aria-busy`, alerts, and targeted live-region behavior.
- Confirmation and inspection dialogs retain modal role, accessible names, focus restoration, cancellation, authorization gates, and safety copy; their visual layout is rebuilt as archive overlays rather than cards.

## Explicit non-goals

- No API, storage, runtime-message, authentication, query, mutation, confirmation, or GitHub behavior changes.
- No fake reference data, pagination, navigation, tags, or remote assets.
- No Tailwind, icon packages, web fonts, or external CSS/script URLs.
- No change to the tested single-main, keyboard, dialog, focus, targeted-status, or forced-colors contracts.

## Accessibility and responsive rules

- Preserve one `<main>`, labelled navigation, current-location semantics, native controls, visible focus, and 44px touch targets where needed.
- Keep explicit dark mode, reduced motion, and forced colors. The reference's light page is an aesthetic direction, not a reason to remove alternative-mode support.
- On mobile, preserve all routes/controls through wrapping, stacking, or native disclosures; do not hide them.

## Acceptance evidence

1. DOM tests show the complete frame on Library, Operations, Settings, loading, signed-out/error, and dialog states.
2. DOM tests prove real controls and repository interactions survive the structural rebuild.
3. Style tests prove the 1440px frame, desktop header, directory/archive grid, divided data rows, responsive reflow, no remote assets, and accessibility modes.
4. Full source/type/test/browser build checks pass. A browser screenshot review at desktop and mobile is required before push.
