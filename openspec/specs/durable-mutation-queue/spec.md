# Durable Mutation Queue Specification

## Purpose

Execute remote account mutations predictably despite browser background suspension, network ambiguity, rate limits, and partial bulk failures while keeping every job independently observable and recoverable.

## Requirements

### Requirement: Mutation jobs are persisted before execution

The system MUST durably store each confirmed mutation job, its owning stable GitHub user ID, repository identity, operation type, creation time, batch association, status, and attempt metadata before issuing a remote request.

#### Scenario: Browser stops immediately after enqueue

- **WHEN** the background context stops after a job is persisted but before its remote request begins
- **THEN** the job remains queued and can resume after the extension starts again

### Requirement: Mutation execution is account-bound

The system MUST execute a mutation job only while the active authenticated GitHub user ID matches the job owner and MUST keep other account namespaces isolated.

#### Scenario: User signs into another account with pending jobs

- **WHEN** account B becomes active while queued or retryable jobs belong to account A
- **THEN** the system leaves account A's jobs suspended and ineligible without changing their terminal outcome, sends no GitHub requests for them, and does not include them in account B's library or mutation views

#### Scenario: Active account changes during uncertain execution

- **WHEN** the active identity changes after an account A request may have started but before its outcome was finalized
- **THEN** the system sends no further account A requests, records owner-scoped recovery as suspended, and waits for account A to return before observing or retrying remote state

#### Scenario: Job owner signs in again

- **WHEN** account A becomes active again
- **THEN** the system makes account A's jobs visible and resumes queued work or owner-scoped recovery according to their existing status and retry rules

### Requirement: Remote mutations execute sequentially

The system SHALL process at most one remote mutation job at a time within the MVP queue.

#### Scenario: Bulk operation contains multiple repositories

- **WHEN** a confirmed batch creates multiple queued jobs
- **THEN** the system processes them in a deterministic order without overlapping GitHub mutations

### Requirement: Interrupted jobs recover safely

The system SHALL recover jobs left running or verifying after background termination by rechecking remote state before deciding whether to retry a mutation.

#### Scenario: Delete outcome was lost with the network response

- **WHEN** the extension restarts after a delete request may have reached GitHub but no result was recorded
- **THEN** the system checks current star state before issuing another delete request

### Requirement: Eligible work has durable wake scheduling

The system SHALL schedule queued or retryable work to resume through a browser-supported alarm and SHALL also check the queue at browser startup and authenticated extension interaction. Work is not expected to execute while the browser is closed.

#### Scenario: Background worker suspends with queued work

- **WHEN** the browser remains open and a queued or retry-waiting job has an eligible execution time
- **THEN** the system schedules a wake event and attempts to resume the queue when the browser delivers that event

#### Scenario: Scheduled wake was not delivered

- **WHEN** eligible work remains after browser restart or the next authenticated dashboard interaction
- **THEN** the system detects the durable job and restarts queue processing without requiring the user to recreate the operation

### Requirement: Retries are bounded and state-aware

The system SHALL distinguish retryable network, rate-limit, and server failures from non-retryable authorization or validation failures and SHALL expose the next permitted user or automatic action.

#### Scenario: Temporary network failure occurs

- **WHEN** a job fails with a retryable network error before its outcome is known
- **THEN** the system retains the job, records the attempt, and checks remote state before a bounded retry

#### Scenario: Authentication permission is rejected

- **WHEN** GitHub rejects a job because authentication is invalid or Starring write permission is missing
- **THEN** the system stops automatic retries, marks the job failed with a sanitized authorization explanation, and leaves local starred state unchanged

#### Scenario: GitHub rate limit is reached

- **WHEN** GitHub reports a rate limit that prevents execution
- **THEN** the queue pauses affected work until the known reset time or explicit retry eligibility and reports the pause to the user

### Requirement: Queued jobs can be cancelled before execution

The system SHALL allow a user to cancel a queued job that has not started a remote request.

#### Scenario: User cancels a queued job

- **WHEN** the user cancels a job still in queued state
- **THEN** the system marks it cancelled, skips its remote mutation, and leaves local star state unchanged

#### Scenario: User tries to cancel an active job

- **WHEN** a remote request for the job has already started
- **THEN** the system refuses to claim cancellation and continues to determine and verify the remote outcome

### Requirement: Duplicate pending mutations are prevented

The system SHALL prevent multiple active unstar jobs for the same repository from being queued simultaneously.

#### Scenario: Repository is selected by overlapping batches

- **WHEN** a new confirmation includes a repository that already has a queued, running, or verifying unstar job
- **THEN** the system reuses or reports the existing job rather than creating a duplicate remote intent

### Requirement: Partial bulk outcomes remain independent

The system SHALL report each job's result and derive a batch summary without rolling back successful jobs because another repository failed.

#### Scenario: Bulk batch partially succeeds

- **WHEN** some jobs succeed and another job fails
- **THEN** the batch shows exact succeeded, failed, blocked-unknown, queued, cancelled, and pending counts with retry actions limited to eligible jobs

### Requirement: Queue errors are sanitized

The system MUST NOT persist or display access tokens, refresh tokens, authorization headers, or raw credential-bearing responses in jobs, attempts, histories, or errors.

#### Scenario: Remote request returns a sensitive error payload

- **WHEN** an API failure includes request or credential details
- **THEN** the system stores and displays only the mapped error category, safe message, status, timing, and retry information
