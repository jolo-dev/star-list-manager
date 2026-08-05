## Purpose

Give every starred repository a clear post-capture lifecycle so historical stars can be processed gradually and newly added stars do not disappear into an undifferentiated collection.

## ADDED Requirements

### Requirement: Deterministic first-import classification

The system SHALL classify repositories during the first complete synchronization according to their imported native-list membership.

#### Scenario: Historical star belongs to a native List

- **WHEN** the first complete star and native-list synchronization shows that a repository belongs to at least one native List
- **THEN** the system marks it reviewed and includes it in the Organized view

#### Scenario: Historical star belongs to no native List

- **WHEN** the first complete star and native-list synchronization shows that a repository belongs to no native List
- **THEN** the system places it in Backlog rather than Inbox

#### Scenario: Native Lists are unavailable during first import

- **WHEN** the first complete star synchronization succeeds but native-list capability is unavailable
- **THEN** the system places historical stars in Backlog and does not guess that they are organized

#### Scenario: Native List import is partial during first import

- **WHEN** first-import List data contains visible memberships but one or more Lists are marked partially imported
- **THEN** the system marks repositories with observed membership reviewed and Organized, places other historical repositories in Backlog, and exposes that native organization coverage is partial

### Requirement: Newly discovered stars enter Inbox

The system SHALL place a repository first discovered after the completed baseline synchronization into Inbox until the user reviews it.

#### Scenario: New external star is synchronized

- **WHEN** a later synchronization discovers a repository that was not part of the baseline
- **THEN** the repository appears in Inbox with its original GitHub star timestamp

### Requirement: Explicit triage actions

The system SHALL let the user mark a repository reviewed, return it to Backlog, snooze it until a date, add or remove local tags, edit a note, and toggle a local favorite.

#### Scenario: User marks Inbox item reviewed

- **WHEN** the user marks an Inbox repository reviewed
- **THEN** the repository leaves Inbox while remaining starred and searchable

#### Scenario: User snoozes a repository

- **WHEN** the user selects a future revisit date
- **THEN** the repository leaves active Inbox or Backlog queues and appears as snoozed until that date

### Requirement: Due-for-review resurfacing

The system SHALL expose a Due view containing starred repositories whose revisit date has arrived or passed.

#### Scenario: Snooze date arrives

- **WHEN** the current time reaches a repository's revisit date
- **THEN** the repository appears in Due without requiring a remote synchronization

#### Scenario: User completes a due review

- **WHEN** the user reviews a due repository and clears or moves its revisit date
- **THEN** the repository leaves Due immediately

### Requirement: Triage remains local-only

The system MUST NOT star, unstar, or alter native GitHub List membership as a side effect of changing triage state, tags, notes, favorites, or revisit dates.

#### Scenario: User applies local organization

- **WHEN** the user changes any local triage or annotation field
- **THEN** the system persists the local change without issuing a GitHub mutation
