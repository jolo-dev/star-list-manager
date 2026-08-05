# Privacy

Star List Manager processes data only for GitHub authentication, explicit synchronization, and local library features.

## Data Stored Locally

- Read-only GitHub App access and refresh token metadata.
- Optional OAuth App access token and normalized granted scopes for confirmed Starring writes.
- Authenticated GitHub user ID, login, and avatar URL.
- Public starred repository metadata and star timestamps.
- Available native GitHub List metadata and public repository memberships.
- Local triage state, tags, notes, favorites, review times, revisit dates, settings, and synchronization status.
- Credential-free unstar batches, jobs, sanitized attempts, and operation history.

This data is stored in extension-owned browser storage. It is not sent to an application-operated backend, analytics provider, advertising service, or data broker.

## Network Requests

Requests are limited to `github.com/login` for device authorization and read-token refresh, and `api.github.com` for identity, public stars, native Lists, public repository route validation, and exact authenticated-user Starring routes. Unstar requests occur only after explicit confirmation and are followed by complete public-star observations before local success. No repository-content, collaborator, hook, deployment, or unrelated OAuth operation is implemented.

## Credentials

Credentials are not rendered in the dashboard, written to logs, included in exports, or exposed to website contexts. The optional OAuth token is stored separately from the read-only GitHub App token and validated against the same stable GitHub user ID. Browser-profile storage is not an operating-system keychain; users should protect their browser profile and revoke the GitHub App and OAuth App authorizations if the profile is compromised.

## Export and Import

JSON exports contain one active GitHub account namespace and exclude credentials and authorization headers. Imports are fully validated, must match the active GitHub user ID, and merge non-destructively after a deterministic preview.

Mutation records contain repository identity, status, timestamps, retry eligibility, verification result, and sanitized error metadata. They exclude access tokens, refresh tokens, device codes, authorization headers, and raw GitHub responses.

## Retention and Deletion

Disconnect write access removes only the optional OAuth credential. Disconnect GitHub removes both active credentials and retains annotations. Delete all local data is a separate confirmed action that removes all extension-owned credentials and user data and returns the extension to first run. Removing the extension through the browser also removes its extension storage according to browser behavior.

## Contact

Report privacy or security issues through the project's GitHub issue tracker without including tokens, device codes, or private account data.
