# Native List Lifecycle Specification

## Purpose

Allow an authenticated user with verified optional write authorization to create an empty public or private native GitHub List and to deliberately delete an empty or populated List, while treating GitHub as authoritative and preserving all repositories and local organization data.

## ADDED Requirements

### Requirement: Lifecycle actions are independently capability-gated
The system SHALL expose native List creation and deletion only after GitHub exposes the required lifecycle mutations and the active account's optional OAuth credential has passed a separate disposable-fixture lifecycle probe. The probe MUST prove both `createUserList` and `deleteUserList` with independent catalog read-back, and MUST delete only the List it created for the probe.

#### Scenario: Lifecycle capability is not proven
- **WHEN** the lifecycle schema, permission, same-account credential, fixture creation, fixture deletion, or independent read-back cannot be verified
- **THEN** the system keeps native List lifecycle controls unavailable, preserves read-only List import and existing membership controls according to their own readiness, and shows a sanitized explanation

#### Scenario: Lifecycle capability is proven
- **WHEN** the separate disposable-fixture probe creates a disposable List, independently observes it, deletes the same stable List ID, and independently observes its absence
- **THEN** the system enables lifecycle controls only for that active GitHub account

### Requirement: List creation requires explicit visibility
The system MUST let the user create an empty native GitHub List by entering a non-empty name and explicitly choosing either public or private visibility. It MUST not silently choose visibility, add repositories, or set a description.

#### Scenario: User creates a private List
- **WHEN** the user enters a valid name, selects private visibility, and confirms creation
- **THEN** the system sends only the fixed `createUserList` request with that name and `isPrivate: true`, and does not change any repository membership or local annotation

#### Scenario: User creates a public List
- **WHEN** the user enters a valid name, selects public visibility, and confirms creation
- **THEN** the system sends only the fixed `createUserList` request with that name and `isPrivate: false`

#### Scenario: Visibility is not selected or the name is invalid
- **WHEN** the user has not explicitly selected public or private visibility, or the trimmed name is empty
- **THEN** the system prevents confirmation and sends no request to GitHub

### Requirement: Creation is synchronized and verified
The system MUST treat the returned List node ID as the candidate identity, then complete a native List catalog synchronization and confirm that the returned ID exists with the requested name and visibility before reporting creation as successful. Local List data MUST be changed only through normal reconciliation from the successful remote observation.

#### Scenario: Create response and read-back agree
- **WHEN** `createUserList` returns a valid List and a subsequent complete catalog synchronization contains its stable ID with the requested name and visibility
- **THEN** the dashboard shows the new empty List and marks the operation as verified

#### Scenario: Create response is ambiguous or read-back cannot verify it
- **WHEN** the request may have reached GitHub but no valid response is received, or the returned List cannot be confirmed in a complete catalog synchronization
- **THEN** the system does not automatically retry creation, reports an unknown or verification-conflict outcome, and requires the user to synchronize and deliberately start a new creation request before another create mutation

### Requirement: Empty Lists can be deleted with standard confirmation
The system SHALL allow deletion of a known empty List after the user explicitly confirms the remote account change. The confirmation MUST identify the List name and visibility, say that deletion cannot be undone by the extension, and state that the List—not any repository—is deleted.

#### Scenario: User deletes an empty List
- **WHEN** the latest known List metadata reports zero items and the user confirms deletion
- **THEN** the system sends the fixed `deleteUserList` request for that stable List ID and never unstars a repository

### Requirement: Populated Lists can be deleted with stronger confirmation
The system SHALL allow deletion of a populated List, but MUST require a stronger destructive confirmation than for an empty List. The confirmation MUST identify the List, display GitHub's latest reported item count and any partial-import limitation, state that all of those repositories remain starred but become unlisted from the deleted List, and require an affirmative, List-specific confirmation.

#### Scenario: User deletes a populated List
- **WHEN** the latest known List metadata reports one or more items and the user completes the stronger confirmation for that exact List
- **THEN** the system sends only `deleteUserList` for that List ID, does not unstar or delete repository records, and does not alter local annotations

#### Scenario: User cancels populated List deletion
- **WHEN** the user closes or cancels the destructive confirmation
- **THEN** the system creates no lifecycle job and sends no GitHub mutation

### Requirement: Deletion is revalidated and synchronized
Before deletion, the system MUST obtain fresh complete List catalog metadata for the target stable List ID. It MUST pause for renewed confirmation if the name, visibility, or reported item count used in the confirmation changed. After a resolved delete, it MUST complete native List synchronization and verify that the stable List ID is absent before reporting success.

#### Scenario: Target List changes before deletion
- **WHEN** the fresh metadata differs from the confirmed name, visibility, or reported item count
- **THEN** the system sends no deletion request, refreshes the confirmation with current metadata, and requires renewed confirmation

#### Scenario: Target List is already absent before deletion
- **WHEN** the fresh catalog no longer contains the confirmed stable List ID
- **THEN** the system sends no deletion request, reconciles local data from the catalog, and reports that the List was already deleted

#### Scenario: Delete read-back succeeds
- **WHEN** `deleteUserList` returns successfully and a complete catalog synchronization no longer contains the deleted List ID
- **THEN** local reconciliation removes that List and its memberships while retaining repository records and all local annotations, and the operation is marked verified

#### Scenario: Delete response is ambiguous or the List remains visible after read-back
- **WHEN** the delete request may have been sent without a conclusive response, or a complete read-back still contains the List ID
- **THEN** the system never automatically repeats the delete mutation, records an unknown or verification-conflict outcome, retains the authoritative reconciled local catalog, and requires a fresh user action before another delete attempt

### Requirement: Lifecycle writes remain narrowly authorized and account-bound
The OAuth transport MUST construct only fixed `createUserList` and `deleteUserList` GraphQL documents from validated lifecycle inputs and an expected stable GitHub user ID. It MUST not accept a caller-supplied URL, GraphQL document, operation name, arbitrary variables, description, or existing-List update fields. It MUST require the same account-matched credential and scopes as the existing List membership transport.

#### Scenario: Caller attempts an unsupported lifecycle write
- **WHEN** code requests rename, existing visibility change, description update, arbitrary GraphQL, or an action for a different active account
- **THEN** the transport rejects it locally and sends no request to GitHub

### Requirement: Lifecycle operations are durable and non-destructive to local data
The system SHALL persist a lifecycle operation before remote work, serialize it with other native List mutations, expose sanitized progress and outcomes, and recover service-worker interruption through fresh remote observation. It MUST not automatically replay a creation or deletion request after an ambiguous network outcome.

#### Scenario: Browser service worker stops after dispatch
- **WHEN** the extension restarts while a lifecycle request or read-back may have been in progress
- **THEN** it refreshes the authoritative catalog before finalizing status and does not blindly replay the mutation

#### Scenario: A List lifecycle change affects pending membership work
- **WHEN** a newly created List is synchronized or a deleted List is referenced by a pending membership job
- **THEN** the system exposes the newly created List only after verified synchronization, and pauses affected membership work for refreshed preview rather than targeting a deleted or changed List

### Requirement: Lifecycle UI is available independently of existing Lists
The dashboard SHALL provide a GitHub List management entry even when the latest synchronization returns no Lists. It MUST clearly distinguish native GitHub Lists from local tags and show lifecycle write readiness, synchronization status, and a manual refresh path.

#### Scenario: Account has no native Lists
- **WHEN** the user has completed a successful List synchronization with zero native Lists
- **THEN** the user can still open List management and begin the create flow
