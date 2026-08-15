## Why

GitHub List names are visible in the dashboard sidebar and a selected List’s detail-page header, but users currently cannot correct or organize those names from Star List Manager. Renaming should be a small, explicit inline action rather than a modal or a separate settings flow.

## What Changes

- Add a native GitHub List rename capability for existing synchronized Lists.
- Show an Edit button beside the selected List detail header; Edit replaces the title with an inline name field and Save/Cancel controls.
- Validate names before any remote request: the trimmed name must be non-empty and must not duplicate another current List name under case-insensitive Unicode-normalized comparison.
- Send the remote rename only after the user explicitly selects Save, then independently read back the List catalog before committing the local mirror.
- Update the sidebar and the active List detail view immediately from the verified renamed local record, so the name survives reloads and later syncs.
- Extend the optional account-bound OAuth write boundary only with an internally constructed, capability-proven native List rename operation; retain the existing exact endpoint/GraphQL allowlist and reject arbitrary caller-provided requests.

## Non-Goals

- Create, delete, reorder, change visibility of, or otherwise manage native GitHub Lists.
- Generate, suggest, translate, sanitize into a different name, or reserve names for the user.
- Rename local tags, repository names, or GitHub List memberships.
- Use page scraping, cookies, undocumented endpoints, or a general-purpose OAuth GraphQL client.
- Bypass the inline validation based on server-side behavior.

## Capabilities

### New Capabilities

- `native-list-lifecycle`: Capability-gated, inline, verified rename of an existing native GitHub List.

### Modified Capabilities

- `oauth-starring-write-auth`: Permit exactly one additional internally constructed, account-bound native List rename mutation after capability proof, while keeping all other OAuth writes disallowed.

## Impact

- Dashboard navigation and List detail-header UI, including accessible inline editing and validation feedback.
- Background request decoding, runtime state, native List storage, and post-mutation catalog reconciliation.
- The existing optional OAuth credential, capability-probe tooling, and narrowly allowlisted GraphQL transport.
- Focused domain, message, storage, background, and dashboard tests; browser-build/manual validation for Chromium and Firefox.
