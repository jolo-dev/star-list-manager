# Safe Unstar Specification

## Purpose

Allow users to remove unwanted GitHub stars with explicit previews, remote verification, retained local context, and clear outcomes for both individual and bulk cleanup operations.

## Requirements

### Requirement: Explicit unstar preview and confirmation

The system MUST show a confirmation preview before any unstar request, identifying the operation as a remote GitHub account change and listing every repository that will be affected.

#### Scenario: User previews one repository

- **WHEN** the user requests to unstar a single repository
- **THEN** the confirmation identifies that repository by owner/name and states that its GitHub star will be removed

#### Scenario: User previews a bulk selection

- **WHEN** the user requests to unstar multiple selected repositories
- **THEN** the confirmation shows the exact count and complete repository list before enabling confirmation

#### Scenario: User cancels confirmation

- **WHEN** the user dismisses or cancels the unstar confirmation
- **THEN** the system creates no mutation jobs and changes neither GitHub nor local star state

### Requirement: Confirmed unstars become durable intent

The system SHALL persist a confirmed unstar operation before attempting its first GitHub request.

#### Scenario: Dashboard closes after confirmation

- **WHEN** the user confirms an unstar and closes the dashboard before execution completes
- **THEN** the system retains the operation and continues or resumes it through the durable mutation queue

### Requirement: Remote verification precedes local success

The system MUST mark a repository locally unstarred only after a converged complete star observation for the job's stable repository node ID confirms that the authenticated job owner no longer stars it. A route-level not-found response alone is not sufficient verification.

#### Scenario: Delete and verification succeed

- **WHEN** GitHub accepts the unstar request and consecutive complete star observations omit the repository node ID
- **THEN** the system marks the local repository unstarred and records the operation as succeeded

#### Scenario: Delete succeeds but verification is inconclusive

- **WHEN** the delete response is successful but the system cannot verify the resulting remote state
- **THEN** the repository remains locally starred and the operation remains retryable or failed with a verification-specific explanation

### Requirement: Already-unstarred operations are idempotent

The system SHALL treat a repository as already unstarred only after a converged complete star observation for the job owner's account omits its stable repository node ID. Current route resolution and route-level status checks MAY inform the observation but MUST NOT independently establish success.

#### Scenario: Repository was unstarred elsewhere before execution

- **WHEN** consecutive complete star observations for the job owner's account omit the repository node ID before a delete is sent
- **THEN** the system reconciles local star state, records an externally completed success, and preserves the repository's local data

#### Scenario: Repository absence cannot be confirmed

- **WHEN** the job owner is active but route identity changes, repository availability is unresolved, or complete star observations do not converge
- **THEN** the system records a blocked-unknown outcome, leaves local starred state unchanged, and does not claim successful completion

### Requirement: Local context is preserved

The system SHALL retain repository metadata, annotations, tags, notes, favorites, triage history, and revisit history after a successful unstar.

#### Scenario: User inspects an unstarred repository

- **WHEN** an unstar operation succeeds
- **THEN** the repository leaves active starred views but remains available in history with its local context and operation result

### Requirement: Unstar history is auditable

The system SHALL record the repository identity, operation time, origin, batch association when applicable, verification result, and final status without storing credentials or raw authorization data.

#### Scenario: User reviews cleanup history

- **WHEN** the user opens mutation or repository history
- **THEN** the system shows whether the unstar succeeded, was already complete remotely, failed, was blocked-unknown, or was cancelled and when that outcome occurred

### Requirement: Blocked-unknown is explicit and manually recoverable

The system SHALL treat blocked-unknown as a terminal automatic outcome for the current attempt only after the job owner is active and remote state remains unresolved. It SHALL count the outcome separately in batch summaries, retain it in history, and allow manual retry only after the user refreshes repository state. A different active account suspends the job instead of terminalizing it.

#### Scenario: User reviews blocked-unknown operation

- **WHEN** the owning account is active and an unstar cannot be verified because repository identity, route, availability, or observations are unresolved
- **THEN** the UI displays the blocking reason, leaves starred state unchanged, and offers no automatic retry

#### Scenario: User retries after refreshing state

- **WHEN** the user explicitly retries a blocked-unknown operation after a successful account and library refresh
- **THEN** the system creates a new attempt that repeats stable-ID observation before any delete request

### Requirement: No automatic re-star or destructive automation

The system MUST NOT automatically unstar repositories through rules and MUST NOT present an Undo action unless a separately specified and verified re-star capability exists.

#### Scenario: Successful unstar is displayed

- **WHEN** an unstar operation completes successfully
- **THEN** the UI offers history and navigation but does not imply that a local-only undo can restore the GitHub star
