## Why

Issue #2's repository move control is present but disabled in the released extension. The native List membership implementation, OAuth authorization, confirmation flow, stable observations, and remote verification already exist. However, the background service only enables the capability when a manually supplied build variable, `EXTENSION_PUBLIC_GITHUB_LIST_MEMBERSHIP_WRITE_ENABLED=true`, is present. A build can therefore contain verified, working mutation code while silently shipping the feature unavailable.

## What Changes

- Replace the manually remembered public build flag with checked-in, reviewable release capability evidence generated from the existing disposable unchanged-set and independent read-back probe.
- Enable native GitHub List membership writes in a release only when that evidence declares the configured write OAuth application and documented GraphQL mutation verified.
- Keep user-level authorization as a separate runtime gate: the active account still needs a matching OAuth credential with `public_repo` and `user` scopes.
- Preserve existing stable membership observation, add/remove/move preview, explicit confirmation, account ownership, sequential execution, stale-preview handling, and post-mutation read-back.
- Make the disabled state explain whether the blocker is missing release evidence or missing account authorization; do not leave an otherwise valid move flow disabled without actionable status.

## Non-Goals

- Run a mutation probe automatically for each user or during ordinary extension use.
- Expand the OAuth surface, request additional scopes, use arbitrary GraphQL, or use undocumented GitHub endpoints.
- Relax move safeguards, replace-all membership semantics, confirmation, stable-observation requirements, or post-write verification.
- Change unstar behavior; it remains governed by its existing independent write capability gate.

## Capabilities

### New Capabilities

<!-- None. -->

### Modified Capabilities

- `native-list-membership`: Enable existing membership actions from verified release evidence rather than a manually supplied public build flag.
- `oauth-starring-write-auth`: Distinguish release-level List membership capability evidence from an active account's runtime authorization readiness.

## Impact

- Updates the build/runtime capability configuration, the background capability gate, dashboard readiness copy, probe-to-evidence workflow, and automated tests.
- Does not alter IndexedDB schemas, GitHub mutation documents, OAuth credential storage, or the durable membership job format.
