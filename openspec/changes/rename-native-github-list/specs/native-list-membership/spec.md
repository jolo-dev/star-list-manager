## MODIFIED Requirements

### Requirement: Native List lifecycle remains out of scope

The system MUST NOT create, change visibility of, or delete native GitHub Lists as part of this capability. The system MAY rename an existing native GitHub List only through the separately capability-gated, inline, verified rename flow. The available remote membership actions remain limited to add, remove, and move repository membership among existing Lists.

#### Scenario: User manages membership

- **WHEN** the user opens membership controls
- **THEN** the available remote actions are limited to add, remove, and move repository membership among existing Lists

#### Scenario: User inspects a List without rename capability

- **WHEN** the user opens a native List while the rename capability is unavailable
- **THEN** the system displays the imported List as read-only and exposes no lifecycle action

#### Scenario: User has verified rename capability

- **WHEN** the user opens an existing selected native List and the rename capability is available
- **THEN** the system exposes only the separately specified inline Rename action and does not expose create, visibility, or delete actions
