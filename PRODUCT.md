# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Developers who have accumulated public GitHub stars and need a private, dependable way to search, organize, triage, and revisit them from their browser.

## Product Purpose

Star List Manager is a local-first browser extension for finding and revisiting public GitHub stars. It imports the user’s starred repositories and native GitHub Lists, then lets the user search, filter, annotate, tag, favorite, triage, and schedule revisits without requiring a hosted service. Success means a user can recover useful repositories quickly while understanding which information is local and which actions affect GitHub.

## Positioning

The product combines a browser-local research library with explicit, safety-gated GitHub actions: local organization remains useful without write access, while unstar and native List mutations require separate authorization, preview or confirmation, durable queuing, and remote verification.

## Operating Context

The product runs as an extension-owned full-page dashboard in Chromium and Firefox. Users browse a synchronized local snapshot, switch among unlisted stars and native GitHub Lists, search and filter repositories, inspect repository details, maintain local annotations, and review queued or completed operations. GitHub connectivity may be missing, stale, rate-limited, or partially capable, so the interface must distinguish local data from remote state and preserve useful offline access.

## Capabilities and Constraints

- Public starred repositories only; private repository metadata is not persisted.
- Local notes, tags, favorites, triage state, revisit dates, review history, credentials, settings, and synchronized public metadata remain in extension-owned browser storage.
- Native GitHub Lists are imported through GitHub’s public-preview GraphQL capability.
- Existing Lists support previewed add, remove, and move membership actions when separately authorized and capability-gated.
- A guarded native List rename path exists but is disabled by default and requires separate evidence and an isolated release gate.
- Single and bulk unstar actions use explicit confirmation, a durable sequential queue, remote verification, and operation history. There is no automatic cleanup, re-star, or Undo.
- Loading, signed-out, stale, partial, error, write-readiness, and mutation states are product-critical and must remain visible.
- The packaged extension must remain self-contained: no runtime design dependencies, remote fonts, analytics, advertising, backend synchronization, or content scripts.
- Existing runtime messages, storage schemas, authorization boundaries, and mutation safety behavior must not be changed by visual redesign work.

## Brand Commitments

- The product name remains **Star List Manager**.
- “Stellar” is a visual reference only and must not replace the product name in the interface, extension metadata, or settings.
- Product voice is direct, precise, and explicit about local versus remote effects, authorization scope, confirmation, and recovery.

## Evidence on Hand

- Real product behavior and constraints are documented in `README.md`.
- The live dashboard implementation is in `src/dashboard/scripts.ts`, `src/dashboard/styles.css`, and `src/dashboard/index.html`.
- Dashboard behavior, accessibility contracts, and visual-system requirements are covered by `tests/dashboard/dom.test.ts` and `tests/dashboard/styles.test.ts`.
- No testimonials, customer logos, benchmarks, usage analytics, or commercial claims are available and none should be invented.

## Product Principles

1. Local utility does not depend on granting GitHub write access.
2. Remote mutations are deliberate, previewable or confirmable, recoverable, and independently verified.
3. Repository discovery prioritizes scanability, retrieval, and trustworthy state over decorative novelty.
4. Local and remote state must never be visually or verbally conflated.
5. The extension remains private, self-contained, and useful without a hosted backend.

## Accessibility & Inclusion

Preserve semantic landmarks and controls, keyboard navigation and focus restoration, targeted status semantics, visible focus, AA contrast, reduced-motion behavior, forced-colors support, responsive use from 320px upward, and 44px touch targets where required on narrow screens.
