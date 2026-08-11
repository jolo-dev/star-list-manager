## MODIFIED Requirements

### Requirement: Native List membership write capability is independently verified
The project SHALL verify the configured OAuth App against an explicitly named disposable public star before native List membership controls are enabled in a release. A completed probe MAY be represented only by checked-in or bundled typed release evidence containing the complete non-secret proof; ordinary users SHALL NOT need to run the probe or configure a public environment boolean.

#### Scenario: Reviewed probe evidence enables a release

- **WHEN** an operator confirms a disposable public star, completes OAuth device authorization, runs the unchanged-set probe, independently reads back the same stable set, and reviews the sanitized result
- **THEN** the release may bundle complete non-secret capability evidence and may enable native List membership controls for individually eligible accounts

#### Scenario: New OAuth application or mutation lacks renewed proof

- **WHEN** the configured write OAuth application or supported membership mutation changes without complete reviewed capability evidence for that configuration
- **THEN** the release does not enable native List membership controls and continues to provide read-only synchronization

#### Scenario: Ordinary user opens membership controls

- **WHEN** an ordinary user with a release that has bundled complete capability evidence authorizes matching `public_repo` and `user` access
- **THEN** the user can use the existing confirmed membership workflow without running a disposable probe or setting a build environment variable

#### Scenario: Disposable no-op probe succeeds

- **WHEN** the operator confirms a disposable public star, completes OAuth device authorization, and a complete stable membership set is available
- **THEN** the probe submits that unchanged complete set through `UpdateUserListsForItem`, independently reads back the same stable set, and records only sanitized evidence

#### Scenario: Capability or read-back fails

- **WHEN** the schema, permission, account ownership, mutation, or independent read-back cannot be verified
- **THEN** the probe does not claim capability success and production native List membership controls remain disabled
