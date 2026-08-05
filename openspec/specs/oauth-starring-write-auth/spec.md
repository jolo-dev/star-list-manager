# oauth-starring-write-auth Specification

## Purpose

Provide an optional, account-bound authorization for confirmed public-star mutations when the read-only GitHub App credential cannot operate across arbitrary third-party repositories.

## Requirements

### Requirement: Read and write credentials remain separate

The system MUST continue using the read-only GitHub App credential for synchronization and SHALL store any OAuth Starring-write credential in a separate account-scoped record.

#### Scenario: User enables write authorization

- **WHEN** an authenticated user starts the optional Starring-write authorization
- **THEN** the read-only GitHub App credential remains unchanged and the write credential is stored separately only after identity and scope validation

#### Scenario: Write authorization is removed

- **WHEN** the user disconnects write access
- **THEN** the system removes the OAuth write credential without deleting the read-only credential, synchronized library, or local annotations

### Requirement: OAuth device flow discloses broad scope

The system SHALL use GitHub OAuth App device flow without a client secret and MUST disclose before authorization that `public_repo` grants broader public-repository write access than the extension uses.

#### Scenario: User reviews write authorization

- **WHEN** the user opens the write-authorization preview
- **THEN** the system identifies the `public_repo` scope, explains that implementation is restricted to confirmed Starring endpoints, and requires explicit continuation

#### Scenario: User cancels authorization

- **WHEN** the user declines the preview or cancels device authorization
- **THEN** no write credential is stored and read-only functionality remains available

### Requirement: OAuth identity and scope are validated

The system MUST validate that the OAuth token belongs to the same stable GitHub user ID as the active read-only account and that the granted scopes include `public_repo` before marking write access ready.

#### Scenario: OAuth account matches

- **WHEN** OAuth device authorization returns `public_repo` and identity validation matches the active stable GitHub user ID
- **THEN** the system stores the credential in that account namespace and reports write access ready

#### Scenario: OAuth account differs

- **WHEN** the OAuth identity differs from the active read-only account
- **THEN** the system rejects and discards the OAuth token with a sanitized account-mismatch explanation

#### Scenario: Required scope is missing

- **WHEN** GitHub returns an OAuth token without `public_repo`
- **THEN** the system rejects and discards the token and explains that write authorization was incomplete

### Requirement: Write requests are owner-bound and endpoint-limited

The system MUST require the expected stable GitHub user ID for every write request and MUST permit the OAuth credential only for documented authenticated-user Starring status, star, and unstar endpoints.

#### Scenario: Expected owner is active

- **WHEN** a confirmed Starring operation expects account A, account A remains active, and account A owns the validated OAuth credential
- **THEN** the system may send the allowlisted Starring request with account A's OAuth token

#### Scenario: Active account changes

- **WHEN** a request expects account A but another read-only account is active before dispatch
- **THEN** the system sends no write request and reports a retryable account-change failure

#### Scenario: Caller requests another API endpoint

- **WHEN** code attempts to use the OAuth credential for an endpoint outside the exact Starring allowlist
- **THEN** the system rejects the request locally without sending it to GitHub

### Requirement: Write readiness is non-secret and account-scoped

The system SHALL expose signed-out, authorization-required, pending, ready, scope-denied, account-mismatch, and credential-rejected readiness without exposing token material.

#### Scenario: Dashboard reads readiness

- **WHEN** the dashboard requests application state
- **THEN** it receives only the active account's non-secret readiness and sanitized error information

#### Scenario: OAuth token is rejected

- **WHEN** GitHub rejects the OAuth token with an authentication response
- **THEN** the system deletes that current write credential, preserves read-only data, and requires write reauthorization

### Requirement: OAuth write credentials are isolated

The system MUST NOT render, log, export, package, or expose OAuth access tokens, device codes, authorization headers, or raw credential-bearing responses.

#### Scenario: Export is generated

- **WHEN** the active account exports local data
- **THEN** the export excludes the read-only and OAuth write credentials and all authorization headers

#### Scenario: Authorization failure is displayed

- **WHEN** OAuth device flow, identity validation, scope validation, or an authenticated request fails
- **THEN** only a mapped category, safe message, status, timing, and retry guidance may reach the dashboard or persisted error state

### Requirement: Starring write capability is independently verified

The project SHALL verify the configured OAuth App against an explicitly named disposable public star before safe-unstar controls are enabled.

#### Scenario: Disposable probe succeeds

- **WHEN** the operator confirms a disposable starred repository and completes OAuth device authorization
- **THEN** the probe removes the star, verifies converged absence, restores it, verifies converged presence, and records only sanitized evidence

#### Scenario: Cleanup cannot be verified

- **WHEN** restoration or its read-back fails
- **THEN** the probe reports prominent manual cleanup guidance and does not claim capability success

### Requirement: Complete deletion covers both credential types

The system SHALL include the OAuth write credential and readiness state in complete local-data removal.

#### Scenario: User confirms complete removal

- **WHEN** the user confirms deletion of all extension-owned data
- **THEN** both read-only and write credentials, authorization state, synchronized data, and local data are removed before returning to first run
