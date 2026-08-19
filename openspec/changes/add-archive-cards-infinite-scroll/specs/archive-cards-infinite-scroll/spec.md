# Archive Cards and Infinite Local Results

## ADDED Requirements

### Requirement: Real List and Cards result modes
The Library SHALL expose accessible real List and Cards controls. Both modes SHALL render the same locally filtered and sorted repository data and retain real row/card selection and inspection behavior.

#### Scenario: User switches result mode
- **WHEN** a user activates Cards or List
- **THEN** the selected control exposes current state
- **AND** matching real repository data renders in the chosen mode
- **AND** no remote message is dispatched.

### Requirement: Progressive local result rendering
The Library SHALL progressively render bounded batches from its existing local result set when a local end sentinel intersects. It SHALL reset to the initial batch whenever query or result source changes and SHALL offer an accessible fallback when intersection observation is unavailable.

#### Scenario: More local results are revealed
- **WHEN** the end sentinel intersects and unrendered local matches remain
- **THEN** the next local batch is appended
- **AND** no network pagination or fake loading result is introduced.
