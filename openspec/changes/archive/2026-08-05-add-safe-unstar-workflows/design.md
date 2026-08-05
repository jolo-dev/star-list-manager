## Context

This change follows `build-star-manager-core`, which establishes background-owned read-only GitHub access, stable repository node IDs, local annotations, IndexedDB, and synchronization. The core capability spike proved its GitHub App token cannot call the REST star write endpoint, so this change cannot be applied until a separate write-auth change is approved, implemented, and verified. Unstarring is the first feature that intentionally changes the user's authoritative GitHub state. Extension background contexts can stop at any time, and a network failure after sending a request can leave the local client uncertain whether GitHub applied it.

The documented REST API provides a delete endpoint and a star-status check. The design uses both so local starred state is never updated solely from a request attempt or optimistic UI assumption.

## Goals / Non-Goals

**Goals:**

- Make single and bulk unstar intent explicit and auditable.
- Preserve queue correctness across browser restarts and ambiguous network outcomes.
- Verify GitHub state before committing local unstar success.
- Keep successful jobs successful when another job in the same batch fails.
- Build a mutation queue foundation reusable by the later native-list mutation change.

**Non-Goals:**

- Automatic cleanup rules or unstar recommendations that execute without confirmation.
- Parallel mutation execution.
- Re-starring, Undo, or transactional rollback of a completed GitHub unstar.
- Native-list membership mutation.
- Removing annotations or history when a repository is unstarred.

## Decisions

### Persist intent before network activity

Confirmation creates a batch record and one job per repository in a single local transaction. Only after the transaction commits may the queue runner send a request. Jobs contain owning stable GitHub user ID, repository node ID, mutation type, batch ID, timestamps, status, attempt count, current owner/name observation, and sanitized result fields; they never contain credentials. The runner claims only jobs whose owner matches the active authenticated identity.

This ordering ensures closing the dashboard or terminating the background worker cannot produce an untracked remote request.

Alternative considered: execute directly from the confirmation dialog. It reduces storage code but cannot recover or explain operations interrupted by the MV3 lifecycle.

### Use a globally sequential queue

One runner claims one eligible job at a time. Sequential execution reduces rate-limit pressure, keeps batch progress understandable, and avoids multiple destructive requests racing for the same account. A durable lease or claimed-at marker prevents duplicate runners from processing the same job. The queue schedules the next eligible time with the cross-browser alarms API and also checks for durable work on browser startup and authenticated extension interaction; it does not claim to execute while the browser is closed.

The later native-list change can add another mutation kind to the same queue while preserving single-job execution.

### Check before delete and verify after delete

Each unstar job follows this state machine:

```text
queued
  |
  v
resolve current public route and verify node ID
  | unresolved or changed
  +------------------------> blocked-unknown
  |
  v
check current star state
  | route-level not found
  v
converged full star observation by node ID
  | absent                  | unstable / unavailable
  +------> succeeded-external  +------> blocked-unknown
  |
  v
delete star
  |
  v
verify with converged full star observation
  | absent                  | still starred / unstable
  v                         v
succeeded                retryable-failed, failed, or blocked-unknown
```

The pre-check makes retries idempotent when a previous delete succeeded but its response was lost. Current routing is resolved by stable node ID and revalidated, but a route-level `404` only triggers the core star convergence process; it never establishes success by itself. Only omission of the node ID from two consecutive complete account observations verifies absence. While another account is active, the job is suspended and no further request is sent. After the owning account returns, route changes, repository unavailability, or unstable observations produce `blocked-unknown`. Verification uses bounded attempts and respects rate-limit information.

Alternative considered: mark success on HTTP 204 and rely on the next full sync. That produces misleading local state when verification or eventual API behavior differs and makes partial batches harder to explain.

### Commit local star state and history transactionally

After verified success, one local transaction marks the repository unstarred, finalizes the job, updates the batch summary inputs, and appends immutable operation history. An already-unstarred pre-check uses the same transaction but records the result as externally completed. Annotations remain in their separate store.

### Recover active jobs by observation, not blind retry

On startup, jobs left in running or verifying states become recovery candidates only when their owning GitHub user ID is active. If another account is active, they remain suspended with owner-scoped recovery pending. When the owner returns, the runner resolves and revalidates the repository's current route, then uses converged full star observation by node ID to determine whether the account still stars it. If absent, it finalizes success. If present, it decides whether a delete is still eligible. Routing change, unavailable repository, or unstable observation then produces `blocked-unknown`. This handles service-worker termination and account switching without sending a request under the wrong identity.

`blocked-unknown` is terminal for automatic processing of the current attempt only while the owning account is active, is counted separately in batch summaries, and is retained in history. Account mismatch is temporary suspension, not a terminal outcome. After an explicit library refresh, the owner may manually retry a blocked-unknown job, which creates another attempt and repeats stable-ID observation.

### Separate jobs from batches

A batch records the owning GitHub user ID, confirmed repository set, and summary metadata. Each repository job owns its status and retries. Batch status is derived from job statuses, including a separate blocked-unknown count, allowing partial completion and retry of only eligible failures. Successful remote changes are never rolled back to make the batch appear atomic.

### Allow cancellation only before remote execution

Queued jobs may be cancelled. Once a job is claimed and its pre-check or mutation begins, the system cannot guarantee that a remote change has not occurred; the UI therefore continues verification rather than presenting a false cancellation.

### Keep the dashboard pessimistic about starred state

The UI may immediately show queued or processing status, but the repository remains in starred views until verification commits success. Selection is cleared or retained independently from star state. This favors truthful account state over a faster-looking optimistic transition.

### Use structured sanitized errors

Attempts store a category such as network, rate-limit, authentication, permission, validation, verification mismatch, or GitHub server failure plus safe status, timestamps, and retry eligibility. Raw response bodies and request headers are not persisted.

## Risks / Trade-offs

- [Extra status checks increase API usage] -> Run sequentially, use bounded verification, and pause on rate limits; correctness is more important than minimizing two small requests per destructive action.
- [A 404 star-status result can reflect not-starred, stale routing, or an unavailable repository] -> Revalidate route identity and use converged full star observations keyed by node ID; otherwise record blocked-unknown and never claim verified success.
- [Retained jobs can outlive the authenticated account session] -> Namespace batches, jobs, history, mirrors, and annotations by stable GitHub user ID and block execution for non-active identities.
- [The browser can stop between GitHub success and local commit] -> Recover by checking current remote state before any retry.
- [Bulk operations are slower sequentially] -> Show per-job progress and allow the dashboard to close while durable work continues.
- [No Undo can feel restrictive] -> Preserve annotations and history, make confirmation specific, and add re-star only through a separately verified capability.
- [Token permission can change while jobs are queued] -> Stop automatic retries on authorization failures and require reauthentication or permission correction.

## Migration Plan

1. Extend the core database with mutation batch, job, attempt, and operation-history stores through a versioned migration and add the cross-browser alarms permission for durable wake scheduling.
2. Add queue messages and background runner behavior with fake GitHub transport tests before exposing dashboard controls.
3. Add single-repository selection and confirmation, then bulk selection and batch summaries.
4. Enable real REST requests only after the separate write-auth change passes an unstar probe on disposable fixtures.
5. Verify recovery by terminating the background context at each job state and confirming no duplicate destructive outcome.
6. Roll back by disabling new mutation creation while leaving stored jobs and history readable; do not delete unresolved intent silently.
