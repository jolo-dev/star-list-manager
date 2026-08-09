## Context

This change follows the read-only native List import from `build-star-manager-core`, the durable sequential queue from `add-safe-unstar-workflows`, and the separately stored account-bound OAuth credential from `add-oauth-starring-write-auth`. GitHub's public GraphQL schema exposes `updateUserListsForItem(itemId, listIds)`, where `listIds` is the complete replacement set. The schema does not expose an additive mutation, a conditional expected-version input, or an obvious reverse repository-to-Lists connection.

Consequently, safe behavior requires reconstructing current membership from the user's Lists, deriving a complete target set, detecting preview staleness, and verifying the observed result. The reconstruction itself spans multiple requests and is not a point-in-time snapshot. The design uses bounded repeated observations to establish stability, but it still cannot guarantee preservation of edits made concurrently during observation or after the final observation.

## Goals / Non-Goals

**Goals:**

- Provide understandable add, remove, and move operations for existing native Lists.
- Preserve unrelated memberships in the final stable observation before mutation.
- Refuse mutation when the complete target set cannot be determined.
- Detect stale confirmations before writing and verification mismatches afterward.
- Reuse durable sequential execution and per-repository batch outcomes.
- Reuse the existing optional OAuth credential without exposing a general-purpose GraphQL write surface.

**Non-Goals:**

- Promise serializable or transactionally isolated behavior across GitHub and the extension.
- Create, rename, change visibility of, or delete native Lists.
- Manage private repositories.
- Use cookies, GitHub DOM scraping, or undocumented internal endpoints.
- Automatically retry a destructive membership conflict without renewed confirmation.
- Permit arbitrary OAuth-authenticated GraphQL documents or non-membership REST writes.

## Decisions

### Represent user intent separately from complete observed membership

A membership job records owning stable GitHub user ID, repository node ID, operation kind, requested additions, requested removals, optional move source and destination, confirmed before-set, confirmed target-set, observation fingerprint, relevant List catalog fingerprint, and timestamps. The catalog fingerprint covers referenced List ID, existence, name, and visibility. The requested delta describes user intent; the complete sets and catalog make the confirmation and later comparison auditable.

This separation allows the UI to explain a move as one removal plus one addition and lets execution detect whether remote state changed after confirmation.

### Build stable membership observations from all current Lists

Because the public schema does not provide a reverse membership connection on Repository, one observation must enumerate current Lists and inspect their paginated item connections to build a repository-to-List reverse index. An observation is complete only when List metadata and every required item page finished successfully under the same synchronization run. It is not atomic because GitHub can change while those requests are in flight.

The system requires two consecutive complete observations with identical selected-repository membership sets and relevant List catalog fingerprints before calling the result stable. A bounded mismatch retries the observation; persistent mismatch blocks preview, write, or verification as unstable. For a bulk preview, each repeated full refresh can build observations for all selected public repositories. Execution compares each job with the latest stable observation and relevant catalog before writing. Partial or interrupted scans never prove membership absence.

Alternative considered: trust the local imported membership set. It is faster but can remove memberships changed directly on GitHub since the last sync.

### Extend the OAuth boundary with one structured GraphQL operation

The core capability spike proved that its device-flow GitHub App token is denied `CreateUserList` and `UpdateUserListsForItem`, including an empty no-op membership set. A real no-op probe then confirmed that GitHub requires the OAuth `user` scope for `UpdateUserListsForItem`; `public_repo` alone is insufficient. The existing optional OAuth App flow therefore requests and validates both `public_repo` and `user`, while retaining stable-account matching, separate storage, and background-only access. The UI discloses that both scopes grant broader authority than the implementation uses. This change adds a dedicated owner-bound membership transport that constructs one static `UpdateUserListsForItem` document internally and accepts only a repository node ID plus a complete canonical List ID set. Callers cannot provide a URL, GraphQL document, operation name, or unrelated variables, and the Starring transport remains separately allowlisted.

Before production controls are enabled, a development capability probe uses an explicitly approved disposable public star. It reads a complete stable membership set, submits that same set as a no-op replacement through the OAuth transport, obtains a fresh independent stable read-back, and records only sanitized evidence. Schema absence, permission denial, identity mismatch, or inconclusive read-back leaves membership controls disabled. Real add, remove, and move verification remains a later isolated-profile release step.

### Use pure set operations for intent calculation

The target calculation is deterministic:

```text
add:    target = live union additions
remove: target = live minus removals
move:   target = (live minus source) union destination
```

All sets are deduplicated and compared independent of order. A move requires source membership. Additions already present and removals already absent are reported as no-ops. The calculation functions remain independent of storage, UI, and GraphQL so critical preservation behavior can be exhaustively tested.

### Require exact preview information

