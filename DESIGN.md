---
name: Star List Manager
description: A calm, local-first working library for real GitHub stars.
colors:
  cool-canvas: "#f8fafc"
  paper-white: "#ffffff"
  soft-slate-surface: "#f1f5f9"
  selected-slate-surface: "#e2e8f0"
  ink: "#0f172a"
  noop-ink: "#334155"
  secondary-slate: "#475569"
  control-slate: "#64748b"
  subtle-slate: "#cbd5e1"
  selection-blue: "#2563eb"
  success-surface: "#ecfdf5"
  success-ink: "#166534"
  success-border: "#15803d"
  warning-surface: "#fff7ed"
  warning-ink: "#9a3412"
  warning-border: "#c2410c"
  danger-surface: "#fef2f2"
  danger-ink: "#991b1b"
  danger-action: "#b91c1c"
  night-canvas: "#0b1120"
  night-surface: "#111827"
  night-raised: "#1e293b"
  night-ink: "#f8fafc"
  night-secondary: "#cbd5e1"
  night-border: "#475569"
  night-control: "#94a3b8"
  night-selection-blue: "#3b82f6"
  night-success-surface: "#052e16"
  night-success-ink: "#bbf7d0"
  night-success-border: "#4ade80"
  night-warning-surface: "#431407"
  night-warning-ink: "#fef08a"
  night-warning-border: "#fb923c"
  night-danger-surface: "#450a0a"
  night-danger-ink: "#fecaca"
  night-danger-border: "#f87171"
  night-danger-action: "#dc2626"
typography:
  display:
    fontFamily: '"Geist Sans", ui-sans-serif, sans-serif'
    fontSize: "clamp(2rem, 3vw, 2.75rem)"
    fontWeight: 720
    lineHeight: 1.05
    letterSpacing: "-0.04em"
  headline:
    fontFamily: '"Geist Sans", ui-sans-serif, sans-serif'
    fontSize: "1.75rem"
    fontWeight: 700
    lineHeight: 1.15
  title:
    fontFamily: '"Geist Sans", ui-sans-serif, sans-serif'
    fontSize: "1.25rem"
    fontWeight: 680
    lineHeight: 1.2
    letterSpacing: "-0.025em"
  body:
    fontFamily: '"Geist Sans", ui-sans-serif, sans-serif'
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.6
  label:
    fontFamily: '"Geist Sans", ui-sans-serif, sans-serif'
    fontSize: "0.75rem"
    fontWeight: 600
    lineHeight: 1.35
  metadata:
    fontFamily: '"Geist Mono", monospace'
    fontSize: "0.75rem"
    fontWeight: 400
    lineHeight: 1.5
rounded:
  control: "8px"
  panel: "12px"
  card: "16px"
  pill: "999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
  2xl: "32px"
  3xl: "40px"
components:
  app-header:
    backgroundColor: "{colors.paper-white}"
    textColor: "{colors.ink}"
    height: "64px"
    padding: "10px 24px"
  navigation-rail:
    backgroundColor: "{colors.cool-canvas}"
    textColor: "{colors.ink}"
    width: "256px"
    padding: "8px 16px 24px 0"
  navigation-active:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.paper-white}"
    rounded: "{rounded.control}"
    padding: "7px 9px"
  button-primary:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.paper-white}"
    rounded: "{rounded.control}"
    padding: "8px 13px"
    height: "40px"
  button-secondary:
    backgroundColor: "{colors.paper-white}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "8px 13px"
    height: "40px"
  button-danger:
    backgroundColor: "{colors.paper-white}"
    textColor: "{colors.danger-action}"
    rounded: "{rounded.control}"
    padding: "8px 13px"
    height: "40px"
  input:
    backgroundColor: "{colors.paper-white}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "8px 11px"
    height: "40px"
  repository-card:
    backgroundColor: "{colors.paper-white}"
    textColor: "{colors.ink}"
    rounded: "{rounded.card}"
    padding: "22px"
  dialog:
    backgroundColor: "{colors.paper-white}"
    textColor: "{colors.ink}"
    rounded: "{rounded.card}"
    padding: "34px"
    width: "620px"
  list-management-panel:
    backgroundColor: "{colors.paper-white}"
    textColor: "{colors.ink}"
    rounded: "{rounded.panel}"
    padding: "20px"
    width: "900px"
  status-success:
    backgroundColor: "{colors.success-surface}"
    textColor: "{colors.success-ink}"
    rounded: "{rounded.pill}"
    padding: "3px 8px"
  status-warning:
    backgroundColor: "{colors.warning-surface}"
    textColor: "{colors.warning-ink}"
    rounded: "{rounded.control}"
    padding: "10px 12px"
  status-danger:
    backgroundColor: "{colors.danger-surface}"
    textColor: "{colors.danger-ink}"
    rounded: "{rounded.control}"
    padding: "10px 12px"
