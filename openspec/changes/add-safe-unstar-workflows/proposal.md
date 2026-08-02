## Why

Search and triage are incomplete if users cannot safely remove stars they no longer want. Unstarring changes the authoritative GitHub account, so single and bulk operations need stronger confirmation, persistence, verification, and failure reporting than local annotation actions.

## What Changes

- Add single-repository and bulk unstar actions to the dashboard.
- Require an operation preview that names every affected repository and clearly distinguishes remote GitHub changes from local-only actions.
- Persist unstar jobs before execution and process them sequentially so browser background termination cannot lose intent or obscure partial completion.
- Verify each GitHub unstar result before changing local starred state.
- Preserve annotations and append operation history after successful or externally completed unstars.
- Add retry, cancellation-before-execution, partial-batch reporting, and sanitized failure behavior.
- Do not add automatic unstar, list deletion, destructive rules, or an Undo promise that silently re-stars repositories.

## Capabilities

### New Capabilities

- `safe-unstar`: Explicit single and bulk unstar previews, confirmations, verification, and history behavior.
- `durable-mutation-queue`: Persisted sequential mutation execution, restart recovery, retry, cancellation, and partial-batch status behavior.

### Modified Capabilities

None.

## Impact

- Extends the core dashboard with selection, destructive-action preview, mutation status, retry, and history surfaces.
- Extends background messaging and IndexedDB with mutation commands, durable jobs, attempts, and operation results.
- Uses documented REST `DELETE /user/starred/{owner}/{repo}` and the corresponding star-status check endpoint.
- Requires the authenticated GitHub App user token to have Starring write permission.
- Depends on the stable repository identity, authentication, storage, and synchronization contracts from `build-star-manager-core`.
