# Star List Manager Reference Redesign

**Date:** 2026-08-20  
**Surface:** Extension dashboard (`src/dashboard/index.html`)  
**Mode:** Operate

## Objective

Replace the current Archive.Stars visual world with a self-contained Star List Manager interface based on the supplied “Stellar — Minimal Git Star Manager” reference. Preserve the product name, real data, local-first behavior, authorization boundaries, mutation safety, accessibility contracts, and all existing dashboard destinations.

## Approved Direction

The dashboard becomes a calm, light repository library: a translucent sticky header, compact product mark, left-hand List navigation, spacious library toolbar, and a responsive grid of softly bordered repository cards. Slate neutrals carry the interface; repository language and status colors provide restrained accents. Rounded geometry, subtle elevation, and locally packaged Geist Sans replace the incumbent mono-forward brutalist archive treatment.

“Stellar” is not introduced as a product name. The visible wordmark remains **Star List Manager**.

## Approaches Considered

### 1. Structural adaptation — selected

Retain the VanJS application and state model while changing the shell, semantic grouping, default result presentation, and CSS system. This reaches the reference faithfully without rewriting proven behavior.

### 2. CSS-only skin

Retain the existing Archive.Stars DOM and recolor it. This has the smallest diff but cannot reproduce the supplied header, sidebar, toolbar, and card hierarchy. Rejected.

### 3. Full component rewrite

Split and rewrite the dashboard into a new component architecture. This could improve maintainability but would unnecessarily endanger mature keyboard, focus, confirmation, and remote-write behavior. Rejected.

## Information Architecture

### Global header

- Compact star mark and **Star List Manager** wordmark.
- Real destinations only: Library, Operations, and Settings.
- The connected-account initial moves into the sticky global header and remains visible on Library, Operations, and Settings as an accessible account indicator.
- The existing search field does **not** move into global navigation: it remains in `LibraryHeader`, where its local-library scope is unambiguous, but receives the reference’s compact rounded-search treatment.
- No fake Explore route, repository route, profile image, or remote asset is added.

### Library sidebar

- “My Lists” heading.
- Existing Unlist view and real native GitHub Lists with live counts.
- Active view uses a dark filled treatment; inactive Lists may use deterministic decorative marker colors assigned by rendered index. Markers carry `aria-hidden="true"`, require no persisted or API data, and never communicate state without the existing name, count, and current-page treatment.
- No create-List control is shown because the product does not support native List creation.
- No decorative recent-tag chips are shown unless they operate real filtering behavior.

### Library content

- View title, real result count, refresh, filter/view controls, and status disclosures form one clear toolbar region.
- Cards become the default result mode to match the supplied reference; the existing List/Cards control remains available.
- Existing advanced filters remain real controls inside a compact disclosure surface.
- Progressive local rendering remains unchanged; fake pagination and remote-loading claims are prohibited.

### Other product states

Operations, Settings, loading, signed-out, authorization, empty, error, inspection, membership preview, unstar confirmation, selection, and operation-history states inherit the same typography, color, radius, border, and elevation system. They remain inside the single main landmark and keep existing semantics.

## Component Mapping

- `Dashboard` retains one shell and one main landmark, but receives neutral `app-*`/existing semantic class treatments instead of Archive.Stars presentation.
- `ArchiveHeader` is renamed or reworked as the Star List Manager application header, retaining the same three real navigation actions and rendering the connected-account indicator from `publishedIdentity` on every destination.
- `Navigation` and `NavigationGroups` render the My Lists rail from existing local state.
- `LibraryHeader` keeps the real library-scoped search, sync, result-mode, sort, language, and filter controls; layout and labels may be clarified without changing query behavior.
- `RepositoryCard` becomes the primary visual record. It keeps the real button, repository identifier, selection control, keyboard navigation, inspection activation, local annotations, language, star state, mutation status, and triage state.
- `RepositoryRow` remains as the alternate dense list mode.
- Dialog and state components retain their event handlers, roles, live-region behavior, authorization gates, and focus lifecycle.

