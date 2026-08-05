## Context

The core GitHub App credential supports secretless refresh and public-star reads but cannot write stars on arbitrary third-party repositories. Real probes returned HTTP 403 requiring `starring=write,metadata=read` before and after App installation, authorization, and refresh. GitHub's OAuth App device flow supports requesting `public_repo`, which is explicitly documented as required for starring public repositories, but the scope also grants broad public-repository write authority.

The product decision is to accept that scope for an optional write credential while preserving the existing read-only GitHub App credential and limiting implementation to exact Starring routes.

## Goals / Non-Goals

**Goals:**

- Keep synchronization and ordinary use on the read-only GitHub App token.
- Add a second, optional device-flow credential with no client secret.
- Validate scope and stable identity before storing the OAuth token.
- Prevent account switching or arbitrary callers from misusing the broad token.
- Prove DELETE and restoration against a disposable star before mutation features use the credential.

**Non-Goals:**

- Use `public_repo` for repository content, collaborators, hooks, deployments, or any non-Starring endpoint.
- Replace the read-only credential or merge token records.
- Promise refresh for OAuth App tokens; rejected tokens require reauthorization.
- Implement the durable unstar queue or end-user mutation controls in this prerequisite change.

## Decisions

### Use a separate OAuth App and public client ID

The extension adds `EXTENSION_PUBLIC_GITHUB_WRITE_CLIENT_ID`. The OAuth App has device flow enabled and requires no client secret for device authorization. Device-code requests include `scope=public_repo`, and token responses must report that granted scope.

Alternative considered: continue with the GitHub App token. It failed real writes because arbitrary third-party repository resources do not satisfy the App installation/metadata boundary. A fine-grained PAT is narrower but requires pasted credential management and worse onboarding.

### Persist a separate account-scoped write-auth store

IndexedDB version 2 adds `writeAuthState`, keyed by stable GitHub user ID. A record contains the OAuth access token, granted normalized scopes, validated identity, creation time, and sanitized last failure. It contains no read credential or repository data. Existing v1 databases upgrade without changing current stores.

The active account pointer remains the read-only auth store's source of truth. A write record may exist only after matching that identity. Disconnect-write removes only the active write record; ordinary GitHub disconnect and complete deletion remove both credentials for the active account or all accounts respectively.

### Model OAuth device flow separately

The existing GitHub App flow expects refresh-token fields and cannot decode OAuth App tokens. A dedicated OAuth write authorization service shares polling and sanitization patterns but decodes `access_token`, `token_type`, and `scope` only. It validates `/user` before persistence.

This separation avoids optional refresh fields and prevents accidentally using the broad OAuth token in read clients.

### Allowlist write transport by structured route

The write session does not accept arbitrary URLs. It accepts an expected account ID, repository owner/name segments, and an operation enum for status, star, or unstar. It constructs only `https://api.github.com/user/starred/{owner}/{repo}`, encodes both segments, and permits GET, PUT, or DELETE according to the operation.

Before dispatch it reloads the active read identity and matching write credential. A 401 deletes only the current write record. A 403 records sanitized scope/permission denial but retains the token for explicit reauthorization or inspection.

### Disclose scope before starting GitHub flow

Settings shows a local confirmation panel before requesting a device code. It states that `public_repo` can write more public-repository resources than Star List Manager uses, names the Starring-only implementation boundary, and offers Continue or Cancel. The GitHub device page remains the final authorization step.

### Verify the configured OAuth App destructively but safely

A development script requires an explicit `owner/name` fixture that is already starred. It validates stable identity, sends DELETE, requires two consecutive complete public-star observations omitting the node ID, sends PUT restoration, and requires two consecutive observations containing it. Cleanup failure blocks completion and is independently checked.

## Risks / Trade-offs

- [`public_repo` is broader than required behavior] -> Keep it optional, disclose it twice, isolate the token, and enforce a structured Starring-only transport.
- [OAuth App tokens may be long-lived] -> Store only in extension-owned IndexedDB, clear on 401/disconnect/deletion, and document revocation through GitHub settings.
- [Users can authorize a different account] -> Validate stable user ID against the active read-only identity before persistence.
- [Account switch can race request dispatch] -> Reload active identity immediately before structured request dispatch and require an expected owner.
- [A compromised extension could bypass the route wrapper] -> Keep host permissions unchanged, avoid exposing the token, inspect built bundles, and treat broad scope as an explicit residual risk.
- [Disposable cleanup can fail] -> Always attempt PUT restoration, verify independently, and fail with manual cleanup guidance.

## Migration Plan

1. Add OAuth write-auth domain types and IndexedDB v2 store with migration tests.
2. Add device flow, scope/identity validation, isolated store, and structured owner-bound session with fake HTTP tests.
3. Add strict messages and Settings disclosure/authorization/disconnect states.
4. Register a development OAuth App, configure its public client ID locally, and run the disposable capability probe.
5. Update documentation, build inspection, and isolated Chromium/Firefox verification.
6. Archive this change only after real removal and restoration succeeds, then resume safe-unstar.
