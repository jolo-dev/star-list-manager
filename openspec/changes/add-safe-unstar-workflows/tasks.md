## 1. Extend the mutation data model

- [ ] 1.1 Confirm `build-star-manager-core` is implemented and its repository, authentication, storage, and background message contracts are available before applying this change.
- [ ] 1.2 Define account-bound mutation batch, job, attempt, operation-history, temporary account-suspended recovery, blocked-unknown, status, error-category, and retry-eligibility domain types without storing credential material.
- [ ] 1.3 Add a versioned IndexedDB migration for batches, jobs, attempts, and history with indexes for owning GitHub user ID, status, repository node ID, batch ID, and next eligible execution time.
- [ ] 1.4 Implement transactional enqueue, claim, status transition, cancellation, attempt recording, finalization, and batch-summary storage operations with migration and rollback tests.

## 2. Implement typed REST unstar operations

- [ ] 2.1 Add current public repository route resolution and route revalidation by stable node ID plus authenticated star-status and unstar REST methods using confirmed owner/name routing data and sanitized typed responses.
- [ ] 2.2 Map route-level `404` to a required converged full star observation by node ID, and map confirmed absence, blocked-unknown, authentication, permission, rate-limit, server, network, and malformed-response outcomes without treating ambiguous `404` as success.
- [ ] 2.3 Implement bounded post-delete verification and tests for immediate success, delayed visibility, persistent mismatch, rate limits, and unavailable repositories.
- [ ] 2.4 Verify real write access against a disposable public starred repository only after the development GitHub App Starring-write capability probe has passed.

## 3. Build the durable sequential queue

- [ ] 3.1 Implement atomic batch and job enqueue so all confirmed intent is persisted before the queue runner starts network work.
- [ ] 3.2 Implement an account-bound single-runner claim mechanism, deterministic sequential processing, browser alarm scheduling for next eligibility, and queue checks on browser startup and authenticated extension interaction.
- [ ] 3.3 Implement unstar execution as pre-check, conditional delete, post-check, and transactional local finalization with immutable history.
- [ ] 3.4 Suspend queued and mid-flight owner-scoped recovery while another account is active; when the job owner returns, revalidate routing and require converged full star observation by node ID before any repeated delete request, finalizing blocked-unknown only when repository identity, routing, availability, or observations remain unresolved.
- [ ] 3.5 Implement bounded retry scheduling for network and server failures, reset-time pausing for rate limits, and stopped retries for authentication, permission, validation, or exhausted attempts.
- [ ] 3.6 Prevent duplicate active unstar jobs for one repository and return the existing job reference to overlapping batches or requests.
- [ ] 3.7 Implement queued-job cancellation and reject cancellation once remote execution has begun.

## 4. Add unstar confirmation and progress UI

- [ ] 4.1 Add single and multi-row selection without changing repository star state or local annotations.
- [ ] 4.2 Build an unstar confirmation that identifies the action as a GitHub account change and shows the exact count and complete owner/name list.
- [ ] 4.3 Enqueue confirmed selections through typed background messages and create no jobs when confirmation is cancelled.
- [ ] 4.4 Display queued, checking, deleting, verifying, succeeded, externally completed, failed, blocked-unknown, retry-waiting, and cancelled job states.
- [ ] 4.5 Display independently derived succeeded, failed, blocked-unknown, queued, cancelled, and pending batch counts and per-repository outcomes, with automatic retry excluded for blocked-unknown jobs.
- [ ] 4.6 Keep repositories in active starred views until verified success, then move them to history while retaining all annotations.
- [ ] 4.7 Add account-namespaced repository and global operation-history views including blocked-unknown outcomes without offering an unverified Undo or re-star control.

## 5. Test failure and lifecycle behavior

- [ ] 5.1 Unit-test account ownership, temporary identity-mismatch suspension, owner return, state transitions, invalid transitions, duplicate prevention, blocked-unknown batch summaries, cancellation, retry limits, and error sanitization.
- [ ] 5.2 Integration-test an ambiguous delete response followed by converged stable-ID observation that detects remote success without a duplicate delete; route and observation failures become blocked-unknown only with the owner active, while account switches before request, after request, and before read-back suspend until owner-scoped recovery.
- [ ] 5.3 Integration-test browser termination before claim, during route resolution and pre-check, after delete, during verification, and before local finalization, including alarm and startup wake behavior.
- [ ] 5.4 Test partial bulk completion, dashboard closure during execution, extension restart, authentication expiry, reauthentication, and rate-limit resume.
- [ ] 5.5 Test annotation and triage-history preservation after successful, externally completed, failed, and cancelled operations.

## 6. Verify permissions, builds, and documentation

- [ ] 6.1 Run static checks, typecheck, unit and integration tests, and Chromium and Firefox builds with Extension.js telemetry disabled.
- [ ] 6.2 Inspect built manifests and bundles to confirm the only new extension permission is the intended alarms capability and that no new host permission, credential exposure, analytics, remote code, or packaged secret was introduced.
- [ ] 6.3 Manually verify single unstar, bulk unstar, cancellation, partial failure, restart recovery, permission failure, rate limiting, stale owner/name refresh, and history in isolated test profiles.
- [ ] 6.4 Update user and store documentation with destructive-action semantics, verification behavior, no-Undo limitation, retained local annotations, and retry guidance.
