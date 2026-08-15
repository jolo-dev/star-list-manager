## MODIFIED Requirements

### Requirement: Membership writes are capability-gated
The system SHALL enable native List membership actions only when the release bundles complete, non-secret evidence that the configured OAuth application and documented List membership mutation passed the disposable unchanged-set and independent read-back capability probe, the active account has a matching optional OAuth credential with `public_repo` and `user` scopes, and a complete stable membership observation can be obtained for the target repository. The release MUST NOT use a manually supplied public environment boolean as evidence.

#### Scenario: Verified release and eligible account enable move

- **WHEN** the released extension bundles complete membership capability evidence, the active authenticated identity matches the account-bound OAuth credential, that credential has `public_repo` and `user`, and the user selects distinct valid source and destination Lists
- **THEN** the system enables review of the existing native List move operation without requiring a user-set or release-set public environment flag

#### Scenario: Release evidence is absent or incomplete

- **WHEN** the extension does not bundle complete typed membership capability evidence
- **THEN** the system keeps membership controls read-only, sends no membership mutation request, and states that this build has not enabled verified native List membership writes

#### Scenario: Account authorization is not ready

- **WHEN** the release bundles complete membership capability evidence but the active account lacks a matching OAuth credential with both required scopes
- **THEN** the system keeps membership controls unavailable for that account and directs the user to authorize native List membership changes

#### Scenario: Build evidence contains sensitive or malformed data

- **WHEN** capability evidence is absent, partial, malformed, or contains OAuth tokens, device codes, authorization headers, raw credential responses, user identifiers, or fixture repository identifiers
- **THEN** build validation rejects the evidence and the extension does not enable membership writes

#### Scenario: Required mutation is unavailable

- **WHEN** GitHub removes or rejects the documented List membership mutation capability
- **THEN** the system keeps imported Lists read-only and does not fall back to page scraping, cookies, or undocumented internal endpoints

#### Scenario: Membership write capability is not proven

- **WHEN** the configured release lacks successful disposable-probe evidence for the configured OAuth application and documented mutation
- **THEN** the system keeps imported Lists read-only and exposes no production membership mutation controls

#### Scenario: Membership observation is incomplete or unstable

- **WHEN** one or more current Lists cannot be checked completely or bounded observations do not stabilize for the target repository
- **THEN** the system disables the membership mutation and explains that it cannot safely construct the complete target set

### Requirement: Move is one removal plus one addition
The system SHALL model a move as removing an explicitly selected source List and adding an explicitly selected destination List while retaining all unrelated memberships in the stable observation. Enabling moves from verified release evidence SHALL NOT weaken preview, confirmation, stale-input, or read-back requirements.

#### Scenario: Enabled move retains its safety workflow

- **WHEN** a verified release and eligible account allow the user to review a move from List A to List B
- **THEN** the system still previews the complete before and desired sets, requires explicit confirmation, submits B plus every unrelated current membership while excluding only A, and marks success only after a fresh stable read-back matches the desired set

#### Scenario: Valid move is previewed

- **WHEN** the repository belongs to the selected source List
- **THEN** the preview shows the source removal, destination addition, and every unchanged membership

#### Scenario: Move source is absent

- **WHEN** the repository does not belong to the selected source List
- **THEN** the system refuses to create the move job and asks the user to refresh or choose a current source
