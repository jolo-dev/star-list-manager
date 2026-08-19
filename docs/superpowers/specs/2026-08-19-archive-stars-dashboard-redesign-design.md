# Archive.Stars Dashboard Redesign

**Date:** 2026-08-19
**Status:** Approved design input / pending OpenSpec review

## Intent

Implement the user-supplied `redesign.md` as the visual direction for Star List Manager: a precise, monochrome Archive.Stars interface with a sticky header, directory rail, compact filter controls, and bordered repository archive rows.

## Architecture

- Keep the VanJS dashboard and its existing local-first data model.
- Rework only dashboard structure and CSS (`src/dashboard/scripts.ts`, `src/dashboard/styles.css`, and dashboard regression tests).
- Preserve local search, views, filters, sorting, refresh, dialogs, mutations, and focused accessibility behavior.
- Use packaged CSS and existing/local system fonts only—no Tailwind CDN, Google Fonts, Iconify, or remote design assets.

## Safety and quality contract

Existing remote-write gates, previews, confirmations, account checks, status disclosures, keyboard behavior, responsive reflow, dark mode, reduced motion, forced colors, and focus restoration remain intact. The visual reference's sample data and fake interactions are not adopted.

## Test contract

The implementation begins with failing DOM and CSS assertions for the Archive.Stars frame, archive layout, retained navigation/actions, reflow, motion, and high-contrast behavior. Completion requires fresh full test, source/type, two-browser build, build-inspection, and diff-review evidence.