---

# Design System: Star List Manager

## Overview

**Creative North Star: "The Calm Working Library"**

The Calm Working Library treats a large star collection as a private working collection, not as a developer-tool table or a decorative gallery. Cool white and slate surfaces, locally bundled Geist, softened rectangles, quiet borders, and dark ink actions make real repositories easy to identify, retrieve, and revisit.

Quietness is structural rather than vague: the active collection, Library-scoped search, local annotations, synchronized GitHub state, and write readiness remain explicit. This is the shipped replacement for Archive.Stars brutalism; “Stellar” remains a visual reference and never becomes product identity.

**Key Characteristics:**
- Calm light-first slate material with an explicit dark counterpart.
- A library-first shell with one global account indicator and three real destinations.
- Comfortable repository cards by default, with a dense List alternative.
- Sans prose and titles paired with mono metadata for deliberate scanability.
- Restrained elevation, softened rectangles, and pills reserved for compact states.
- Visible, labeled local-versus-remote and write-readiness semantics.
- A dedicated GitHub List management surface that keeps remote lifecycle effects explicit and verified.
- Self-contained assets and resilient behavior from 320px upward.

## Colors

The palette is a cool slate system with one dark ink action voice; green, orange, red, and blue appear only where status, warning, danger, selection, or focus requires them.

### Primary

- **Dark Library Ink:** The primary action, active navigation, brand mark, and strongest light-scheme text. Its near-black character gives the interface authority without introducing a decorative brand accent.
- **Paper White:** Primary cards, controls, dialogs, and header fallback in the light scheme.

### Neutral

- **Cool Canvas:** The light application ground, chosen to keep white working surfaces legible without looking elevated everywhere.
- **Soft Slate Surface:** Quiet hover, grouped-control, disabled, and supporting-panel material.
- **Selected Slate Surface:** Selection bars and selected/no-op records that require more separation than a hover.
- **No-op Ink:** Selection-bar guidance and no-op copy that needs more emphasis than secondary metadata without competing with primary ink.
- **Secondary Slate:** Supporting prose and metadata where hierarchy must remain AA-legible.
- **Control Slate:** Input and secondary-control strokes.
- **Subtle Slate:** Dividers and low-emphasis surface boundaries.
- **Night Canvas, Night Surface, and Night Raised:** Explicit dark-scheme material roles. The same semantic hierarchy is remapped rather than inverted mechanically.

### Semantic status colors

- **Selection Blue:** The visible focus ring and selected-record outline. It communicates keyboard focus or selection, never mutation success.
- **Success Green:** Verified and succeeded outcomes, including reviewed triage where the text label remains present.
- **Warning Orange:** Stale, partial, queued, retrying, concurrency, and authorization-dependent states.
- **Danger Red:** Failed, blocked-unknown, destructive, inline error, and no-undo states.

**The Ink Is Action Rule.** Dark ink is the only general action color. Do not introduce a second decorative brand accent or use semantic colors for ordinary calls to action.

**The Status Is Labeled Rule.** Semantic color always accompanies explicit text and, where applicable, a border, status role, disabled state, or confirmation step; color never carries remote truth by itself.

## Typography

**Display Font:** Geist Sans (with `ui-sans-serif` and `sans-serif` fallbacks)

**Body Font:** Geist Sans (with `ui-sans-serif` and `sans-serif` fallbacks)

**Label/Mono Font:** Geist Mono (with `monospace` fallback)

**Character:** Geist Sans keeps repository names, instructions, and safety copy calm and contemporary. Geist Mono is a scanning instrument for counts, owners, dates, language, compact statuses, and operation data—not the voice for prose titles.

Both variable fonts are packaged locally from the installed `geist` dependency. Runtime font URLs, CDN fallbacks, and remote design dependencies are prohibited by the extension boundary.

