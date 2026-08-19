## 1. Characterize the current safe interface

- [ ] 1.1 Add failing dashboard DOM tests for the Archive.Stars top frame, archive directory/filter rail, retained library navigation, and Operations/Settings reachability.
- [ ] 1.2 Add failing CSS tests for a self-contained monochrome design system, responsive archive layout, touch-safe controls, reduced motion, dark mode, and forced-colors overrides.
- [ ] 1.3 Run the focused dashboard tests and confirm each new assertion fails for the missing visual structure rather than test setup.

## 2. Implement the Archive.Stars shell

- [ ] 2.1 Update `src/dashboard/scripts.ts` to render the real library/navigation controls in an accessible Archive.Stars header and directory/archive workspace; retain existing message dispatch, state, and landmark semantics.
- [ ] 2.2 Recompose existing library header, filters, selection actions, and repository rows using structure/classes appropriate to the reference while retaining labels, keyboard behavior, and live-region boundaries.
- [ ] 2.3 Update loading, empty, Operations, Settings, dialogs, and status presentations only as required to use the shared visual primitives; preserve their exact safety disclosures and action behavior.
- [ ] 2.4 Run focused DOM tests until green.

## 3. Replace the visual system

- [ ] 3.1 Replace the old dashboard tokens and layouts in `src/dashboard/styles.css` with self-contained Archive.Stars tokens and component rules; do not introduce external CSS, fonts, or icon services.
- [ ] 3.2 Add responsive, dark-mode, reduced-motion, and forced-colors rules that preserve contrast, focus, readable wrapping, and 44px narrow-screen controls.
- [ ] 3.3 Run focused CSS tests until green.

## 4. Verify integration

- [ ] 4.1 Run `bun run check:source`, `bun run typecheck`, and `bun test`.
- [ ] 4.2 Run `env -u NODE_OPTIONS bun run build:chrome`, `env -u NODE_OPTIONS bun run build:firefox`, and `env -u NODE_OPTIONS bun run inspect:build`.
- [ ] 4.3 Inspect the resulting diff for unintentional functional, safety, dependency, or generated-artifact changes.
- [ ] 4.4 Perform desktop and 320px packaged-extension inspection if an isolated browser profile is available; otherwise retain this task unchecked and document the unavailable external dependency.
