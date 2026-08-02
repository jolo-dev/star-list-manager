## Purpose

Provide a spacious extension-owned dashboard for quickly finding, understanding, and revisiting repositories without depending on GitHub's limited stars-page search or a narrow sidebar layout.

## ADDED Requirements

### Requirement: Full-page extension dashboard

The system SHALL use a full-page extension-owned dashboard as the primary library interface and SHALL open it from the extension toolbar action.

#### Scenario: User activates the extension toolbar action

- **WHEN** the user clicks the extension toolbar action
- **THEN** the browser opens or focuses the Star List Manager dashboard

### Requirement: Built-in library navigation views

The dashboard SHALL provide the fixed built-in Inbox, Backlog, Due, Organized, All Stars, native List, and local tag views with visible result counts. User-defined saved queries are not part of this capability.

#### Scenario: User opens a saved view

- **WHEN** the user selects a library view
- **THEN** the repository result set updates locally and clearly identifies the active view

### Requirement: Local repository search

The dashboard SHALL search locally across owner, repository name, description, topics, primary language, local tags, notes, and native List names.

#### Scenario: User enters a search query

- **WHEN** the user changes the search query
- **THEN** matching repositories update without waiting for a GitHub network request

#### Scenario: No repository matches

- **WHEN** no repository satisfies the active search and filters
- **THEN** the dashboard displays an empty-result state without implying the library itself is empty

### Requirement: Composable filters and sorting

The dashboard SHALL support combining filters for triage state, star state, native List, local tag, language, archived or disabled state, star date, and push date, with sorting by name, star date, push date, and review date.

#### Scenario: User combines filters

- **WHEN** the user selects multiple compatible filters
- **THEN** the result set contains only repositories satisfying all active filters and shows each active constraint

#### Scenario: User clears filters

- **WHEN** the user clears active filters
- **THEN** the current view returns to its unfiltered repository set while preserving the selected sort order

### Requirement: Repository inspection

The dashboard SHALL display repository identity, description, language, topics, star and activity dates, archive state, native List memberships, local tags, note, favorite state, and triage state for a selected repository.

#### Scenario: User selects a repository

- **WHEN** the user opens a repository from a result list
- **THEN** the dashboard presents its synchronized metadata and editable local annotations with a link to GitHub

### Requirement: Explicit loading and failure states

The dashboard SHALL distinguish first-run, signed-out, loading, empty-library, ready, partial-native-list, stale-data, and recoverable-error states.

#### Scenario: Star synchronization fails after prior success

- **WHEN** the latest synchronization fails but a previous complete library exists
- **THEN** the dashboard keeps the previous library usable and labels it stale with a retry action

### Requirement: Page-context isolation

The core dashboard SHALL function without injecting a content script into GitHub or any other website.

#### Scenario: Content-script permission is absent

- **WHEN** the extension is installed with no page injection permission
- **THEN** authentication, synchronization, triage, search, annotations, export, and import remain available in extension-owned pages
