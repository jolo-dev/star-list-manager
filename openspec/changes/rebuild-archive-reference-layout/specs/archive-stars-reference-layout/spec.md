# Archive.Stars Reference Layout

## ADDED Requirements

### Requirement: Centered editorial dashboard frame
The dashboard SHALL render every workspace inside a centered Archive.Stars editorial frame with a desktop maximum width of 1440px, a 96px top header, and real primary dashboard destinations. The frame SHALL contain exactly one main landmark and SHALL remain usable at narrow widths.

#### Scenario: Library frame exposes real destinations
- **WHEN** a ready dashboard mounts
- **THEN** its header exposes real Library, Operations, and Settings navigation controls
- **AND** activating each control uses the existing view behavior
- **AND** exactly one main landmark remains present.

### Requirement: Real archive index and records
The ready Library SHALL render real local directory data and real repository data as a compact archive index and dense, divided repository records. It SHALL NOT add sample data, fake pagination, or decorative controls that duplicate an existing behavior.

#### Scenario: Repository interaction survives layout rebuild
- **WHEN** a user focuses, selects, or opens a repository record
- **THEN** the existing row button, data identifier, keyboard navigation, selection state, and inspection dialog behavior remain available.

### Requirement: Every dashboard state shares archive grammar
Loading, signed-out, error, Operations, Settings, confirmation, and inspection states SHALL remain inside the Archive.Stars frame and retain their existing required actions, safety disclosure, roles, focus behavior, and targeted status semantics.

#### Scenario: Safe confirmation remains actionable
- **WHEN** a user opens an unstar confirmation
- **THEN** its no-undo safety copy, confirm action, cancel action, and modal behavior remain available
- **AND** the layout does not dispatch a mutation before confirmation.

### Requirement: Reference layout is responsive and accessible
The Archive.Stars layout SHALL use a wide directory/archive grid, dense metadata records, and a narrow-screen sequential flow without clipping, hiding routes, or removing accessible focus. It SHALL remain self-contained, support dark mode, forced colors, and reduced motion.

#### Scenario: Narrow screen preserves controls
- **WHEN** the viewport is at or below 700px
- **THEN** directory, controls, and repository facts reflow without horizontal clipping
- **AND** interactive touch targets remain at least 44px where required.