Preview generation uses a stable remote observation and shows each repository's current set, desired set, additions, removals, and unchanged memberships. Add is the primary action. Removal and move use destructive styling and explain that GitHub replaces the complete membership set.

Bulk previews show per-repository effects because repositories can begin with different memberships. The confirmation stores a canonical sorted fingerprint of each observed before and desired set plus the relevant List catalog entries so rename, deletion, or visibility changes invalidate stale display assumptions.

### Pause rather than rebase a stale confirmed job

Before sending the mutation, the runner obtains the latest stable observation and compares its canonical membership set and relevant List catalog fingerprint with the confirmed values. If either differs, the job enters `needs-confirmation`; it does not automatically rebase even for additive intent. The dashboard generates a refreshed preview from the newly observed set, current valid Lists, and the original requested delta.

This prioritizes exact user understanding over convenience and avoids silently changing the confirmed complete effect.

Alternative considered: automatically merge additive jobs. It can preserve memberships but creates two confirmation semantics and still changes the displayed result after the user approved it.

### Extend the queue with confirmation-aware membership states

Membership jobs reuse persisted batches, attempts, claiming, sequential execution, restart recovery, rate-limit handling, and sanitized errors. They add observation, mutating, read-back, `needs-confirmation`, unstable-observation, and `verification-conflict` outcomes.

Only one active remote mutation runs globally. Every job and batch is namespaced by owning stable GitHub user ID, and only the active identity's work is eligible. Work belonging to another identity is temporarily suspended, including owner-scoped recovery after a request may have started; it is not terminalized as a conflict. The queue prevents overlapping active mutations for the same repository within that namespace, including an unstar and a membership change. A membership job becomes ineligible if the repository is no longer starred before execution.

### Verify through an independent stable post-mutation observation

The mutation submits the repository node ID and the complete desired List IDs. The returned List payload is decoded and recorded but is not the sole verification. The runner obtains a fresh stable membership observation and compares its canonical set to the desired set.

On a match, one local transaction updates memberships, finalizes the job, and appends history. On a mismatch, local membership is updated to the newly observed authoritative state, the job records desired and observed sets, and any retry requires a new preview and confirmation.

### Make the concurrency boundary explicit

List enumeration, item pagination, the replace-all mutation, and read-back are separate GitHub requests without an expected version. Repeated matching observations reduce but do not eliminate the possibility of edits during traversal. A GitHub edit after the final stable observation can be overwritten even if post-write verification matches the extension's desired set, and an edit during verification can make the result appear unstable. Because even additive assignment sends a replace-all set, every add, remove, and move confirmation states this limitation; destructive styling remains reserved for removals and moves. The implementation minimizes the intervals but does not claim an impossible guarantee.

### Keep local annotations independent

Changing native membership does not change local tags, notes, favorite, triage status, or revisit date. Membership success may affect the derived Organized view but not the stored review history unless the user explicitly performs a triage action.

## Risks / Trade-offs

- [Stable membership observation can be expensive] -> Build a reverse index during complete List refreshes, repeat only within a bounded policy, process sequentially, expose progress, and stop on GraphQL rate limits.
- [The API is public preview] -> Capability-gate queries and mutations, decode defensively, and keep local organization functional in read-only mode.
- [Concurrent GitHub edits can alter an observation or be overwritten] -> Require consecutive matching observations, minimize observation-to-write time, require stale-preview reconfirmation, verify afterward, disclose the limitation, and avoid automatic destructive retries.
- [Partial List scans can falsely imply absence] -> Refuse writes unless bounded complete observations stabilize.
- [Bulk jobs can become stale while waiting] -> Revalidate each repository before execution and pause only affected jobs for reconfirmation.
- [An unstar can race a membership job] -> Prevent overlapping active jobs for one repository and recheck starred state before List mutation.
- [GraphQL mutation payload may change] -> Validate it explicitly and rely on an independent read-back rather than trusting payload shape alone.
- [`public_repo` and `user` grant authority beyond implemented writes] -> Use the isolated credential only through the static membership operation and existing exact Starring routes, disclose both scopes, and reject arbitrary OAuth requests locally.

## Migration Plan

1. Extend the existing account-bound OAuth credential through the dedicated membership transport and record a successful no-op mutation plus independent read-back with a disposable fixture.
2. Add pure membership set operations and exhaustive preservation tests before adding queue or UI behavior.
3. Extend queue and history schemas with membership intent, canonical observations, needs-confirmation, unstable-observation, and conflict details through a versioned migration.
4. Add bounded consecutive membership observation refresh and GraphQL mutation clients using fake transports and fixture accounts.
5. Add single-repository additive assignment, then removal and move previews, then bulk behavior.
6. Test service-worker termination, stale previews, post-write mismatch, rate limits, external List edits, and interaction with pending unstar jobs.
7. Roll back by disabling new membership mutation controls while preserving read-only List import, stored jobs, conflicts, and operation history.
