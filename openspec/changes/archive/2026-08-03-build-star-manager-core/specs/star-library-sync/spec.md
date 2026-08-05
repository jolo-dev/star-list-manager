## Purpose

Maintain a reliable local mirror of the authenticated user's public GitHub stars so the library remains searchable and reconcilable without treating local metadata as GitHub-owned state.

## ADDED Requirements

### Requirement: Import public starred repositories

The system SHALL import every accessible public repository starred by the authenticated user, including its GitHub node ID, current owner/name, URL, description, topics, primary language, star timestamp, push timestamp, archive state, and disabled state.

#### Scenario: Initial star import completes

- **WHEN** the authenticated user starts the first synchronization
- **THEN** the system follows all result pages, deduplicates by node ID, and records a baseline only after the full public-star observation satisfies the convergence requirement

#### Scenario: Private repository is encountered

- **WHEN** an API response contains a private repository during the public-only MVP
- **THEN** the system does not persist its metadata and records that an inaccessible or out-of-scope item was skipped

### Requirement: Stable repository identity

The system MUST identify a repository by its GitHub node ID and SHALL treat owner/name as mutable display and API-routing data.

#### Scenario: Repository is renamed or transferred

- **WHEN** a later synchronization returns an existing node ID with a different owner or name
- **THEN** the system updates the existing repository record without creating a duplicate or detaching local annotations

### Requirement: GitHub star state is authoritative

The system SHALL reconcile local star state against converged complete GitHub observations while preserving app-owned annotations and history.

#### Scenario: Repository was unstarred outside the extension

- **WHEN** a complete synchronization no longer contains a previously starred repository
- **THEN** the system marks it as no longer starred only after omission is confirmed by the convergence requirement and retains its local notes, tags, review history, and last-known metadata

#### Scenario: Repository was starred outside the extension

- **WHEN** a synchronization discovers a public star not present in the completed baseline
- **THEN** the system adds the repository and exposes it to the triage workflow as a newly discovered star

### Requirement: Paginated observations must converge

The system MUST treat REST pagination as a non-atomic observation and MUST obtain two consecutive complete observations with identical public repository node ID sets before establishing the baseline or reconciling omitted repositories as unstarred.

#### Scenario: Star state changes between pages

- **WHEN** consecutive complete observations contain different repository node ID sets because stars changed during pagination
- **THEN** the system does not mark omitted repositories unstarred, reports an unstable synchronization attempt, and retries only within a bounded policy

#### Scenario: Consecutive observations agree

- **WHEN** two consecutive complete observations contain the same public repository node ID set
- **THEN** the system commits the converged observation as the latest authoritative local star set

#### Scenario: Observations do not stabilize

- **WHEN** the bounded convergence attempts finish without two matching complete observations
- **THEN** the system preserves the previous authoritative set, may retain safely observed metadata additions, and reports that omission reconciliation was deferred

### Requirement: Synchronization status and recovery

The system SHALL expose synchronization progress, completion time, pages processed, rate-limit information when available, and the most recent sanitized error.

#### Scenario: Synchronization is interrupted

- **WHEN** the browser closes, the background context stops, or a network request fails before a complete scan finishes
- **THEN** the system retains the last complete library as authoritative and reports that the current attempt did not complete

#### Scenario: GitHub rate limit prevents completion

- **WHEN** GitHub refuses further requests because of rate limiting
- **THEN** the system stops retrying, preserves existing data, and displays the known reset time or a generic retry-later state

### Requirement: Explicit synchronization controls

The system SHALL synchronize on authenticated dashboard startup when data is stale and SHALL provide a manual refresh action without requiring continuous background polling.

#### Scenario: User manually refreshes

- **WHEN** the user invokes refresh while no synchronization is running
- **THEN** the system starts a new synchronization and displays its progress

#### Scenario: Refresh is requested during an active synchronization

- **WHEN** the user invokes refresh while synchronization is already running
- **THEN** the system keeps one active synchronization and does not start duplicate requests
