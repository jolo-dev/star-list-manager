# native-list-import Specification

## Purpose

Import GitHub's native Star Lists as a compatibility view so users retain their existing organization while the local-first product remains useful if the preview API is unavailable.

## Requirements

### Requirement: Native List capability detection

The system SHALL determine whether the authenticated account and token can query native GitHub Star Lists before treating the capability as available.

#### Scenario: Native Lists are available

- **WHEN** GitHub accepts the viewer List query and returns a valid response
- **THEN** the system enables native-list views and begins paginated list synchronization

#### Scenario: Native Lists are unavailable

- **WHEN** GitHub rejects the query, removes the schema, or returns an unsupported capability response
- **THEN** the system marks native-list integration unavailable while keeping star import, local organization, and search operational

### Requirement: Import list metadata

The system SHALL import each accessible native List's stable ID, name, description, visibility when available, timestamps, slug when available, and reported item count.

#### Scenario: List metadata spans multiple pages

- **WHEN** the account has more lists than fit in one response page
- **THEN** the system follows list pagination until all accessible List metadata is imported

### Requirement: Import public repository memberships

The system SHALL import accessible public-repository membership for every synchronized native List and associate membership by repository node ID.

#### Scenario: Repository belongs to multiple Lists

- **WHEN** the same repository node ID appears in multiple native Lists
- **THEN** the system records every membership and exposes all associated Lists in repository views

#### Scenario: List contains inaccessible items

- **WHEN** GitHub reports more List items than the extension can access under public-only permissions
- **THEN** the system marks the List as partially imported and does not infer details about inaccessible repositories

### Requirement: Reconcile native List changes

The system SHALL update imported metadata and memberships to match the latest complete native-list synchronization.

#### Scenario: List is renamed

- **WHEN** a known List ID is returned with a different name or description
- **THEN** the system updates that List without losing its local references or membership relationships

#### Scenario: List is deleted on GitHub

- **WHEN** a complete native-list synchronization no longer contains a previously imported List
- **THEN** the system removes the active native List and its memberships while preserving repository records and local annotations

### Requirement: Core native-list integration is read-only

The system MUST NOT create, rename, delete, or change membership of a native GitHub List as part of this change.

#### Scenario: User inspects native membership

- **WHEN** the user opens a repository or native List in the core dashboard
- **THEN** the system displays synchronized membership without issuing a GitHub mutation