### Hierarchy

- **Display:** Tight, heavy library and destination headings. Keep line length short and allow the mobile size to resolve to a compact single-column heading.
- **Headline:** State-panel and dialog headings that need clear hierarchy without competing with the current destination.
- **Title:** Repository-card titles and important subsection names. Valid long GitHub identifiers must wrap rather than clip.
- **Body:** Descriptions, explanations, status guidance, and safety copy. Extended prose uses a maximum readable measure of 70ch.
- **Label:** Compact control labels and filter headings. Labels use normal case; do not add generic all-caps treatment.
- **Metadata:** Owners, result counts, languages, dates, numeric summaries, and compact operation state. Use tabular numerals where counts must align.

**The Sans Carries Meaning Rule.** Prose, titles, buttons, labels, warnings, and confirmation copy use Geist Sans so operational meaning never reads like code.

**The Mono Earns Its Place Rule.** Use Geist Mono only when fixed-width scanning improves comprehension; do not make whole cards, dialogs, or navigation mono-forward.

## Layout

The desktop shell begins with a sticky 64px header containing the brand at the start, Library/Operations/Settings in the center, and the connected-account initial at the end. Beneath it, a centered application frame is capped at 1440px and uses a 256px sticky “My Lists” rail plus a flexible workspace separated by a quiet divider and a 40px gap.

The Library first viewport leads with the active population title and real result count, then the Library-scoped search, Refresh, View options, and Filters. At widths above 1180px the toolbar resolves into a compact grid; at and below that point it wraps beneath the heading. Cards form three columns on wide screens, two columns at 1024px and below, and one column at 700px and below. The alternate List mode uses the same data and interaction contracts at a denser rhythm.

GitHub List management is a retained Library workspace capped at 900px. Its header, readiness notice, create section, synchronized catalog, and latest operation status follow one 20px vertical rhythm. Catalog rows remain divider-led rather than card-stacked, and create/delete confirmations use the existing modal layer.

At 700px and below the header wraps into brand/account plus a full-width three-column navigation row. The rail becomes a normal-flow, full-width List selector with a bottom divider; all Lists remain available. The workspace becomes one column with 16px side padding, filters and membership controls stack, dialogs become bottom-aligned full-width sheets, and required controls grow to at least 44px. The implementation is designed to avoid horizontal clipping from 320px upward, including long repository and List names.

Spacing follows a compact 4/8/12/16 step for component interiors and a 24/32/40 step for page rhythm. Preserve the single `<main>` landmark and keep global account identity in the header while search remains local to Library.

## Elevation & Depth

The system is flat by default and uses tonal separation plus thin slate borders for most hierarchy. One ambient card shadow (`0 4px 20px rgb(15 23 42 / 8%)`) is shared by repository cards, popover controls, and dialogs; the dark scheme remaps that same role to a stronger black alpha. Cards may lift by 2px on hover and primary actions by 1px, but state color, selection outline, and focus rings always outrank movement.

The sticky header uses an opaque surface fallback followed by an 88% translucent scheme surface with 14px backdrop blur. This is the only glass-like material. Dialog backdrops are opaque slate alphas, not decorative blur layers.

### Shadow Vocabulary

- **Ambient card:** `0 4px 20px rgb(15 23 42 / 8%)` in light mode and `0 4px 20px rgb(0 0 0 / 24%)` in dark mode. Use only for cards, dialogs, and floating option panels that genuinely sit above the canvas.

**The Flat-by-Default Rule.** Borders and tonal surfaces establish ordinary hierarchy; do not add new shadow tiers, nested glass panels, gradients, or decorative depth.

**The State Before Motion Rule.** Hover lift is optional reinforcement. Focus, selected, disabled, queued, failed, and verified states must remain fully understandable when all motion is removed.

## Shapes

The form language is softened but not bubbly. Controls and banners use the gently curved control radius, grouped panels and list rows use the medium panel radius, and repository cards and dialogs use the larger card radius. Borders are thin and cool; selected cards use an inset-like 3px outline so selection stays visible without changing geometry.

Pills are reserved for counts, tags, scopes, compact status labels, triage state, and “No-op” markers. The account indicator and decorative List dots may be circular. Do not turn buttons, search fields, cards, rails, or entire toolbars into pills, and avoid stacking rounded containers when a divider or whitespace already expresses the hierarchy.

