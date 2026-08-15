## ADDED Requirements

### Requirement: Native List rename is capability-gated

The system SHALL expose a native GitHub List rename control only when the active account has a current synchronized List catalog, a matching optional OAuth write credential, and independently verified capability for the exact owner-bound rename operation. The system MUST otherwise keep imported Lists read-only and MUST NOT fall back to page scraping, cookies, or undocumented endpoints.

#### Scenario: Rename capability is proven

- **WHEN** the configured OAuth App has completed the explicitly approved disposable-List capability probe, including a successful rename and independent complete-catalog read-back for the active account
- **THEN** the system enables the native List Edit control for synchronized existing Lists

#### Scenario: Rename capability is unavailable

- **WHEN** the schema, scope, permission, active-account ownership, probe, or current catalog availability cannot be verified
- **THEN** the system shows imported Lists without enabled rename controls while preserving read-only List views and separately available membership actions

### Requirement: Rename is initiated inline from the selected List header

The system SHALL render an Edit button beside the header of a selected native List detail view. Selecting Edit SHALL replace the displayed name in that header with an inline text input and Save and Cancel controls. The sidebar SHALL remain navigation-only.

#### Scenario: User begins editing a List name

- **WHEN** the user selects Edit beside a selected List header
- **THEN** the system focuses an inline input populated with that List’s current name and exposes Save and Cancel controls

#### Scenario: User cancels an inline edit

- **WHEN** the user selects Cancel or presses Escape before Save completes
- **THEN** the system discards the unsaved input, restores the original header, returns focus to Edit, and sends no remote mutation

### Requirement: Names are validated locally before dispatch

The system MUST trim a candidate name before validation and persistence, MUST reject an empty result, and MUST reject a name equivalent to another current List name under Unicode NFKC normalization and case-insensitive comparison. The target List itself SHALL be excluded from duplicate comparison.

#### Scenario: User enters blank input

- **WHEN** the trimmed candidate name is empty
- **THEN** the system presents an accessible inline validation error and sends no runtime request, storage write, or GitHub mutation

#### Scenario: User enters an equivalent existing name

- **WHEN** the candidate is equivalent after canonical comparison to a List with a different stable List ID
- **THEN** the system presents an accessible inline duplicate-name error and sends no runtime request, storage write, or GitHub mutation

#### Scenario: User retains the current name

- **WHEN** the candidate is equivalent only to the List being renamed
- **THEN** the system permits Save without treating the List as a duplicate

### Requirement: Rename requests are account-bound and narrowly scoped

The system MUST validate the active stable GitHub user ID, target List stable ID, and trimmed validated name again in the background before sending a rename. It MUST construct only the documented native List rename operation internally and MUST reject arbitrary URLs, documents, operation names, variables, account IDs, lifecycle operations, or unvalidated names.

#### Scenario: Active account changes before dispatch

- **WHEN** a rename request expects account A but account A is no longer active before dispatch
- **THEN** the system sends no GitHub mutation and reports a sanitized retryable account-change result

#### Scenario: Caller requests a broader write

- **WHEN** a caller attempts to use the rename transport for an endpoint, GraphQL document, variable shape, or lifecycle operation outside the exact rename allowlist
- **THEN** the system rejects the request locally without sending it to GitHub

### Requirement: Verified catalog read-back controls local rename state

The system MUST not optimistically rename the local List record. After a successful remote response, it MUST obtain a fresh complete authoritative List catalog and update local metadata only when the same stable List ID is present with the requested canonical name. The resulting shared state SHALL drive both the sidebar and selected detail header.

#### Scenario: Rename is verified

- **WHEN** catalog read-back contains the target stable List ID with the requested canonical name
- **THEN** the system persists the authoritative metadata and immediately renders the verified name in both the sidebar and selected List detail header, including after reload

#### Scenario: Remote result is ambiguous or divergent

- **WHEN** the rename response is ambiguous, the List is absent, or catalog read-back reports a different name
- **THEN** the system does not persist an optimistic requested name, reconciles to any authoritative observed catalog state, reports a sanitized inline result, and requires a new explicit Save before another attempt

### Requirement: Rename interactions are accessible and single-dispatch

The system SHALL provide an accessible Edit label, focus the inline input on entry, expose validation and remote errors through an accessible live/alert region, and communicate pending Save state. It MUST prevent a second rename dispatch while a Save is active.

#### Scenario: Save is pending

- **WHEN** the user submits a valid inline rename and the remote result is unresolved
- **THEN** the system indicates busy state, prevents duplicate Save dispatch, and retains the editor until verified success or a sanitized failure result is available

#### Scenario: External rename wins concurrently

- **WHEN** a concurrent GitHub change causes authoritative read-back to report a different name than the user saved
- **THEN** the system displays the observed authoritative name without claiming transactional isolation and requires an explicit new user Save to request another rename
