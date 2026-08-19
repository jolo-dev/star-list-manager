## ADDED Requirements

### Requirement: Archive presentation preserves local discovery behavior

The dashboard SHALL present existing local repository discovery controls within the Archive.Stars application frame without changing their data source or semantics. Local search, view selection, sorting, filtering, result counts, refresh, repository inspection, and fixed destination navigation SHALL continue to operate from the current local application state and SHALL NOT require a GitHub request except where the pre-existing explicit action already does.

#### Scenario: User searches or filters the archive

- **WHEN** a user changes the search text, library view, sort order, or supported filter control
- **THEN** the visible archive entries and result count update using the existing local query behavior
- **AND THEN** the Archive.Stars presentation clearly retains the selected view and available controls

#### Scenario: User refreshes from the archive frame

- **WHEN** a user activates the existing refresh action
- **THEN** the dashboard follows the existing synchronization and status behavior
- **AND THEN** the visual presentation does not conceal loading, stale-data, partial-data, or recoverable-error information
