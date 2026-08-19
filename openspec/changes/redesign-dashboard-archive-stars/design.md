## Context

The dashboard is a full-page VanJS extension interface. `src/dashboard/scripts.ts` owns the semantic DOM, navigation, query controls, result rows, dialogs, and state pages. `src/dashboard/styles.css` currently provides a warm parchment/dark-sidebar system. The approved input in `redesign.md` is an HTML mockup of an Archive.Stars brutalist archive browser. It supplies visual direction, not a component framework or replacement interaction model.

The active branch contains a separate native List lifecycle proposal. This redesign is isolated on `feature/archive-stars-brutalist-redesign` and must not implement, expose, or depend on that proposal.

## Goals

- Make the dashboard unmistakably match the Archive.Stars reference rather than recoloring the old admin shell.
- Preserve all existing, tested product workflows and safety boundaries.
- Maintain keyboard navigation, focus restoration, targeted live regions, light/dark/forced-colors support, reduced motion, and narrow-screen usability.
- Keep the extension self-contained and dependency-free beyond its existing package set.

## Decisions

### Use an Archive.Stars application frame

The primary library shell will use a sticky, bordered top navigation with a compact star mark and Archive.Stars wordmark. It will retain real dashboard navigation/actions rather than reference-only links. Below it, a maximum-width archive workspace will pair a directory/filter rail with the repository results area. Operations and Settings remain reachable from the top-level interface; no existing `LibraryView` becomes orphaned.

Alternative considered: retain the dark sidebar and only change colors. Rejected because it cannot produce the reference's visual hierarchy or scanning behavior.

### Preserve semantic controls and behavior

Existing buttons, labels, `<details>`, list semantics, dialogs, `aria-current`, status regions, and message dispatch paths remain the source of truth. Structural changes will add semantic grouping and class names, not recreate controls as decorative non-functional markup. The reference's sample data, fake pagination, and non-functional tabs are not copied.

### Express the reference with packaged CSS

The implementation will use a compact black/white token set, `Geist Mono` for metadata/labels, and existing local/system sans fallbacks for prose. It will not load Tailwind, Google Fonts, Iconify, or any network resource. Bordered rows, all-caps labels, square buttons, underlines, and brief color-inversion hover/focus treatments provide the brutalist feel with accessible contrast.

### Reflow without hiding functionality

At wide sizes, the directory/filter rail stays visible beside the archive. At narrow widths it becomes a normal stacked section below the header, controls wrap to touch-safe rows, and repository facts wrap rather than clip. Dialogs and existing 320px rules remain functional. Reduced motion removes decorative transitions; forced-colors uses system colors that win the normal component cascade.

### Keep dark theme intentionally supported

The reference is light-first. Dark mode continues via explicit semantic token overrides, yielding ink/surface contrast and visible boundaries instead of an automatic inversion. Forced-colors remains a separate, system-color mode.

## Safety Boundaries

- Styling and markup changes SHALL NOT change runtime message payloads, request timing, stored data, or GitHub credentials.
- Existing unstar and native-List controls SHALL retain their authorization gates, preview/confirmation flows, disabled states, and focus restoration.
- Archive navigation SHALL continue to reflect the current local snapshot and SHALL NOT imply remote completeness.
- A visual redesign SHALL NOT mask loading, stale, partial, error, or write-readiness disclosures.

## Testing Strategy

1. Add failing DOM assertions for the Archive.Stars shell, reachable Operations/Settings, directory rail, result-list semantics, and retained action controls before changing the DOM.
2. Add failing CSS assertions for self-contained assets, reference-aligned semantic tokens, bounded layout/reflow, touch targets, reduced motion, dark mode, and forced colors before replacing styles.
3. Implement minimally until focused tests pass, then run the full suite, source guard, typecheck, Chrome/Firefox builds, and build inspection.
4. Manually inspect the packaged Chrome dashboard at desktop and 320px widths when a browser extension profile is available; keep that external check unclaimed if unavailable.

## Risks / Trade-offs

- A near-monochrome palette can reduce status discoverability. Mitigation: retain semantic status treatments with AA contrast and explicit text.
- Moving navigation into a new frame can regress reachability. Mitigation: DOM tests assert every fixed destination remains available.
- A large CSS rewrite can invalidate source-sensitive tests. Mitigation: evolve test contracts around user-visible/accessibility behavior rather than the previous palette.
