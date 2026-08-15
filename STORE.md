# Store Listing

## Short Description

Search, triage, annotate, and revisit public GitHub stars from a local-first dashboard.

## Detailed Description

Star List Manager turns public GitHub stars into a searchable working library. New stars enter Inbox, historical stars enter Backlog, and revisit dates resurface repositories in Due. Local tags, private notes, favorites, and review state stay in the browser profile.

The extension imports native GitHub Lists and public memberships through GitHub's public-preview GraphQL API. For public starred repositories, capability-gated controls can preview add, explicit remove, and move operations among existing Lists. Each per-repository preview shows current, resulting, added, removed, and unchanged Lists. There are no List create, delete, or visibility functions. A separate guarded rename implementation exists for an existing List, but it is disabled by default until its own disposable proof succeeds and a manual build gate is applied; membership proof does not enable rename.

GitHub replaces a repository's complete List membership set rather than applying a delta, so add, remove, and move submit the complete desired set and preserve unrelated memberships from the final stable pre-write observation. Discovery and independent read-back require repeated complete observations, but these multi-request observations are not atomic and do not isolate the operation from concurrent GitHub edits. Stale previews require refreshed confirmation without writing; read-back mismatches report desired versus observed memberships and require a new preview. Production membership controls are disabled by default unless the public-preview schema, OAuth permission, account ownership, unchanged-set mutation, and read-back are proven with a disposable public fixture. Local annotations are retained.

The extension also supports explicit single and bulk unstar cleanup. It shows the complete repository list before confirmation, stores every confirmed job before sending a request, executes one at a time, verifies remote absence, and records per-repository history. It does not automatically unstar or provide an unverified Undo/re-star action. It has no content scripts, backend, analytics, advertising, or hosted synchronization.

## Permission Justification

- `storage`: required for browser-local credentials, synchronized public metadata, local annotations, settings, and import/export state.
- `alarms`: required to resume eligible persisted unstar work while the browser is open after a background worker is suspended.
- `github.com/login`: required for read-only GitHub App device authorization, secretless refresh-token exchange, and optional OAuth App device authorization.
- `api.github.com`: required to validate identity, read public stars and native Lists, and perform only confirmed authenticated-user Starring requests, the static `UpdateUserListsForItem` operation when the membership gate is enabled, or the static owner-bound `UpdateUserList` operation when its separate rename gate is enabled.

No broad page access, notification permission, private-repository permission, repository-content permission, organization permission, or remote code is requested. Optional OAuth authorization requests `public_repo user`. `public_repo` grants broader public-repository write authority than the extension uses, and `user` grants broader read/write profile authority, including email and follow subscopes. The extension implements no profile, email, or follow requests and restricts the account-matched credential to exact Starring routes, one internally constructed `UpdateUserListsForItem` document accepting only a repository node ID and complete canonical List IDs, and one owner-bound `UpdateUserList` document accepting only an existing List ID and validated name. It exposes no arbitrary GraphQL document or URL. Both native List operations require `user`; a previously stored `public_repo`-only credential remains limited to Starring. Credentials are never shown in the dashboard, logs, or exports.

Repositories remain visibly starred until complete GitHub observations verify removal. Successful and externally completed jobs preserve local annotations and history. Queued jobs can be cancelled before execution; authentication and permission failures stop automatic retry, rate limits wait for reset, and unresolved `blocked unknown` outcomes require a refresh and explicit manual retry.

## Data Removal

Disconnect write access to remove only the optional OAuth credential. Disconnect GitHub removes both active credentials while retaining local annotations. Use Delete all local data for complete removal of credentials, synchronized metadata, annotations, settings, sync state, and badge state. Users can also revoke the OAuth App under GitHub Settings, Applications, Authorized OAuth Apps.
