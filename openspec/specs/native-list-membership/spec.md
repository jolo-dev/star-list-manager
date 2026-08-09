# Native List Membership Specification

## Purpose

Let users safely add, remove, and move public starred repositories among native GitHub Lists while preserving unrelated observed memberships and making preview staleness or verification conflicts explicit.

## Requirements

### Requirement: Membership writes are capability-gated
The system SHALL enable native List membership actions only when GitHub exposes the required query and mutation capability, the account-matched optional OAuth credential has passed the disposable membership-write capability probe, and a complete stable membership observation can be obtained for the target repository.

#### Scenario: Required mutation is unavailable
- **WHEN** GitHub removes or rejects the List mutation capability
- **THEN** the system keeps imported Lists read-only and does not fall back to page scraping, cookies, or undocumented internal endpoints

#### Scenario: Membership write capability is not proven
- **WHEN** the configured OAuth App has not completed a successful disposable `UpdateUserListsForItem` probe with independent read-back
- **THEN** the system keeps imported Lists read-only and exposes no production membership mutation controls

#### Scenario: Membership observation is incomplete or unstable
- **WHEN** one or more current Lists cannot be checked completely or bounded observations do not stabilize for the target repository
- **THEN** the system disables the membership mutation and explains that it cannot safely construct the complete target set

### Requirement: Membership observations require bounded stability
The system MUST treat List and item pagination as a non-atomic observation and MUST require two consecutive complete observations with identical membership sets for each target repository before using the result for preview, pre-write validation, or read-back verification.

#### Scenario: Membership changes during List traversal
- **WHEN** consecutive complete observations return different membership sets
- **THEN** the system does not issue or verify a mutation from those observations and retries only within a bounded policy

#### Scenario: Membership observations do not stabilize
- **WHEN** the bounded observation attempts finish without two consecutive matching sets
- **THEN** the system reports an unstable remote state and leaves the membership action unavailable or unresolved

### Requirement: Additive assignment is the default
The system SHALL treat adding selected Lists as an additive operation that unions the requested List IDs with every membership in the complete stable observation.

#### Scenario: Repository is added to a new List
- **WHEN** the user selects an additional List for a repository
- **THEN** the preview retains all existing memberships and shows only the newly added List as a change

#### Scenario: Repository already belongs to selected List
- **WHEN** the user requests an additive assignment to a List already in the stable observation
- **THEN** the system reports a no-op for that List and does not remove or duplicate any membership

### Requirement: Removal is explicit
The system MUST require an explicit removal action and confirmation before excluding any List ID from the complete target set derived from the stable observation.

#### Scenario: Repository is removed from one List
- **WHEN** the user explicitly selects a current List for removal
- **THEN** the preview shows that removal and retains every other membership from the stable observation

#### Scenario: Requested removal is already absent
- **WHEN** the requested source List is not present in the stable observation
- **THEN** the system reports that no removal is needed and does not issue a mutation for that request alone

### Requirement: Move is one removal plus one addition
The system SHALL model a move as removing an explicitly selected source List and adding an explicitly selected destination List while retaining all unrelated memberships in the stable observation.

#### Scenario: Valid move is previewed
- **WHEN** the repository belongs to the selected source List
- **THEN** the preview shows the source removal, destination addition, and every unchanged membership

#### Scenario: Move source is absent
- **WHEN** the repository does not belong to the selected source List
- **THEN** the system refuses to create the move job and asks the user to refresh or choose a current source

### Requirement: Membership preview shows complete effect
The system MUST show the current List set, resulting List set, additions, removals, exact affected repositories, and the remote-account nature of the change before confirmation.

#### Scenario: User previews a bulk membership action
- **WHEN** multiple repositories are selected for add, remove, or move
- **THEN** the preview shows the before and after memberships and changes for each repository rather than only an aggregate count

#### Scenario: User cancels membership preview
- **WHEN** the user cancels the preview
- **THEN** the system creates no mutation jobs and changes neither GitHub nor local membership state

### Requirement: Stale previews require reconfirmation
The system MUST compare a stable pre-execution membership observation and the relevant List catalog fingerprint with the membership set and List metadata used for confirmation. The fingerprint SHALL include referenced List identity, existence, name, and visibility. The system MUST pause the job for a refreshed preview when either membership or relevant List metadata differs.

#### Scenario: Membership changes after confirmation
- **WHEN** a stable GitHub membership observation differs from the confirmed before-set before mutation execution
- **THEN** the system performs no mutation, presents the refreshed before and after sets, and requires new confirmation

#### Scenario: Referenced List changes after confirmation
- **WHEN** a source or destination List is renamed, deleted, or changes visibility after confirmation
- **THEN** the system performs no mutation, refreshes the displayed List catalog and desired effect, and requires new confirmation or a valid replacement destination

### Requirement: Complete target set is submitted
The system MUST send the full desired List ID set for the repository and MUST include every unrelated membership in the stable pre-write observation.

#### Scenario: Repository has memberships unrelated to a move
- **WHEN** the user moves a repository from List A to List B while it also belongs to Lists C and D
- **THEN** the submitted target set contains B, C, and D and excludes only A

### Requirement: Remote read-back verifies success
The system MUST compare a fresh stable remote membership observation with the complete desired set before marking a membership job successful.

#### Scenario: Read-back matches desired memberships
- **WHEN** the post-mutation stable observation contains exactly the desired List IDs
- **THEN** the system commits the observed memberships locally and records verified success

#### Scenario: Read-back differs from desired memberships
- **WHEN** the post-mutation stable observation differs from the desired List IDs
- **THEN** the system updates the local mirror to the observed remote state, records a verification conflict, and requires a new preview before any retry

### Requirement: Concurrent-edit limitation is disclosed
The system SHALL state for every native membership mutation, including additive assignment, that membership discovery is a multi-request observation rather than an atomic snapshot and that the app preserves memberships in the final stable pre-write observation but cannot prevent GitHub changes made during observation, between observation and mutation, or during verification.

#### Scenario: User confirms a membership operation
- **WHEN** the user confirms an add, remove, or move
- **THEN** the UI explains the multi-request observation, replace-all behavior, and concurrent-edit limitation without claiming transactional isolation GitHub does not provide

### Requirement: Membership jobs use durable sequential execution
The system SHALL persist confirmed membership jobs and process them sequentially with independent per-repository outcomes, restart recovery, sanitized failures, and retry eligibility.

#### Scenario: Bulk move partially conflicts
- **WHEN** some repository jobs verify successfully and another repository has a stale preview or read-back conflict
- **THEN** successful jobs remain successful and the conflicting repository pauses or fails independently with its actual memberships displayed

#### Scenario: Active GitHub account differs from job owner
- **WHEN** a membership job belongs to a GitHub user ID other than the active authenticated identity
- **THEN** the system suspends execution without changing the job's terminal outcome and keeps it isolated until its owning identity becomes active

#### Scenario: Account changes during mutation or read-back
- **WHEN** the active identity changes after a membership request may have started but before verification is finalized
- **THEN** the system sends no further requests for that job and waits for the owning identity to return before performing owner-scoped read-back recovery

### Requirement: Native List lifecycle remains out of scope
The system MUST NOT create, rename, change visibility of, or delete native GitHub Lists as part of this capability.

#### Scenario: User manages membership
- **WHEN** the user opens membership controls
- **THEN** the available remote actions are limited to add, remove, and move repository membership among existing Lists
