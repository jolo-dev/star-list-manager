## MODIFIED Requirements

### Requirement: Built-in library navigation views

The dashboard SHALL render GitHub Lists as its only sidebar navigation section. The section SHALL always be present and SHALL contain a derived **Unlist** view first, followed by imported native GitHub List views in alphabetical name order with visible result counts. The dashboard SHALL NOT render Triage, Local tags, or Utilities sections or their navigation entries in the sidebar.

Unlist SHALL include every locally stored repository, whether currently starred or retained after unstar, that has zero currently stored native-List memberships. Unlist SHALL be a local derived view rather than a GitHub List and SHALL NOT create, modify, or synchronize a remote List. The dashboard SHALL make Unlist its initial view and identify it as derived from the local library.

#### Scenario: User opens a saved view

- **WHEN** the user selects a library view
- **THEN** the repository result set updates locally and clearly identifies the active view

#### Scenario: User opens Unlist

- **WHEN** the user selects Unlist
- **THEN** the dashboard displays every locally stored repository with no currently stored native-List membership
- **AND THEN** the result set includes retained unstarred History repositories that meet that condition
- **AND THEN** the dashboard identifies the view as locally derived rather than a remote GitHub List

#### Scenario: Repository belongs to one or more native Lists

- **WHEN** a repository has one or more currently stored native-List memberships
- **THEN** the repository is excluded from Unlist
- **AND THEN** it remains available from each matching imported native GitHub List view

#### Scenario: Native Lists are unavailable or no memberships are stored

- **WHEN** the local library has repositories but native Lists are unavailable, stale, partial, or currently have no stored memberships
- **THEN** GitHub Lists and Unlist remain available in the sidebar
- **AND THEN** Unlist reflects only the currently stored memberships, including all locally stored repositories when none are stored
- **AND THEN** the dashboard does not claim that the derived result proves current remote GitHub membership

#### Scenario: Sidebar contains imported native Lists

- **WHEN** the local snapshot contains imported native GitHub Lists
- **THEN** Unlist appears before those List entries
- **AND THEN** the imported List entries appear in alphabetical name order with their visible counts

#### Scenario: User opens the dashboard

- **WHEN** the dashboard renders a ready local library
- **THEN** Unlist is the initial active view
- **AND THEN** the sidebar does not expose Triage, Local tags, Utilities, Operations, Settings, or Unstarred History navigation entries
