## MODIFIED Requirements

### Requirement: Write requests are owner-bound and endpoint-limited
The system MUST require the expected stable GitHub user ID for every write request and MUST permit the OAuth credential only for documented authenticated-user Starring status, star, and unstar endpoints; the internally constructed `UpdateUserListsForItem` GraphQL operation; and internally constructed `createUserList` and `deleteUserList` lifecycle mutations. Each mutation boundary MUST accept only the narrow validated inputs required for its fixed operation.

#### Scenario: Expected owner is active
- **WHEN** a confirmed Starring, native List membership, or native List lifecycle operation expects account A, account A remains active, and account A owns the validated OAuth credential
- **THEN** the system may send only the corresponding allowlisted request with account A's OAuth token

#### Scenario: Active account changes
- **WHEN** a request expects account A but another read-only account is active before dispatch
- **THEN** the system sends no write request and reports a retryable account-change failure

#### Scenario: Caller requests another API operation
- **WHEN** code attempts to use the OAuth credential for an endpoint or GraphQL document outside the exact allowlist, including List rename, description editing, or an existing List visibility change
- **THEN** the system rejects the request locally without sending it to GitHub

### Requirement: Native List lifecycle write capability is independently verified
The project SHALL verify the configured OAuth App against an explicitly named disposable fixture before native List lifecycle controls are enabled. The fixture procedure MUST create an empty List with an explicit visibility, independently read it from the authenticated account's catalog, delete the same stable List ID, independently verify its absence, and record only sanitized evidence.

#### Scenario: Disposable lifecycle probe succeeds
- **WHEN** the operator completes OAuth device authorization and confirms a disposable fixture name and visibility
- **THEN** the probe performs only the fixed create and delete lifecycle mutations, verifies both results through independent catalog read-back, and records no credential material

#### Scenario: Lifecycle capability or cleanup fails
- **WHEN** the schema, permission, account ownership, creation, deletion, or either read-back cannot be verified
- **THEN** the probe reports prominent cleanup or inspection guidance as applicable and does not claim lifecycle capability success
