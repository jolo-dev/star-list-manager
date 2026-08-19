## Why

Star List Manager's current dashboard uses a dense, rounded, warm-parchment admin interface that does not match the requested `Archive.Stars` reference. The reference establishes a sparse archive browser: a precise monochrome system, a sticky top bar, a directory rail, compact filters, and bordered repository rows. The redesign must materially change the experience without changing the extension's local-first data model or its carefully constrained GitHub mutation behavior.

## What Changes

- Replace the dashboard's visual system with the supplied Archive.Stars brutalist reference: white/near-white canvas, black one-pixel boundaries, mono-forward labels and data, square controls, compact uppercase navigation, and intentionally restrained interaction states.
- Restructure the dashboard shell into a sticky global header plus an archive workspace. Library navigation and filtering become a responsive directory rail alongside a full-width repository archive rather than a persistent dark app sidebar.
- Recompose repository rows into scan-friendly archive entries that retain identity, description, language, starred date, annotations, selection, mutation state, and keyboard activation.
- Preserve every existing user workflow: local search, view selection, sort/filter controls, refresh, repository inspection, annotations, membership preview/confirmation, unstar confirmation, Operations, Settings, loading/error states, and all keyboard/focus behavior.
- Keep the dashboard fully responsive, usable with forced colors and reduced motion, and compliant with existing AA contrast and 44px touch-target requirements.

## Non-Goals

- Change GitHub authentication, synchronization, storage, message schemas, mutation queues, mutation confirmation, or remote-write boundaries.
- Introduce Tailwind, CDN assets, remote fonts, or icon libraries; the packaged extension remains self-contained.
- Remove or add user-facing capabilities beyond the design's information architecture.
- Make any destructive action easier to trigger or weaken its current confirmation, focus, or recovery behavior.

## Capabilities

### New Capabilities

- `archive-stars-dashboard-design`: A responsive, accessible Archive.Stars visual and layout system for the extension dashboard.

### Modified Capabilities

- `repository-discovery-ui`: Render existing library discovery interactions inside the Archive.Stars shell while retaining its local-only query and active-view semantics.

## Impact

- Updates `src/dashboard/scripts.ts` structural class names and accessible labels only where needed for the new layout.
- Replaces `src/dashboard/styles.css` design tokens and component layout rules.
- Adds focused DOM/CSS regression coverage alongside adaptations to existing accessibility and visual-token tests.
- No changes to background code, permissions, APIs, persisted schemas, or OAuth scopes.
