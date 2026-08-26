# Store Listing

## Short Description

Search, triage, annotate, and revisit public GitHub stars from a local-first dashboard.

## Detailed Description

Star List Manager turns public GitHub stars into a searchable working library. New stars enter Inbox, historical stars enter Backlog, and revisit dates resurface repositories in Due. Local tags, private notes, favorites, and review state stay in the browser profile.

The extension imports native GitHub Lists and public memberships through GitHub's public-preview GraphQL API. For public starred repositories, independently capability-gated controls can preview add, explicit remove, and move operations among existing Lists. Current membership requalification failed, so its checked-in reviewed evidence is `null` and membership controls remain read-only until a new disposable probe succeeds. Each per-repository preview shows current, resulting, added, removed, and unchanged Lists. Native List lifecycle is independently implemented but release-disabled by default while its reviewed non-secret release evidence remains `null`. When independently release- and account-gated, users can create an empty List only after explicitly choosing public or private visibility, or delete an empty List with standard confirmation. Deleting a populated List requires stronger, List-specific confirmation showing GitHub's reported item count and any partial-import warning. Deletion removes the List, not repositories: they remain starred but unlisted, and repository records and local annotations remain.

GitHub replaces a repository's complete List membership set rather than applying a delta, so add, remove, and move submit the complete desired set and preserve unrelated memberships from the final stable pre-write observation. Discovery and independent read-back require repeated complete observations, but these multi-request observations are not atomic and do not isolate the operation from concurrent GitHub edits. Stale previews require refreshed confirmation without writing; read-back mismatches report desired versus observed memberships and require a new preview. Lifecycle deletion also refreshes confirmation when List metadata changes, and ambiguous create/delete outcomes are never automatically retried. Production membership and lifecycle controls remain disabled until their separate reviewed release evidence is present; release evidence verifies the build and OAuth App, while every user still needs matching `public_repo user` authorization. A separate guarded rename implementation remains disabled by default; membership or lifecycle proof does not enable it.

The extension also supports explicit single and bulk unstar cleanup. It shows the complete repository list before confirmation, stores every confirmed job before sending a request, executes one at a time, verifies remote absence, and records per-repository history. It does not automatically unstar or provide an unverified Undo/re-star action. It has no content scripts, backend, analytics, advertising, or hosted synchronization.

## Permission Justification

- `storage`: required for browser-local credentials, synchronized public metadata, local annotations, settings, and import/export state.
- `alarms`: required to resume eligible persisted unstar work while the browser is open after a background worker is suspended.
- `github.com/login`: required for read-only GitHub App device authorization, secretless refresh-token exchange, and optional OAuth App device authorization.
- `api.github.com`: required to validate identity, read public stars and native Lists, and perform only confirmed authenticated-user Starring requests; the static `UpdateUserListsForItem` membership operation; fixed owner-bound `CreateUserList` and `DeleteUserList` lifecycle operations; or the static owner-bound `UpdateUserList` rename operation when their separate gates are enabled.

No broad page access, notification permission, private-repository permission, repository-content permission, organization permission, or remote code is requested. Optional OAuth authorization requests `public_repo user`. `public_repo` grants broader public-repository write authority than the extension uses, and `user` grants broader read/write profile authority, including email and follow subscopes. The extension implements no profile, email, or follow requests and restricts the account-matched credential to exact Starring routes, one internally constructed `UpdateUserListsForItem` document accepting only a repository node ID and complete canonical List IDs, fixed owner-bound create/delete documents accepting only a validated name with explicit visibility or a stable List ID, and one owner-bound `UpdateUserList` document accepting only an existing List ID and validated name. It exposes no arbitrary GraphQL document or URL. Native List writes require `user`; a previously stored `public_repo`-only credential remains limited to Starring. Credentials are never shown in the dashboard, logs, or exports.

Repositories remain visibly starred until complete GitHub observations verify removal. Successful and externally completed jobs preserve local annotations and history. Queued jobs can be cancelled before execution; authentication and permission failures stop automatic retry, rate limits wait for reset, and unresolved `blocked unknown` outcomes require a refresh and explicit manual retry.

## Data Removal

Disconnect write access to remove only the optional OAuth credential. Disconnect GitHub removes both active credentials while retaining local annotations. Use Delete all local data for complete removal of credentials, synchronized metadata, annotations, settings, sync state, and badge state. Users can also revoke the OAuth App under GitHub Settings, Applications, Authorized OAuth Apps.