## Components

Components are restrained and explicit: their shape and color support the user’s task, while labels and availability tell the truth about local and GitHub effects.

### Buttons

- **Shape:** Gently curved controls use the control radius with compact desktop padding and a 40px minimum height; required narrow-screen actions become at least 44px tall.
- **Primary:** Dark ink fill with white text. Use for Refresh, connection, export, and additive review or confirmation paths that are actually available.
- **Secondary:** White/surface fill, ink text, and a visible control border. Use for View options, cancel, close, clearing selection, and non-destructive alternatives.
- **Danger:** Surface fill, red text, and red border at rest; hover may fill red with white text. Labels lead with “Review” before destructive confirmation where the flow is not yet final.
- **Hover / Focus / Disabled:** Hover may shift surface or lift slightly. Every focusable control uses a visible 3px blue focus outline with 2px offset. Disabled controls retain readable text and border contrast and use `not-allowed`; they never mimic readiness.

### Chips

- **Style:** Compact mono labels with a pill silhouette and visible border. Counts and scopes stay neutral or ink-filled; semantic pills use the matching text, surface, and border family.
- **State:** Selected modes may use the dark ink fill. “No-op,” queued/retrying, failed/blocked, and verified states always retain text labels. Decorative List dots are hidden from assistive technology and never replace names or counts.

### Cards / Containers

- **Corner Style:** Repository cards and dialogs use the largest radius; settings, state panels, selection bars, and dense rows use the panel radius.
- **Background:** Working surfaces sit on the cool canvas and use paper white in light mode or the explicit night surface in dark mode.
- **Shadow Strategy:** Repository cards use the single ambient shadow; ordinary settings and state containers remain border-defined.
- **Border:** A one-pixel subtle slate boundary is the default. Selection adds a blue 3px outline; warning, success, and danger containers use their semantic border.
- **Internal Padding:** Cards use a comfortable 22px desktop interior and 20px on narrow screens. Long identifiers wrap, descriptions clamp intentionally in result cards, and complete details remain available in the inspector.

### Inputs / Fields

- **Style:** White/scheme surface, ink text, visible control-slate stroke, and the control radius. Library search remains labeled “Search” and scoped to stars, notes, and Lists.
- **Focus:** The global 3px focus outline supplements—not replaces—the field border. Hover darkens the stroke.
- **Error / Disabled:** Errors use labeled red treatment. Disabled fields use the disabled slate surface and readable muted text. Narrow-screen text and date fields use a 16px font size to avoid browser zoom surprises.

### Navigation

The brand mark is a compact ink square containing the locally rendered star, followed by the unchanged **Star List Manager** wordmark. Global navigation exposes only Library, Operations, and Settings. The connected-account initial is a labeled global indicator, not a profile menu or remote avatar.

“My Lists” contains Unlist, synchronized native GitHub Lists with live counts, and the real **Manage GitHub Lists** destination. The current collection uses dark ink fill, white text, `aria-current="page"`, and a visible count border. Management stays reachable when the synchronized catalog is empty or lifecycle writes are unavailable, so read-only state never removes wayfinding. Inactive deterministic dots are decorative. There is no Explore, random-repository, or fabricated route.

### Repository records

Cards are the default and the memorable expression of the system: owner/name, description, language, star date, local favorite, remote mutation status, and triage state remain scannable in a three/two/one-column grid. The whole record opens the existing inspection dialog; a separate labeled checkbox controls selection. Dense List mode remains available through the real View options control.

Arrow Up/Down and Home/End move focus through visible results. Cards and rows preserve selection state, opening behavior, and focus restoration. Progressive rendering remains local; do not add pagination copy or imply a network fetch.

### Selection and remote-write controls

Selection is visibly reversible and locally inert: the selection bar states that selecting changes no stars, notes, tags, favorites, or triage state. Unstar and native List membership actions remain disabled until separate account-matched write readiness and capability checks pass, and active repository jobs block duplicate review.

Native List controls identify themselves as “GitHub account” and distinguish remote Lists and membership from local tags. Membership changes preview complete current/resulting sets, surface no-ops, and require refreshed confirmation when observations change. Lifecycle management requires an explicit public/private choice for creation; deletion names the exact List, states that repositories remain starred but become unlisted, and requires exact-name confirmation for populated Lists. Capability, authorization, sync, pending, verified, stale-confirmation, and ambiguous outcomes remain visible in the management workspace, while conflicting lifecycle, membership, and rename controls stay disabled.

