# Store Listing

## Short Description

Search, triage, annotate, and revisit public GitHub stars from a local-first dashboard.

## Detailed Description

Star List Manager turns public GitHub stars into a searchable working library. New stars enter Inbox, historical stars enter Backlog, and revisit dates resurface repositories in Due. Local tags, private notes, favorites, and review state stay in the browser profile.

The extension can import native GitHub Lists and public memberships read-only. Native Lists are a GitHub public-preview capability, so local search and organization continue to work when List access is unavailable or partial.

The extension supports explicit single and bulk unstar cleanup. It shows the complete repository list before confirmation, stores every confirmed job before sending a request, executes one at a time, verifies remote absence, and records per-repository history. It does not automatically unstar, provide an unverified Undo/re-star action, or modify GitHub Lists. It has no content scripts, backend, analytics, advertising, or hosted synchronization.

## Permission Justification

- `storage`: required for browser-local credentials, synchronized public metadata, local annotations, settings, and import/export state.
- `alarms`: required to resume eligible persisted unstar work while the browser is open after a background worker is suspended.
- `github.com/login`: required for read-only GitHub App device authorization, secretless refresh-token exchange, and optional OAuth App device authorization.
- `api.github.com`: required to validate identity, read public stars and native Lists, and perform only confirmed authenticated-user Starring requests when optional write access is enabled.

No broad page access, notification permission, private-repository permission, repository-content permission, organization permission, or remote code is requested. Optional OAuth authorization requests `public_repo`, which grants broader public-repository write authority than the extension uses; the implementation restricts that credential to exact Starring routes.

Repositories remain visibly starred until complete GitHub observations verify removal. Successful and externally completed jobs preserve local annotations and history. Queued jobs can be cancelled before execution; authentication and permission failures stop automatic retry, rate limits wait for reset, and unresolved `blocked unknown` outcomes require a refresh and explicit manual retry.

## Data Removal

Disconnect write access to remove only the optional OAuth credential. Disconnect GitHub removes both active credentials while retaining local annotations. Use Delete all local data for complete removal of credentials, synchronized metadata, annotations, settings, sync state, and badge state. Users can also revoke the OAuth App under GitHub Settings, Applications, Authorized OAuth Apps.
