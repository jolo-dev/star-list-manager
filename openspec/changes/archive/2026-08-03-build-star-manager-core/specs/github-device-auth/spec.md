## Purpose

Provide backend-free GitHub authentication for the extension while keeping credentials isolated from web pages and limiting access to the public-star management capabilities required by the product.

## ADDED Requirements

### Requirement: GitHub App device-flow sign-in

The system SHALL authenticate users through GitHub App device flow without requiring a pasted personal access token, embedded client secret, or hosted callback service.

#### Scenario: User completes device authorization

- **WHEN** an unauthenticated user starts sign-in and approves the displayed device code on GitHub
- **THEN** the system validates the returned user identity and enters the authenticated state

#### Scenario: Device code expires or is denied

- **WHEN** GitHub reports that the device code expired or the user denied authorization
- **THEN** the system remains signed out and presents a recoverable explanation with an option to restart sign-in

### Requirement: Least-privilege authorization

The system SHALL use a GitHub App permission envelope limited to user-level Starring read and implicit public-resource access, with no repository or organization permission. The core change MUST NOT issue a GitHub write mutation. Later write capabilities require a separate authentication proposal because the verified core token was denied REST star writes and native List mutations.

#### Scenario: User reviews the authorization request

- **WHEN** the user authorizes the GitHub App
- **THEN** the request identifies read-only Starring access and does not request private repository, repository content, organization, Gist, write, or unrelated account permission

#### Scenario: Required permission is unavailable

- **WHEN** the authenticated token lacks permission for a requested core capability
- **THEN** the system disables that capability and explains the missing permission without requesting unrelated repository access

### Requirement: Credential isolation

The system MUST keep access tokens, refresh tokens, and device codes within extension-owned authentication and background contexts and MUST NOT expose them to web pages, content scripts, rendered DOM, logs, exported data, or user-facing error text.

#### Scenario: Page context requests credentials

- **WHEN** a page-originated or otherwise untrusted message requests credential material
- **THEN** the system rejects the request without returning any token-derived value

#### Scenario: Authentication error is displayed

- **WHEN** a GitHub authentication request fails
- **THEN** the displayed and logged error omits tokens, authorization headers, device codes, and raw credential-bearing responses

### Requirement: Token refresh and reauthentication

The system SHALL refresh a device-flow user access token before or after expiry when its refresh token remains valid, SHALL coordinate refresh as a single in-flight operation, and SHALL replace each rotated token pair atomically before returning to a signed-out state when refresh is no longer possible.

#### Scenario: Access token expires with valid refresh token

- **WHEN** an API operation requires authentication and the current access token is expired but refresh is valid
- **THEN** the system refreshes the token and retries the operation once

#### Scenario: Refresh token is rejected

- **WHEN** GitHub rejects the refresh token
- **THEN** the system clears credentials only if the rejected token pair is still current, preserves non-credential local library data, and asks the user to sign in again

#### Scenario: Concurrent API operations require refresh

- **WHEN** multiple authenticated operations encounter the same expired access token
- **THEN** the system performs one refresh, makes all operations await its result, and prevents a losing request from clearing or overwriting a newer rotated token pair

### Requirement: Disconnect GitHub account

The system SHALL provide a disconnect action that removes all locally stored GitHub credentials without deleting repository annotations unless the user separately requests complete local-data removal.

#### Scenario: User disconnects successfully

- **WHEN** the user confirms account disconnection
- **THEN** the system deletes access and refresh tokens, stops authenticated synchronization, and retains local library records in a signed-out state

### Requirement: Authenticated account data is isolated

The system MUST namespace GitHub-derived records, local annotations, synchronization state, and remote mutation state by the stable authenticated GitHub user ID and MUST expose or execute only the active identity's namespace.

#### Scenario: Different account signs in after disconnect

- **WHEN** account A disconnects and account B authenticates in the same browser profile
- **THEN** the dashboard shows account B's separate library, account A's retained data is not merged, and account A's pending remote work remains blocked

#### Scenario: Original account returns

- **WHEN** account A later authenticates again
- **THEN** the system reconnects account A to its retained namespace without exposing account B's library or operations
