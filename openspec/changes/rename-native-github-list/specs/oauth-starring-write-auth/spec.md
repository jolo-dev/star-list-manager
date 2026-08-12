## MODIFIED Requirements

### Requirement: Write requests are owner-bound and endpoint-limited

The system MUST require the expected stable GitHub user ID for every write request and MUST permit the OAuth credential only for documented authenticated-user Starring status, star, and unstar endpoints; the internally constructed `UpdateUserListsForItem` GraphQL operation; or the separately capability-proven, internally constructed native List rename operation. The system MUST NOT allow callers to provide arbitrary URLs, GraphQL documents, operation names, or variables.

#### Scenario: Expected owner is active

- **WHEN** a confirmed Starring, native List membership, or native List rename operation expects account A, account A remains active, and account A owns the validated OAuth credential
- **THEN** the system may send only the corresponding allowlisted request with account A's OAuth token

#### Scenario: Active account changes

- **WHEN** a request expects account A but another read-only account is active before dispatch
- **THEN** the system sends no write request and reports a retryable account-change failure

#### Scenario: Caller requests another API operation

- **WHEN** code attempts to use the OAuth credential for an endpoint or GraphQL document outside the exact allowlist
- **THEN** the system rejects the request locally without sending it to GitHub

#### Scenario: Native List rename is not capability-proven

- **WHEN** code requests the native List rename operation before its separately approved disposable-List capability probe has verified schema, scope, owner identity, mutation, and catalog read-back
- **THEN** the system rejects the request locally and retains native Lists as read-only
