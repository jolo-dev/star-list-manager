# Archive Cards and Infinite Local Results Design

**Date:** 2026-08-19
**Scope:** Library results only; existing query, selection, dialog, and remote behavior are preserved.

## Decision

Add the `List / Cards` toggle expressed by `redesign.md`. Both modes consume the same already-synced, filtered, sorted local repository result set. Reaching a sentinel at the end appends the next bounded local batch. This is progressive rendering, never GitHub/network pagination.

## Behavior

- The existing View options control contains accessible, real List and Cards controls with an exposed current state.
- List remains the dense archive record layout. Cards are responsive repository summaries using real owner/name, description, language/state/facts, selection, and inspection behavior.
- Default mode is List. The mode is local UI state; it resets safely on dashboard mount, not to storage or remote APIs.
- Initial visible batch is 100; subsequent sentinel intersections append 100. If all local matches are rendered, the sentinel is absent and no loading claim is shown.
- Search, filter, sort, native List, refresh, and account/library changes reset the visible window to the initial batch. Existing keyboard focus/selection/dialog lifecycle remains valid.
- Browser environments without `IntersectionObserver` retain an accessible Load more fallback button. Tests provide a deterministic observer stub.

## Safety and non-goals

No new dependencies, API calls, runtime messages, auth/storage changes, fake data, or fabricated remote-progress copy. Existing result limits and all status/confirmation behavior remain semantically accurate.

## Acceptance

DOM tests prove the toggle, mode semantics, reset behavior, cards’ real row interactions, batch growth, observer/fallback behavior, and no new remote action. Style tests prove responsive card grid, selected/focus states, and reduced/forced/dark support. Full release checks and strict OpenSpec validation are required before push.
