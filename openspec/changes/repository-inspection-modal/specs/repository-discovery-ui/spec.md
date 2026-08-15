## MODIFIED Requirements

### Requirement: Repository inspection

The dashboard SHALL open an accessible modal dialog when a user activates a repository from a result list. The dialog SHALL present the selected repository's identity, description, language, topics, star and activity dates, archive state, native List memberships, local tags, note, favorite state, triage state, existing GitHub write controls, operation history, and a link to GitHub. The dashboard SHALL NOT render a persistent repository inspector or empty inspection placeholder beside the result list.

The dialog SHALL provide an explicit close action, support Escape-key dismissal when no nested confirmation is active, move focus into the dialog when it opens, and return focus to the repository result that invoked it when it closes.

#### Scenario: User selects a repository

- **WHEN** a user opens a repository from a result list
- **THEN** the dashboard opens a modal dialog containing that repository's synchronized metadata, local annotation controls, and existing GitHub account-change controls with a link to GitHub
- **AND THEN** the library result view does not display a persistent inspector or inspection placeholder

#### Scenario: User closes repository inspection

- **WHEN** a user activates the modal close action or presses Escape while the repository dialog has no nested confirmation
- **THEN** the dashboard dismisses the repository dialog without changing repository data
- **AND THEN** keyboard focus returns to the repository result that opened the dialog

#### Scenario: User uses existing controls in the repository dialog

- **WHEN** a user changes a local annotation or starts an existing List-membership or unstar confirmation from the repository dialog
- **THEN** the system preserves the same validation, confirmation, queueing, and remote-verification behavior as the prior repository inspector