No new runtime message, persistence, GitHub request, or mutation action is introduced.

## Data and Interaction Flow

1. Existing published VanJS state derives repositories, Lists, counts, query results, status, and mutation state.
2. Sidebar navigation updates the existing `activeView` and resets selection/preview state exactly as today.
3. Search, sort, language, and advanced filters continue through `updateRepositoryQuery` and `currentQuery`.
4. Result mode changes only local presentation; default mode changes from List to Cards.
5. Card or row activation opens the existing repository inspection dialog.
6. Selection, membership preview, unstar confirmation, queueing, and remote verification paths remain unchanged.

## Visual System

- **Color strategy:** Restrained—cool white/slate surfaces with one dark ink action color; semantic success, warning, and danger remain explicit labeled accents. Any List or language dot is decorative only, uses deterministic CSS/local mappings, is hidden from assistive technology, and does not replace visible text.
- **Typography:** Locally packaged Geist Sans for interface and prose, with Geist Mono reserved for compact metadata where it improves scanning. No Google Fonts or runtime network request.
- **Geometry:** 8–16px radii according to component scale; pills only for tags/counts/statuses; no excessive nested rounded containers.
- **Elevation:** Thin cool-gray borders and one restrained card shadow. Hover uses border emphasis and slight lift without obscuring state.
- **Motion:** One short entry rhythm plus purposeful hover/disclosure transitions; all suppressed under reduced motion.
- **Density:** Comfortable three-column desktop cards, two columns at intermediate widths, and one column on mobile. The sidebar collapses into a horizontal/stacked List selector without hiding functionality.

## Accessibility and Resilience

- Preserve exactly one `<main>` landmark.
- Preserve keyboard result navigation, row/card focus, dialog focus trapping/restoration, `aria-current`, `aria-pressed`, status roles, labels, and accessible names.
- Keep visible 3px focus indicators and AA contrast.
- Maintain 44px interactive targets on narrow screens and support 320px without horizontal clipping.
- Maintain explicit dark mode, forced-colors, and reduced-motion behavior.
- Keep all design assets bundled locally and compatible with extension CSP.
- Long repository names, descriptions, List names, metadata, operation errors, and localized-length copy must wrap or truncate intentionally.

## Error and Safety Handling

The redesign must not visually minimize stale, partial, authorization, write-readiness, queued, retrying, failed, or blocked-unknown states. Semantic banners retain text labels in addition to color. Destructive actions remain visually distinct, require their existing confirmation, and never become available earlier in the flow.

## Testing Strategy

1. Update DOM tests first to assert the Star List Manager wordmark, real header destinations, global account indicator, library-scoped search, My Lists navigation, default card presentation, single main landmark, and unchanged card/row activation contracts.
2. Add representative DOM assertions for stale/partial banners, write-readiness messaging, queued/retrying/failed/blocked-unknown mutation labels, disabled destructive actions, and confirmation-gated unstar behavior. Text labels and availability—not color alone—remain the primary contracts.
3. Update CSS tests to assert local Geist Sans, slate tokens, sticky 64px-style header, responsive sidebar/card grid, visible focus, explicit success/warning/danger/destructive treatments with contrast-safe token pairs, dark mode, reduced motion, forced colors, and no runtime URLs.
4. Run focused dashboard DOM and style tests after each implementation slice.
5. Run source checks, strict TypeScript, full tests, Chromium and Firefox builds, and built bundle inspection.
6. Inspect one desktop and one mobile screenshot in a single batch, including representative safety/status states where feasible; apply one batched correction and confirm once.

## Explicit Non-Goals

- Renaming the product to Stellar.
- Adding Explore, repository discovery, create-List, random-repository, pagination, profile-image, or toast behaviors that the product does not implement.
- Introducing Tailwind, Iconify, remote fonts, CDN scripts, analytics, or backend services.
- Changing authentication, synchronization, storage, message schemas, mutation queues, or GitHub write boundaries.
- Refactoring unrelated application logic.
