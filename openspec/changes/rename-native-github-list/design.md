## Context

The dashboard currently imports native GitHub List metadata into an account-scoped local mirror and uses those names in the left sidebar and the List-filtered page header. Existing remote mutation support is deliberately limited: membership writes use one static, owner-bound `UpdateUserListsForItem` operation after a disposable capability probe, while current specifications explicitly exclude List lifecycle operations.

The approved product behavior is intentionally narrow: an existing native List is renamed inline from its selected detail-page header. The user supplies the name; the extension only validates and persists it. The sidebar and detail page must show the same verified name without requiring a reload.

## Goals / Non-Goals

**Goals:**

- Make rename discoverable at the List detail header and fast to complete inline.
- Reject blank and duplicate names before dispatching any remote mutation.
- Bind every remote request to the active stable GitHub account and the existing List node ID.
- Treat GitHub’s verified catalog read-back as authoritative before updating local storage.
- Keep read-only import and all existing membership behavior available if rename capability is absent.

**Non-Goals:**

- Create, delete, reorder, change visibility of, or bulk-rename Lists.
- Infer names from repositories, rewrite user input into a new name, or provide name suggestions.
- Change List memberships, local tags, notes, triage state, favorites, review history, or repository data.
- Expose a reusable arbitrary GraphQL/OAuth request API.

## Decisions

### Inline editor at the List header

When `activeView.kind === 'list'`, the List detail header renders the synchronized name and an Edit button beside it. Selecting Edit enters edit mode in place: the name is replaced by a focused text input and Save/Cancel controls. Escape and Cancel restore the unchanged displayed name and clear local validation state. Save is disabled while the normalized candidate is invalid or an equivalent request is active.

This keeps the interaction at the object being changed, avoids a modal for a one-field edit, and matches the extension’s existing button, inline-error, focus, and pending-state styling. The sidebar remains a navigation surface, not an editor.

Alternative considered: click-to-edit the title. It is compact but has poorer discoverability and creates accidental editing risk. A modal is more explicit but adds unnecessary navigation and focus overhead.

### Canonical local validation

The candidate name is trimmed before validation and before persistence. It must be non-empty. Duplicate detection compares the candidate against every *other* current List name using Unicode normalization (`NFKC`) plus locale-insensitive case folding; the current List ID is excluded, so saving an unchanged spelling is permitted.

The UI exposes the validation error beside the input using an accessible live/alert region. Invalid input produces no runtime message, storage write, or GitHub request. GitHub remains the ultimate authority for remote constraints; a server rejection keeps the existing name and displays a sanitized inline error.

The extension does not propose or alter user-provided names beyond trimming surrounding whitespace. The user remains responsible for choosing a meaningful name.

### Dedicated owner-bound rename boundary

Rename is an optional remote mutation. The OAuth credential continues to be separate from read-only synchronization and must have the active account’s stable GitHub user ID plus the scopes needed by the verified native List rename operation. The implementation adds only one internally constructed static rename mutation/variables shape for an existing List node ID and validated name. Callers cannot supply a URL, document, operation name, arbitrary variables, account ID, or other lifecycle operation.

Before exposing the Edit control as enabled, a development capability probe against an explicitly approved disposable List must prove schema availability, account ownership, required scope, a rename mutation, and independent catalog read-back, recording sanitized evidence only. A failed or absent proof leaves imported Lists read-only and preserves existing membership controls according to their separate readiness rules.

### Read-back, reconciliation, and concurrent edits

On Save, the background handler validates the account, List ID, and name again; confirms the List remains in the current authoritative catalog; sends the static rename request; then performs a fresh complete catalog read-back. It updates the local record only if read-back identifies the same List ID with the requested normalized name. The dashboard refreshes from that updated app state, so both sidebar and header change in the same render cycle and persistence is verified.

If the List was deleted, the active account changed, capability/scope is unavailable, the response is ambiguous, or read-back does not contain the requested name, local state is not optimistically renamed. The UI reports the sanitized result and refreshes to the authoritative catalog when one is available. A user may retry only by starting a new inline Save; automatic retries are not allowed because the final remote name could be ambiguous.

A concurrent GitHub rename after the preflight but before or during read-back can win. The application does not claim transactional isolation or overwrite an observed conflicting name locally. It shows the observed catalog name and asks the user to review and explicitly save again if desired.

### Accessibility and state transitions

The Edit button has an accessible label containing the current List name. Entering edit mode places focus in the input; Cancel/Escape restores focus to Edit; successful or failed Save announces a concise live result. Navigation away, refresh, account change, or loss of List availability exits edit mode without retaining stale text as a saved change. While Save is pending, the input and save/cancel controls communicate the busy state and no second rename is dispatched.

## Risks / Trade-offs

- [GitHub may not expose or may later remove the rename mutation] -> capability-gate it and retain read-only List import rather than using scraping or undocumented endpoints.
- [OAuth scopes are broader than this feature] -> use optional separate credential storage, explicit scope disclosure, static allowlisted transport, and no arbitrary caller input.
- [Catalog changes can race the mutation] -> preflight, fresh catalog read-back, authoritative local reconciliation, no automatic retry, and clear conflict feedback.
- [Case/Unicode comparisons differ from GitHub’s display rules] -> block local equivalent duplicates conservatively while surfacing any GitHub rejection without changing local data.
- [A temporary rename could leave stale UI] -> change the local mirror only after independent read-back and render all name locations from that mirror.

## Migration Plan

1. Add pure canonical-name normalization and duplicate-validation tests.
2. Extend the static OAuth transport and disposable capability probe for the exact rename operation, without widening its generic request surface.
3. Add account-bound request decoding, background orchestration, and catalog read-back/reconciliation with fake transports.
4. Add inline header editing, validation, busy/error/success states, and sidebar/header shared-state rendering.
5. Test account changes, deleted Lists, stale/concurrent remote names, ambiguous responses, rejected names, reload persistence, keyboard behavior, and capability-disabled fallback.
6. Run source checks, typecheck, tests, Chromium/Firefox builds, and isolated-profile manual verification.
7. Roll back by disabling the rename capability flag/control; keep native List import and the authoritative synchronized catalog intact.