Unstar requires an explicit dialog, states that there is no Undo or re-star control, queues work durably, and changes local starred state only after independent GitHub verification. Failed, retrying, queued, blocked-unknown, stale, partial, and verification-conflict states remain labeled and recoverable; the interface must never report false success.

### Dialogs and state surfaces

Repository inspection, membership preview, unstar confirmation, and GitHub List lifecycle confirmation use modal semantics, focus trapping, Escape handling when cancellation is safe, initial focus on a non-destructive action, and restoration to a valid invoker or fallback. Lifecycle errors remain linked to the affected field or actionable dialog control. On narrow screens these dialogs become full-width bottom sheets without losing content or allowing long List names to force horizontal overflow.

Loading, first-run, signed-out, authorization, empty, error, Operations, and Settings views inherit the same type, color, border, radius, and status vocabulary. Operations names verified outcomes and unknown remote states; Settings discloses broad write scopes and keeps read-only/local utility available without write access.

### Accessibility and resilience

The dashboard retains one main landmark, semantic header and navigation regions, labeled controls, `aria-current`, `aria-pressed`, targeted status and alert roles, accessible names, keyboard result movement, and dialog focus lifecycle. All ordinary focus targets share the 3px visible ring; selection checkboxes use focus-within so the separate card action never hides selection focus.

Dark mode explicitly remaps canvas, surfaces, ink, secondary text, borders, action contrast, semantic states, backdrop, and the one shadow role. Forced-colors mode maps active navigation and selected records to system Highlight, controls to ButtonFace/ButtonText, links to LinkText, disabled controls to GrayText, and status banners to Canvas/CanvasText while retaining borders. Reduced-motion mode collapses transitions and animations to effectively immediate feedback, disables repeated animation, and removes transform without changing state meaning.

Maintain AA text and control contrast in both schemes. At narrow widths, preserve at least 44px for the documented interactive set and never allow long names, descriptions, metadata, errors, or dialog content to force horizontal overflow below the 320px minimum.

## Do's and Don'ts

### Do:

- **Do** keep the visible product name **Star List Manager**; treat “Stellar” only as the visual reference that informed this system.
- **Do** render real local repository, List, annotation, sync, and operation state; keep cards as the default and the dense List as a real alternative.
- **Do** keep account identity global and search Library-scoped so the user always knows which collection and account context they are acting in.
- **Do** preserve VanJS, local-first storage, real navigation, dialogs, keyboard result movement, focus trapping/restoration, and existing mutation handlers when extending the visual system.
- **Do** preserve AA contrast, visible 3px focus indicators, explicit dark mode, forced-colors behavior, reduced-motion suppression, 320px layouts, and 44px narrow-screen controls.
- **Do** use Geist Sans for prose and titles, Geist Mono for compact metadata, and package both locally with no runtime design request.
- **Do** keep selection locally inert and reversible; gate remote or destructive review and confirmation actions on account-matched write readiness and capability checks, preview complete remote effects, require confirmation, and display queued and verified outcomes without collapsing unknown states into success.
- **Do** keep GitHub List lifecycle management reachable in read-only and empty-catalog states; name remote effects, visibility, reported counts, partial imports, and verification status explicitly.
- **Do** regenerate visual evidence from the deterministic synthetic review generator; keep its static fixture non-shipping, no-network, and clearly labeled as synthetic.

### Don't:

- **Don't** add Explore, random-repository, profile-menu, toast, fake pagination, quick-create shortcuts, or any other capability that bypasses the implemented GitHub List preview and confirmation workflow.
- **Don't** revive the category-default developer-tool table or Archive.Stars brutalism through hard rectangles, mono-forward prose, dense chrome, or ornamental separators.
- **Don't** use semantic green, orange, red, or blue as decoration, or communicate status with a dot, border, or color alone.
- **Don't** fake mutation capability, enable destructive controls early, imply Undo or re-star, or declare GitHub success before independent remote verification.
- **Don't** introduce remote fonts, icon services, CDN scripts, analytics, gradients, excessive pills, additional shadow tiers, or nested glass surfaces.
- **Don't** change runtime messages, storage schemas, authorization boundaries, queue semantics, or GitHub request behavior as part of visual maintenance.
