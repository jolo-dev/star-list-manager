## Context

Native Lists are currently read through the authenticated read-only GitHub App credential and mirrored in IndexedDB. Confirmed repository membership writes use a separately stored, account-matched OAuth credential and a narrowly allowlisted `updateUserListsForItem` GraphQL transport. The dashboard intentionally excludes List creation and deletion. GitHub's public GraphQL schema currently exposes `createUserList(input: { name, description?, isPrivate? })` and `deleteUserList(input: { listId })`; creation returns a `UserList`, while deletion returns no deleted List object.

Issue #4 adds lifecycle management. Jay selected explicit public/private visibility at creation and chose to support deleting both empty and populated Lists. A populated List deletion must remove only the remote List: repositories remain starred and merely lose that List membership.

## Goals / Non-Goals

**Goals**

- Create an empty native List with an explicit public/private choice.
- Delete empty and populated Lists using proportionate confirmation and exact stable List identity.
- Keep GitHub authoritative through post-mutation catalog synchronization and read-back.
- Preserve all repository records and local organization data.
- Keep the OAuth write surface account-bound, static, and auditable.
- Never blindly replay an ambiguous create or delete request.

**Non-Goals**

- Rename, description edit, existing visibility change, or List reordering.
- Add repository membership during List creation.
- Unstar, re-star, or create/delete repositories.
- Support private-repository metadata beyond the existing public-only import policy.
- Claim transactional isolation from concurrent GitHub List changes.

## Decisions

### Use a dedicated lifecycle service behind the existing OAuth boundary

Add `src/github/list-lifecycle-write-session.ts`, separate from the membership session. It exposes two typed methods only:

```text
createList({ expectedGitHubUserId, name, visibility })
deleteList({ expectedGitHubUserId, listNodeId })
```

It owns three static GraphQL documents: the minimum capability probe, `CreateUserList`, and `DeleteUserList`. The caller cannot supply GraphQL, URLs, descriptions, mutation IDs, or arbitrary inputs. It reuses the existing account ownership, token-type, scope, HTTP, GraphQL-error classification, and secret-sanitization rules. This preserves the deliberate boundary instead of broadening `ListMembershipWriteSession` into a generic OAuth GraphQL client.

### Independently prove lifecycle mutations with a disposable fixture

Membership capability proof does not prove different GraphQL mutations. Add `scripts/oauth-list-lifecycle-capability-probe.ts`: after operator confirmation of a disposable unique name and explicit visibility, it creates a List, reads the catalog until the returned stable ID appears with matching name and visibility, deletes that same ID, and reads until it is absent. The script stores/prints sanitized evidence only. Any failed deletion provides cleanup guidance and keeps production lifecycle controls disabled.

### Persist a dedicated singleton lifecycle operation

The repository-oriented mutation queue currently assumes every job has a repository ID and a batch. Rather than weakening its data model with fake repository values, add a versioned `nativeListLifecycleOperations` store and a `NativeListLifecycleRunner`. Each account has at most one active lifecycle operation, and it shares a global native-List mutation lock with membership jobs. The operation records:

- kind (`create` or `delete`), account ID, creation time, phase, sanitized error, and recovery state;
- create intent (trimmed name and explicit visibility), returned candidate List ID, and catalog verification result;
- delete target List ID plus confirmed name, visibility, reported item count, and import status;
- all preflight/read-back observation timestamps and fingerprints.

This keeps lifecycle history durable without falsifying repository-oriented operation history. The dashboard gets dedicated lifecycle status rather than trying to render a List operation as a repository mutation.

### Verify creation by returned stable ID, not name

GitHub may allow name collisions. After a successful create response, synchronize the authoritative catalog and verify the returned List ID, requested name, and requested visibility. Only reconciliation from that sync writes local List rows. If the response is lost, the extension cannot safely identify a newly created List by name, so it records an unknown outcome and never retries automatically.

### Delete by stable ID with revalidation and stronger populated confirmation

A delete preview retains the List ID plus fresh metadata. Immediately before dispatch, refresh complete catalog metadata. If the List is gone, report `already-deleted`; if name, privacy, or reported count differs, pause for renewed confirmation. The UI has two paths:

- Empty List: standard confirmation naming the exact List and noting no undo.
- Populated List: destructive confirmation naming the exact List and reported item count; it requires the user to affirm deletion of that named List, makes partial import visible, and says repositories remain starred but are removed from that List.

After delete success or interrupted recovery, synchronize the catalog and require the stable List ID to be absent. Reconciliation removes List metadata and memberships only. A response-lost or present-after-readback outcome is never auto-retried.

### Lifecycle and membership share catalog invalidation

Creating a List has no membership side effects; it becomes selectable only after read-back. Deletion invalidates queued membership work that references the deleted List. It must move those jobs to refreshed preview rather than attempt the stale complete List ID set. A global native-List write lock prevents lifecycle deletion racing a membership replace-all mutation.

### UI uses a List management surface instead of the repository inspector

Provide a `Manage GitHub Lists` control in the List navigation area or a dedicated management dialog. It remains available when the catalog is empty. The create form has a trimmed name and mandatory public/private radio selection. Each known List exposes delete. Controls state their capability readiness and sync state, disable during active lifecycle/membership writes, preserve focus, and use semantic dialogs/alerts.

## Risks / Trade-offs

- **GitHub preview schema changes** → capability probe, defensive decoding, and read-only fallback.
- **Broad OAuth scopes** → same existing `public_repo user` disclosure, dedicated static documents, and no general GraphQL transport.
- **Ambiguous POST outcomes** → catalog observation and no automatic replay; this may require user inspection but avoids duplicate creation or unexpected deletion.
- **External List edits** → pre-delete fresh catalog check, confirmations tied to fingerprints, post-write reconciliation.
- **Partial public-only import** → show GitHub-reported count and partial status during destructive confirmation; delete affects the List remotely but never deletes repositories.
- **Deletion racing membership updates** → one global native-List mutation lock and stale preview invalidation.

## Migration Plan

1. Add the lifecycle types, IndexedDB versioned store, migration tests, background messages, and a no-op disabled state without enabling controls.
2. Implement and test the narrow lifecycle OAuth session and its disposable fixture probe.
3. Implement the persisted lifecycle runner, authoritative sync/read-back, interruption recovery, and shared List mutation lock.
4. Add accessible create/delete dialogs, empty/populated confirmations, status, refresh, and membership invalidation.
5. Complete fake-transport, IndexedDB, DOM, service-worker recovery, and isolated-profile fixture verification before enabling the public build flag.
6. Roll back by disabling lifecycle controls; retain read-only List import, local data, and sanitized operation records for inspection.
