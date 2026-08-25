# Privacy

Star List Manager processes data only for GitHub authentication, explicit synchronization, and local library features.

## Data Stored Locally

- Read-only GitHub App access and refresh token metadata.
- Optional OAuth App access token and normalized granted scopes for confirmed Starring, native List membership, capability-gated native List create/delete, and independently guarded native List rename writes.
- Authenticated GitHub user ID, login, and avatar URL.
- Public starred repository metadata and star timestamps.
- Available native GitHub List metadata and public repository memberships.
- Local triage state, tags, notes, favorites, review times, revisit dates, settings, and synchronization status.
- Credential-free unstar, native List membership, and native List lifecycle operations with sanitized attempts, verification conflicts, and history; lifecycle records contain the requested name and explicit visibility or confirmed List metadata, stable List ID when known, and sanitized recovery status. Rename requests and results contain only the List ID, validated name, and sanitized status needed for reconciliation.

This data is stored in extension-owned browser storage. It is not sent to an application-operated backend, analytics provider, advertising service, or data broker.

## Network Requests

Requests are limited to `github.com/login` for device authorization and read-token refresh, and `api.github.com` for identity, public stars, GitHub's public-preview native Lists, public repository route validation, exact authenticated-user Starring routes, the static `UpdateUserListsForItem` GraphQL operation, fixed owner-bound `CreateUserList` and `DeleteUserList` lifecycle operations, and the static owner-bound `UpdateUserList` GraphQL operation. Native List membership writes apply only to public starred repositories after explicit preview and confirmation. Lifecycle creates an empty List only after explicit public/private selection; it deletes only a confirmed stable List ID. Lifecycle controls are disabled by default while their separate reviewed release-evidence input remains `null`, and remain unavailable without matching active-account `public_repo user` authorization. That release evidence verifies the OAuth App and build, not a user authorization. The guarded rename transport applies only to an existing List and is also disabled by default unless its separate disposable proof succeeds and a manual build gate is applied; membership or lifecycle proof cannot enable it. No repository-content, collaborator, hook, deployment, arbitrary GraphQL or URL, existing-List visibility update, description edit, or unrelated OAuth operation is implemented.

The membership mutation receives a repository node ID and the complete desired List ID set, replacing all memberships for that item. The extension uses repeated complete but non-atomic observations before writes and for independent read-back; it cannot provide transactional isolation from concurrent GitHub edits. Stale confirmations pause without writing, and read-back mismatches retain desired-versus-observed conflict details and reconcile the local membership mirror to the observed GitHub state. Lifecycle deletion refreshes target metadata before dispatch, requires renewed confirmation if name, visibility, or reported count changed, and uses stronger confirmation for a populated List. A response-lost or otherwise ambiguous lifecycle outcome is never automatically replayed. A lifecycle deletion removes the List and its memberships but leaves repositories starred and retains repository records, local tags, notes, favorites, triage state, revisit dates, and review history.

## Credentials

Credentials are never rendered in the dashboard, written to logs, included in exports, or exposed to website contexts. New optional OAuth authorization requests GitHub's broad `public_repo` and `user` scopes and is stored separately from the read-only GitHub App token after validation against the same stable GitHub user ID. `public_repo` grants public-repository write authority; `user` grants read/write profile authority, including email and follow subscopes. The extension does not implement profile, email, or follow requests and limits this credential to exact Starring routes, the static List membership operation, fixed owner-bound lifecycle create/delete operations, and the static owner-bound rename operation described above; it exposes no arbitrary GraphQL or URL surface. A previously stored account-matched `public_repo`-only token may continue serving only Starring requests; native List writes require `user`. Browser-profile storage is not an operating-system keychain; users should protect their browser profile and revoke the GitHub App and OAuth App authorizations if the profile is compromised. Never include tokens in reports or screenshots.

## Export and Import

JSON exports contain one active GitHub account namespace and exclude credentials and authorization headers. Imports are fully validated, must match the active GitHub user ID, and merge non-destructively after a deterministic preview.

Mutation records contain the relevant repository or List identity, status, timestamps, retry eligibility, verification result, and sanitized error metadata. They exclude access tokens, refresh tokens, device codes, authorization headers, and raw GitHub responses.

## Retention and Deletion

Disconnect write access removes only the optional OAuth credential. Disconnect GitHub removes both active credentials and retains annotations. Delete all local data is a separate confirmed action that removes all extension-owned credentials and user data and returns the extension to first run. Removing the extension through the browser also removes its extension storage according to browser behavior.

## Contact

Report privacy or security issues through the project's GitHub issue tracker without including tokens, device codes, or private account data.
