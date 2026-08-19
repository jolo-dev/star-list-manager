# Design: Archive.Stars Reference Layout

## Decision

Rebuild dashboard structure from the reference's editorial archive model, not from the current card/panel dashboard. Existing VanJS functions and state remain sources of truth; markup is recomposed around them.

## Layout contract

- A centered `archive-frame` caps desktop measure at 1440px.
- A 96px top header uses the real Library, Operations, and Settings routes.
- The body uses a narrow directory index plus archive main column. At mobile it is one sequential document.
- The Library main renders a compact view identifier/control strip and dense horizontal repository records with metadata columns.
- Secondary/state/modal views share the same archive document primitives.

## Data and behavior boundaries

No renderer may recreate query state, message dispatch, storage, GitHub data, authorization, confirmations, or dialog state. It may move existing DOM nodes/functions but must retain handlers, labels, roles, and data attributes.

## Risks and mitigations

- **Dense desktop grid may not fit variable content.** Use minmax grids and wrap rules; test long names/descriptions.
- **Moving controls may regress focus/lifecycle.** Preserve element identity where existing tests require it, extend tests before changes, and test dialogs/keyboard paths.
- **Reference-only labels could lie.** Derive view titles, counts, and directory numbering from real local data; omit unavailable concepts.
- **Layout rebuild could bury safety copy.** Keep alerts/status/confirmations in the main flow or semantic modal, with tested headings/actions.
