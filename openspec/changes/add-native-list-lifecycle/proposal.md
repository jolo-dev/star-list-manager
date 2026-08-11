## Why

Issue #4 requires users to create and remove their native GitHub Star Lists from Star List Manager and have the dashboard synchronize the authoritative GitHub result. The current product imports Lists read-only and intentionally permits only repository membership mutations. Users must leave the extension to create a category or to remove one they no longer need.

## What Changes

- Add creation of an empty native GitHub List using an explicitly selected public or private visibility.
- Add removal of native GitHub Lists. Users may delete an empty List or a populated List; populated deletion receives stronger destructive confirmation and leaves every repository starred but no longer in that List.
- Add a narrow, account-bound OAuth GraphQL lifecycle transport that constructs only `createUserList` and `deleteUserList`, alongside the existing allowlisted membership mutation.
- Require a separate disposable-fixture capability probe for lifecycle mutations before lifecycle controls are enabled.
- Persist lifecycle operations, reconcile ambiguous failures safely, and refresh the native List catalog after every resolved create or delete so local metadata and memberships reflect GitHub.
- Add a List management UI available even when the account currently has no Lists.

## Non-Goals

- Rename a List, change an existing List's visibility, or edit descriptions (rename is tracked separately in issue #3).
- Add repositories while creating a List; new Lists are empty and existing membership controls remain the way to organize repositories.
- Modify a repository's starred status, local annotations, tags, notes, favorites, triage state, revisit date, or review history.
- Use GitHub DOM scraping, cookies, undocumented endpoints, or arbitrary OAuth-authenticated GraphQL.

## Capabilities

### New Capabilities

- `native-list-lifecycle`: Capability-gated, verified creation and deletion of native GitHub Lists.

### Modified Capabilities

- `native-list-import`: Reconcile local List metadata and memberships after verified lifecycle changes rather than treating the integration as permanently read-only.
- `oauth-starring-write-auth`: Extend the exact OAuth allowlist to the two lifecycle GraphQL mutations after independent disposable-fixture verification.
- `native-list-membership`: Keep repository membership actions limited to existing Lists while allowing newly synchronized Lists to appear as destinations and deleted Lists to invalidate pending work.

## Impact

- Extends the background protocol, persisted mutation/history records, OAuth write boundary, GraphQL decoding, native List synchronization, dashboard controls, and tests.
- Uses GitHub's public-preview `createUserList` and `deleteUserList` mutations. They require the existing account-matched optional OAuth credential with `public_repo user`; no extra scope is requested.
- Updates README, privacy/store copy, OAuth setup, and isolated-profile manual test guidance with lifecycle permissions, confirmation, no-undo, and synchronization behavior.
