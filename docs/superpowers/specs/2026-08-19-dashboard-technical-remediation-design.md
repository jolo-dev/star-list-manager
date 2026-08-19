# Dashboard Technical Remediation Design

**Date:** 2026-08-19
**Status:** Approved

## Goal

Resolve every P1 and P2 issue from the dashboard technical audit while preserving Star List Manager's warm parchment/sage visual identity and product-specific interaction model.

## Scope

The implementation covers the full Impeccable remediation sequence: harden, colorize, optimize, clarify, adapt, typeset, and polish. It includes production code, CSS, extension assets, and focused regression tests.

## Navigation and information architecture

Restore persistent **Operations** and **Settings** destinations in the production sidebar. Keep Unlist and GitHub Lists as the primary library group, with utility destinations visually separated. Every retained `LibraryView` must be reachable; obsolete view kinds and recovery routes will be removed or redirected to a visible destination.

Page headings and filter labels will describe the actual repository population. Unstarred history will not appear under an “All stars” heading. Filter badges will count only controls represented by that filter group. Sidebar counts and visible totals will use clearly aligned archive/filter semantics.

## Rendering and performance

Build a latest-job index once per dashboard state instead of filtering and sorting the complete mutation history for every repository. Repository queries will be computed once per active query state and shared by the result count, visible rows, and inspector-validity checks.

The dashboard shell will remain stable during polling. State refreshes will avoid unnecessary assignment when materially unchanged, and updates must preserve focused controls and list scroll. Where a successful operation removes the focused control, focus will move to the logical surviving destination.

Performance changes will be covered with synthetic large-library tests and before/after timing evidence rather than micro-optimizations without measurement.

## Accessibility and responsive behavior

The document will expose one primary `<main>` landmark. The application root will no longer be a broad live region; concise, targeted status regions will announce search and operation changes.

Import JSON will receive a visible `:focus-within` treatment. Dialog and inline-editor success paths will restore or deliberately relocate focus. Text and control boundaries will meet WCAG AA contrast. Long repository, account, and List names will wrap or expose their full content at narrow widths and 200% zoom. Touch targets will remain at least 44px, including selection controls.

The responsive target is functional reflow from 320px through wide desktop, supporting keyboard, pointer, and coarse-pointer input without hiding core functionality.

## Color and themes

Preserve the established warm parchment, navy, sage, success, warning, and danger relationships. Convert repeated component literals into semantic tokens.

The default light theme remains visually familiar. A deliberately composed dark palette will follow `prefers-color-scheme: dark`; it will use explicit surface elevation and contrast rather than mechanical inversion. `forced-colors: active` rules will preserve visible focus, current navigation, selection, form boundaries, and status differentiation.

## Typography

Keep Geist Mono for the brand, repository metadata, counts, and technical values. Use a deliberate proportional sans-serif stack for prose, forms, dialogs, and longer operational explanations. Both roles receive explicit fallback stacks.

Typography will use consistent role tokens, a 16px ordinary reading floor, comfortable line height, and bounded prose measure. Labels and dense metadata may remain smaller where contrast and zoom behavior remain compliant.

## Polish and cleanup

Replace the paint-heavy background-position shimmer with a static or compositor-friendly treatment while preserving reduced-motion behavior. Generate correctly sized PNG assets for each manifest icon slot. Remove dead navigation CSS, obsolete view types, and tests that preserve stale concepts.

The final pass will check state completeness, token consistency, responsive wrapping, long content, focus, motion, and accidental diff churn.

## Testing and verification

Add regression coverage for:

- Operations and Settings reachability;
- unique main landmark and scoped live regions;
- focus after polling and successful operations;
- Import JSON focus visibility;
- latest-job indexing and shared query derivation;
- coherent titles, filter badges, and counts;
- contrast-relevant semantic tokens;
- dark and forced-colors theme blocks;
- long-content wrapping and 44px touch targets;
- removal of stale views and navigation CSS;
- generated icon dimensions.

Run dashboard tests, the complete test suite, typecheck, Chrome and Firefox production builds, build inspection, the Impeccable detector, and a final source/diff review. Browser checks will cover representative desktop and 320px mobile layouts when the extension page can be loaded in the available environment.

## Non-goals

- Rebranding or replacing the incumbent visual world.
- Adding a manual theme preference; theme follows the operating system.
- Redesigning GitHub authorization or mutation semantics.
- Adding decorative motion or unrelated dashboard features.
