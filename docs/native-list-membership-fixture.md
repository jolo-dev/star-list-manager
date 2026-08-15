# Disposable Native List Membership Fixture

Use this fixture only for development capability checks and later manual List-mutation testing of GitHub's public-preview API. Membership writes are limited to public starred repositories. The probe intentionally submits an unchanged complete membership set, but GitHub still treats it as a replace-all mutation. Never use an existing personal List, an important star, or a normal browser profile.

## Setup

1. Create or select a development-only GitHub account and open a fresh isolated browser profile.
2. Create a disposable public repository that contains no sensitive data. Use a name that clearly identifies it as temporary.
3. Star that repository from the same account that will authorize the optional OAuth App.
4. Create new disposable GitHub Lists solely for this fixture. Do not reuse, rename, empty, or delete an existing List.
5. Add only the disposable repository to any Lists needed by the test. Before probing, inspect every disposable List and record the fixture's complete membership set.
6. Record the account's stable numeric GitHub user ID and the repository GraphQL node ID. These IDs are non-secret fixture metadata; the OAuth token is not.
7. Confirm the fixture is public, starred, disposable, and isolated from all existing Lists before running the command.

```bash
env -u NODE_OPTIONS bun run probe:oauth-list-membership -- \
  --confirm-unchanged-membership-set \
  --fixture=owner/disposable-repository \
  --fixture-node-id=R_node_id \
  --github-user-id=123456
```

The script performs OAuth device flow in memory requesting `public_repo user`, validates both scopes and the expected account, verifies the exact public starred fixture, obtains two matching complete List observations, submits that unchanged canonical List ID set through the dedicated transport, and obtains a fresh independent stable read-back. It prints the device code and sanitized outcome only. It does not print or persist the OAuth token or raw GitHub responses.

A successful probe provides development evidence for schema availability, required `user` permission under the combined authorization, account ownership, the unchanged-set mutation, and independent read-back. `public_repo` alone is not evidence of membership permission. The probe does not by itself persist capability proof or enable production controls. Failed or inconclusive probes leave native Lists read-only.

## Disposable Native List Rename Fixture (not run)

Native List rename remains disabled by default. The dedicated probe is development-only and must run only from an isolated browser profile on a development-only account. It is not a no-op: it temporarily renames exactly one explicitly confirmed disposable List, reads the complete catalog independently, restores the original name through the same static transport, and independently reads the full catalog again. Never supply an existing personal List, and never use a temporary name that is already used by another List.

```bash
env -u NODE_OPTIONS bun run probe:oauth-list-rename -- \
  --confirm-disposable-list-rename \
  --list-node-id=L_disposable_node_id \
  --original-name='Disposable original name' \
  --temporary-name='Disposable temporary name 2026-08-15' \
  --github-user-id=123456
```

The explicit confirmation identifies only the disposable List node ID, its expected current/original name, a unique temporary name, and the expected stable GitHub owner ID. If executed, the script obtains same-account `public_repo user` device authorization in memory, validates the expected owner through that authorization, validates the initial full catalog fixture/name, performs the static `UpdateUserList` rename, independently enumerates the full catalog for the same node ID and temporary name, restores the original through the same static transport, and independently confirms the original name. It emits capability proof only after all stages succeed. It does not print or persist tokens, raw GraphQL responses, or unrelated catalog names.

If a temporary rename may have occurred but restoration or final read-back fails, the script reports **CLEANUP REQUIRED** and does not claim proof. Manually restore the confirmed disposable List to its original name and independently inspect GitHub before recording any result. A failed or inconclusive probe leaves native Lists read-only.

## Isolated Manual Mutation Build

Only after the relevant successful disposable probe, set `EXTENSION_PUBLIC_GITHUB_LIST_MEMBERSHIP_WRITE_ENABLED=true` in the isolated manual-test build and rebuild the extension. The membership production capability gate is otherwise off. The flag is an operator assertion that all probe criteria passed; it does not replace the probe evidence. Keep it unset for normal or release builds until all capability and manual checks pass.

`EXTENSION_PUBLIC_GITHUB_LIST_RENAME_ENABLED` is documented in `.env.example` as `false` and must remain unset/disabled for normal and release builds. It is not enabled by this implementation, and the rename probe has not been run.

The extension's OAuth boundary constructs only the static `UpdateUserListsForItem` operation from the expected GitHub account, fixture repository node ID, and complete canonical List ID set, plus the separately static owner-bound `UpdateUserList` rename operation for a validated List node ID and name. It does not accept arbitrary GraphQL documents or provide List create, visibility, or delete controls.

## Manual Add, Remove, and Move

1. Create at least three disposable Lists and place the disposable public star in two of them so one membership can remain unrelated to each tested change.
2. Preview an add, explicit remove, and move. For every repository, record the displayed current, resulting, added, removed, and unchanged Lists before confirmation.
3. Confirm that each operation submits a complete replacement set: add unions the destination, remove excludes only the selected List, and move removes the selected source and adds the destination while retaining unrelated memberships.
4. Independently inspect GitHub after each operation and compare it with the extension's repeated stable read-back. Do not rely on the mutation payload alone.
5. Before one queued operation executes, edit the fixture membership directly on GitHub. Confirm the extension writes nothing and requires a refreshed preview. For a separate run, create a controlled post-write mismatch and confirm desired-versus-observed conflict reporting and a new-preview requirement.
6. Confirm the warnings explain that List enumeration and item pagination are repeated multi-request observations, not atomic snapshots. A concurrent GitHub edit can still be overwritten or produce an unstable read-back; the extension provides no transactional isolation.
7. Confirm membership changes retain all local tags, notes, favorites, triage state, revisit dates, and review history.

## Cleanup

1. Independently inspect the fixture on GitHub and verify its List memberships still match the pre-probe complete set.
2. Remove the disposable repository from each disposable List.
3. Delete only the Lists created for this fixture.
4. Unstar and, if owned by the test account, delete the disposable repository.
5. Revoke the development OAuth App authorization and remove the isolated browser profile if it is no longer needed.
6. Verify that no pre-existing List was renamed, deleted, or had membership changed. If read-back was inconclusive, inspect GitHub manually before cleanup and do not record capability success.

Record only the fixture name, account ID, timestamps, sanitized failure category, observation counts, and pass/fail status. Never record access tokens, authorization headers, device codes, raw GraphQL errors, or raw OAuth responses.
