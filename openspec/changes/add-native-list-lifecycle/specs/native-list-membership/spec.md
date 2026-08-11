## MODIFIED Requirements

### Requirement: Native List lifecycle remains limited and separate from membership management
The system MUST NOT rename a native GitHub List, change an existing List's visibility, or edit its description as part of native List membership management. Capability-gated lifecycle controls may create an empty List with user-selected public or private visibility and delete a confirmed List; membership controls remain limited to add, remove, and move repository membership among synchronized existing Lists.

#### Scenario: User manages membership after a lifecycle refresh
- **WHEN** the user opens membership controls after a verified List creation or deletion has synchronized
- **THEN** the available destinations and sources reflect the authoritative catalog, and any job referencing a deleted or changed List requires a refreshed preview
