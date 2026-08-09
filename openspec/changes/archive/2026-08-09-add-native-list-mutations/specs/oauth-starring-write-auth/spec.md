## MODIFIED Requirements

### Requirement: Read and write credentials remain separate

The system MUST continue using the read-only GitHub App credential for synchronization and SHALL store the optional OAuth write credential in a separate account-scoped record.

#### Scenario: User enables write authorization

- **WHEN** an authenticated user starts the optional write authorization
- **THEN** the read-only GitHub App credential remains unchanged and the write credential is stored separately only after identity and scope validation

#### Scenario: Write authorization is removed

- **WHEN** the user disconnects write access
- **THEN** the system removes the OAuth write credential without deleting the read-only credential, synchronized library, or local annotations

### Requirement: OAuth device flow discloses broad scope

The system SHALL use GitHub OAuth App device flow without a client secret and MUST disclose before authorization that `public_repo` grants broader public-repository write access and `user` grants broader profile authority than the extension uses.

#### Scenario: User reviews write authorization

- **WHEN** the user opens the write-authorization preview
- **THEN** the system identifies the `public_repo` and `user` scopes, explains that implementation is restricted to confirmed Starring endpoints and the structured native List membership mutation, and requires explicit continuation

#### Scenario: User cancels authorization

- **WHEN** the user declines the preview or cancels device authorization
- **THEN** no write credential is stored and read-only functionality remains available

### Requirement: Write requests are owner-bound and endpoint-limited

The system MUST require the expected stable GitHub user ID for every write request and MUST permit the OAuth credential only for documented authenticated-user Starring status, star, and unstar endpoints or the internally constructed `UpdateUserListsForItem` GraphQL operation.

#### Scenario: Expected owner is active

- **WHEN** a confirmed Starring or native List membership operation expects account A, account A remains active, and account A owns the validated OAuth credential
- **THEN** the system may send only the corresponding allowlisted request with account A's OAuth token

#### Scenario: Active account changes

- **WHEN** a request expects account A but another read-only account is active before dispatch
- **THEN** the system sends no write request and reports a retryable account-change failure

#### Scenario: Caller requests another API operation

- **WHEN** code attempts to use the OAuth credential for an endpoint or GraphQL document outside the exact allowlist
- **THEN** the system rejects the request locally without sending it to GitHub

### Requirement: OAuth identity and scope are validated

The system MUST validate that the OAuth token belongs to the same stable GitHub user ID as the active read-only account and that the granted scopes include both `public_repo` and `user` before marking complete write access ready. A previously stored token lacking `user` MAY remain usable only for the exact Starring boundary while native List membership remains unavailable.

#### Scenario: OAuth account and scopes match

- **WHEN** OAuth device authorization returns `public_repo` and `user` and identity validation matches the active stable GitHub user ID
- **THEN** the system stores the credential in that account namespace and reports complete write access ready

#### Scenario: OAuth account differs

- **WHEN** the OAuth identity differs from the active read-only account
- **THEN** the system rejects and discards the OAuth token with a sanitized account-mismatch explanation

#### Scenario: Membership scope is missing

- **WHEN** a matching OAuth credential includes `public_repo` but omits `user`
- **THEN** Starring readiness may remain available but native List membership readiness remains disabled and requires reauthorization

## ADDED Requirements

### Requirement: Native List membership write capability is independently verified

The project SHALL verify the configured OAuth App against an explicitly named disposable public star before native List membership controls are enabled.

#### Scenario: Disposable no-op probe succeeds

- **WHEN** the operator confirms a disposable public star, completes OAuth device authorization, and a complete stable membership set is available
- **THEN** the probe submits that unchanged complete set through `UpdateUserListsForItem`, independently reads back the same stable set, and records only sanitized evidence

#### Scenario: Capability or read-back fails

- **WHEN** the schema, permission, account ownership, mutation, or independent read-back cannot be verified
- **THEN** the probe does not claim capability success and production native List membership controls remain disabled
