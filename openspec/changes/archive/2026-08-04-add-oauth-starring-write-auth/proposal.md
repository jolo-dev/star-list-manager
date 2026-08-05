## Why

GitHub App user tokens cannot change stars on arbitrary third-party public repositories because write requests also require repository metadata access within the App installation boundary. Safe unstar therefore needs a separate user-authorized credential that works across the authenticated user's public star library.

## What Changes

- Keep the existing GitHub App device-flow credential read-only and use it for identity, synchronization, and native List import.
- Add an optional GitHub OAuth App device-flow authorization requesting the `public_repo` scope for confirmed Starring mutations.
- Clearly disclose that `public_repo` grants broader public-repository write authority than the extension uses.
- Store the OAuth token in a separate account-bound credential record and never expose it to dashboard messages, logs, exports, or website contexts.
- Validate that the OAuth identity exactly matches the active read-only GitHub App identity before enabling write readiness.
- Add owner-bound write requests, explicit revocation/disconnect behavior, and sanitized permission failures.
- Verify star removal and restoration against an explicitly named disposable repository before unblocking safe-unstar work.

## Capabilities

### New Capabilities

- `oauth-starring-write-auth`: Optional OAuth App device flow, broad-scope disclosure, account matching, credential isolation, owner-bound requests, and disposable capability verification for Starring writes.

### Modified Capabilities

None.

## Impact

- Adds a second public client ID configuration, `EXTENSION_PUBLIC_GITHUB_WRITE_CLIENT_ID`, with no client secret.
- Adds a separate write-auth state store and Settings authorization/disconnect surfaces.
- Extends background messages and application state with non-secret write readiness.
- Requests no new browser host permission because OAuth device flow uses the existing GitHub login and API hosts.
- Introduces the security trade-off that the OAuth token carries `public_repo`, although implementation permits it only for documented Starring endpoints.
- Unblocks `add-safe-unstar-workflows`; native List mutations remain separately capability-gated.
