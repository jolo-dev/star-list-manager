# Hide Successful Unstars from Overview

## Goal

Remove repositories from the main Unlist/Overview view after GitHub unstar has been independently verified, while retaining local annotations and operation history.

## Root Cause

The Unlist view currently overrides the default `starred` filter with `all`. Consequently, any unstarred repository without native List membership remains visible, and its retained latest mutation job renders a terminal `Succeeded` badge.

## Design

The Unlist/Overview view will use the normal selected star-state filter, whose default is `starred`, instead of forcing `all`.

After a verified unstar updates the repository to `isStarred: false`, the repository will disappear from the default Unlist/Overview result set. It will remain locally stored and discoverable when the user explicitly selects `Star state → Unstarred history`; its annotations and remote-operation history remain unchanged.

Queued, checking, deleting, verifying, retry-waiting, failed, and blocked operations do not mark the repository unstarred, so their repositories remain visible and actionable. Native List membership operations do not change star state and remain unaffected.

## Data Flow

1. The durable unstar runner independently verifies remote absence.
2. Existing storage finalization records `isStarred: false`, preserves annotations, and retains operation history.
3. Dashboard state re-renders from the returned authoritative snapshot.
4. The default Unlist query applies `starState: starred`, excluding the completed unstar.
5. An explicit Unstarred-history filter applies `starState: unstarred`, making the retained record available for review.

## Testing

Update the dashboard DOM regression test to prove:

- default Unlist includes starred repositories without native List membership;
- default Unlist excludes an unstarred repository with a successful retained job;
- explicit `Unstarred history` reveals that retained repository;
- listed repositories remain excluded from Unlist;
- normal views still honor explicit star-state filters.

Run the focused dashboard test first, then the complete test suite, typecheck, and Chrome build inspection.

## Scope

This change alters only query selection for Unlist/Overview. It does not delete repository records, annotations, batches, jobs, attempts, or history; change mutation execution; hide failed or pending operations; or alter GitHub List membership behavior.
