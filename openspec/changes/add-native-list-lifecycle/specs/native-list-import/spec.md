## MODIFIED Requirements

### Requirement: Reconcile native List changes
The system SHALL update imported metadata and memberships to match the latest complete native-list synchronization, including after a verified native List lifecycle operation. It MUST retain repository records and local annotations when a List disappears.

#### Scenario: List is created through the extension
- **WHEN** a `createUserList` response is followed by a complete catalog synchronization that contains the returned stable List ID with the requested name and visibility
- **THEN** the system reconciles and displays the new empty List from the remote catalog

#### Scenario: List is renamed
- **WHEN** a known List ID is returned with a different name or description
- **THEN** the system updates that List without losing its local references or membership relationships

#### Scenario: List is deleted on GitHub
- **WHEN** a complete native-list synchronization no longer contains a previously imported List
- **THEN** the system removes the active native List and its memberships while preserving repository records and local annotations

#### Scenario: List is deleted through the extension
- **WHEN** `deleteUserList` is followed by a complete native-list synchronization that no longer contains the deleted stable List ID
- **THEN** the system removes the active native List and its memberships while preserving repository records and local annotations

### Requirement: Core native-list integration is read-only unless a capability-gated lifecycle or membership action is explicitly confirmed
The system MUST NOT issue a native List mutation during ordinary import, browsing, filtering, or inspection. Creation and deletion require their independently verified lifecycle capability and explicit user confirmation; membership changes require their existing independently verified membership capability and explicit confirmation.

#### Scenario: User inspects native membership or List metadata
- **WHEN** the user opens a repository, List, or ordinary dashboard view
- **THEN** the system displays synchronized data without issuing a GitHub mutation
