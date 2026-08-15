## Context

The dashboard currently derives a selected repository for every result set and renders `RepositoryInspector` as a sticky second column in `LibraryResults`. Repository rows are already semantic buttons, while existing unstar and membership confirmations use a tested custom dialog pattern with a backdrop, `role="dialog"`, `aria-modal`, keyboard handling, focus capture, and invoker restoration. See `proposal.md` for motivation and the `repository-discovery-ui` delta specification for behavior.

## Goals / Non-Goals

**Goals:**

- Move the complete inspector experience into a focused, scrollable modal without dropping any metadata, local organization control, GitHub account-change control, or operation history.
- Reuse the established custom dialog and focus-restoration conventions so Chromium, Firefox, and the DOM test environment behave consistently.
- Keep repository browsing full width while no inspection is open.

**Non-Goals:**

- Change annotation persistence, GitHub authorization, mutation preview/confirmation, queue execution, or remote verification.
- Introduce native HTML dialog dependencies, routing, URL-addressable repository inspection, or multiple simultaneously open repository inspectors.
- Change bulk selection, keyboard result navigation, or existing confirmation-dialog semantics beyond ensuring their stacking and focus behavior remains correct.

## Decisions

### Keep inspection state separate from result-list selection

Introduce dedicated transient state for the repository currently being inspected and the result element that opened it. Preserve the existing result-list selection state for arrow-key navigation and row styling, but only open inspection on explicit row activation. Clear inspection when its repository is no longer present in the active result set or when the user changes the library context.

This prevents keyboard navigation or the current first-result fallback from unexpectedly opening a modal. It also makes close behavior deterministic: the result list remains selected, but the modal disappears.

Alternative considered: reuse the existing selected repository state as the modal source. This would open the modal for the implicit first result and whenever keyboard navigation changes selection, which conflicts with intentional modal activation.

### Reuse the established custom dialog shell and focus lifecycle

Render the inspector in the existing fixed-backdrop dialog system instead of adding a native `<dialog>` element. Give the modal an accessible name based on the repository, trap Tab and Shift+Tab within it, focus it or its close control on open, support Escape, and restore focus to the saved invoking row on close. The repository dialog closes normally before a nested unstar or membership confirmation opens; confirmation dialogs retain their existing close guards while remote work is pending.

This matches tested project conventions and avoids differences in native-dialog behavior across extension targets and the happy-dom test environment.

Alternative considered: use a native `<dialog>` element. It provides browser-managed modality but requires separate compatibility and test-environment handling and would diverge from the application's existing confirmation dialogs.

### Reuse inspector content and adapt layout only at the modal boundary

Keep the existing repository-detail renderer as the single source for metadata and controls. Wrap it in a repository-modal heading that adds the close control and supplies the dialog's accessible label; retain its internal local and remote actions unchanged. Remove the side-column grid layout, sticky inspector rules, and placeholder-specific rendering. Add responsive dialog sizing with bounded viewport height and internal scrolling so long notes, histories, and account controls remain reachable.

This minimizes behavioral regression because the controls, handlers, and state transitions stay intact; only their container changes.

Alternative considered: duplicate inspector sections into a new modal-only component. Duplication risks drift between the former and new workflows without providing a user-visible benefit.

## Risks / Trade-offs

- [Modal content is longer than the viewport] → Bound the dialog height and make its content area independently scrollable while keeping the close control reachable.
- [Focus is lost after a result-set change or rerender] → Store the invoking row identity, restore focus only when the matching row is still connected and enabled, and otherwise fall back to the repository list.
- [A nested confirmation is opened from the inspector] → Preserve the existing confirmation dialog's higher stacking layer and focus-restoration ownership; do not let Escape dismiss a confirmation that is intentionally locked during queueing.
- [The row that opened inspection becomes filtered out] → Close the repository dialog instead of showing stale or invisible-context content.

## Migration Plan

1. Add the transient inspection state and modal shell while retaining the existing inspector content renderer.
2. Replace the library-grid side inspector and placeholder with explicit modal activation from repository rows.
3. Update layout and responsive styles, then add DOM coverage for open, close, Escape, focus restoration, full control retention, and nested confirmation behavior.
4. Roll back by restoring the inspector as the second library-grid column; no data migration or remote-state rollback is required.
