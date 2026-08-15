## 1. Repository inspection state and activation

- [x] 1.1 Add transient repository-inspection and invoking-element state that is separate from result-list keyboard selection.
- [x] 1.2 Open inspection only when a repository row is explicitly activated, and close it when the active view, search, or filtered result set no longer contains the inspected repository.
- [x] 1.3 Preserve the selected result row after modal dismissal so focus can return to the repository that opened inspection.

## 2. Accessible modal presentation

- [x] 2.1 Replace the persistent library-grid inspector and empty inspection placeholder with a repository-inspection dialog shell and explicit close action.
- [x] 2.2 Reuse the existing dialog focus, Tab-trapping, Escape, backdrop, and focus-restoration conventions for the repository dialog.
- [x] 2.3 Render the current repository metadata, local organization editor, GitHub List membership controls, unstar review control, and operation history inside the dialog without changing their action handlers or mutation semantics.
- [x] 2.4 Ensure repository inspection cooperates with nested unstar and List-membership confirmations, including their existing disabled-dismissal behavior while queueing.

## 3. Layout and responsive styling

- [x] 3.1 Convert the library results area to a single full-width result panel when no repository modal is open.
- [x] 3.2 Add bounded, scrollable repository-dialog styles with a visible close control and existing dialog-layer stacking conventions.
- [x] 3.3 Remove obsolete sticky inspector and inspection-placeholder layout rules while retaining shared detail-section styling.
- [x] 3.4 Verify the modal remains usable at the project's mobile breakpoint and does not hide long local or GitHub-action content.

## 4. Verification

- [x] 4.1 Add DOM tests that explicit repository activation opens an accessible modal with the complete former inspector content and no persistent inspector.
- [x] 4.2 Add DOM tests for explicit close, Escape dismissal, focus entry, and focus restoration to the invoking repository row.
- [x] 4.3 Add DOM tests that annotation edits and nested unstar or List-membership confirmations remain available and retain their existing modal lifecycle.
- [x] 4.4 Update stylesheet coverage for the full-width results layout and responsive repository modal.
- [ ] 4.5 Run `env -u NODE_OPTIONS bun run check` and manually verify the Chromium and Firefox extension dashboards with keyboard-only modal interaction.
