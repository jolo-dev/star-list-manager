# local-library-data Specification

## Purpose

Persist private app-owned organization independently from GitHub while giving users durable recovery, portable export, validated import, and complete control over local deletion.

## Requirements

### Requirement: Local annotations are independent records

The system SHALL store triage state, tags, note, favorite state, revisit date, review timestamps, and local modification time independently from GitHub repository and native-list data.

#### Scenario: Remote metadata changes

- **WHEN** synchronization updates repository metadata or native-list membership
- **THEN** the repository's local annotations remain unchanged

### Requirement: Local data survives star-state changes

The system SHALL retain annotations and review history after a repository is no longer starred so they are available if it is starred again or inspected in history.

#### Scenario: Previously unstarred repository returns

- **WHEN** synchronization discovers that a repository with retained annotations has been starred again
- **THEN** the system reconnects the existing annotations to the current repository record

### Requirement: Versioned data export

The system SHALL let the user export the active GitHub account namespace's repository annotations, triage history, local tags, settings, and non-secret library metadata in a documented versioned JSON format.

#### Scenario: User exports local data

- **WHEN** the user requests an export
- **THEN** the system produces a JSON file that excludes access tokens, refresh tokens, device codes, authorization headers, and other credentials

#### Scenario: Multiple account namespaces exist

- **WHEN** the user exports while one GitHub identity is active and retained data exists for another identity
- **THEN** the export contains only the active identity's namespace and identifies that GitHub user ID in non-secret metadata

### Requirement: Validated non-destructive import

The system SHALL validate an import file before applying it, show a deterministic summary, and merge valid data by stable repository identity without deleting local records absent from the file. For annotation conflicts, the record with the later local modification timestamp SHALL win and an equal timestamp SHALL retain the existing local record. Imported repository metadata SHALL only fill missing historical fields and MUST NOT overwrite newer synchronized GitHub metadata. Settings replacement SHALL require explicit selection in the import preview.

#### Scenario: Valid export is imported

- **WHEN** the user confirms import of a supported valid file
- **THEN** the system applies the deterministic merge rules and reports counts of added, updated, unchanged, skipped-conflict, metadata-filled, and selected settings records

#### Scenario: Imported annotation is older than local annotation

- **WHEN** an imported and existing annotation share a repository identity and the imported modification timestamp is older or equal
- **THEN** the system retains the existing local annotation and reports the imported record as unchanged or skipped-conflict

#### Scenario: Imported annotation is newer than local annotation

- **WHEN** an imported and existing annotation share a repository identity and the imported modification timestamp is newer
- **THEN** the system replaces the local annotation fields with the imported annotation and reports the record as updated

#### Scenario: Invalid or unsupported export is selected

- **WHEN** the selected file is malformed or uses an unsupported format version
- **THEN** the system rejects it without changing local data and explains the validation failure

#### Scenario: Export belongs to another GitHub account

- **WHEN** the export identifies a GitHub user ID different from the active account
- **THEN** the system rejects the merge without changing either namespace and asks the user to authenticate the matching account

### Requirement: Complete local-data removal

The system SHALL provide a separately confirmed action that deletes credentials, repository mirrors, native-list mirrors, annotations, synchronization state, and settings owned by the extension.

#### Scenario: User confirms complete removal

- **WHEN** the user confirms the complete local-data removal preview
- **THEN** the system removes all extension-owned user data and returns to the first-run signed-out state

#### Scenario: User cancels complete removal

- **WHEN** the user cancels the confirmation
- **THEN** the system changes no stored data

### Requirement: No hosted data processing

The system MUST keep MVP user data within the browser profile and MUST NOT send library or annotation data to analytics, telemetry, advertising, or application-operated backend services.

#### Scenario: Normal dashboard use

- **WHEN** the user searches, filters, triages, exports, or imports local library data
- **THEN** the operation uses only local storage except for explicit GitHub authentication and synchronization requests
