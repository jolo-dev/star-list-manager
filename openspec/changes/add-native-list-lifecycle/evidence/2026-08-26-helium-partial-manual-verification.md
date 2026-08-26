# Partial native List lifecycle manual verification — 2026-08-26

## Scope

- Browser: Helium `151.0.7922.169` using the production Chrome artifact in a fresh isolated profile
- Tested source commit: `bc2301c5b10205b1441ccc0dc9001e0f7e333947`
- Expected GitHub user ID: `54506108`
- Disposable fixture: `Disposable Chrome public 2026-08-25`
- Explicit visibility: public
- Repository safety fixture: one operator-approved public repository that was already starred

The temporary build enabled the reviewed lifecycle probe proof only inside an isolated `/tmp` source copy. The checked-in release input remained `null` throughout.

## Verified outcomes

- Read-only device authorization and separate `public_repo user` write authorization completed for the expected account.
- The inline `+` control created the exact empty public fixture only after preview and explicit confirmation.
- Complete authoritative read-back showed the created fixture with the requested name, public visibility, and zero items before reporting success.
- An operator-driven empty List deletion also completed with verified read-back; it was not counted as completion of the uniquely named fixture procedure.
- After the approved repository was added through GitHub's own UI, ordinary synchronization imported a complete one-item fixture while the repository remained starred.
- The populated deletion dialog displayed the exact List name, public visibility, one reported repository, no-undo wording, and the statement that repositories remain starred but become unlisted.
- A stale populated confirmation detected an external count change, sent no delete mutation, and required refresh plus renewed confirmation.
- After the fixture was repopulated, deletion was confirmed once. GitHub inspection showed the fixture absent, and an independent public-star observation showed the repository remained starred.
- Authoritative reconciliation removed the deleted fixture and its membership without removing the repository record.
- The isolated profile disconnected read and write authorization before shutdown and was deleted. The temporary enabled build and its local environment-file symlink were also deleted.

## Defects and incomplete checks

- Native List membership assignment through the extension received a sanitized GitHub permission denial twice. Both attempts remained terminal, authoritative observation showed no membership change, and no automatic retry occurred. The approved repository was populated through GitHub's own UI so deletion safety could still be tested.
- Interrupting the populated delete after dispatch exposed a recovery defect in the tested build: the one-shot alarm was consumed during the original drain, and a later worker evaluation did not receive `runtime.onStartup`. Complete synchronization removed the remotely absent fixture locally, but the operation remained in `verifying` until the existing lifecycle alarm was triggered manually. That alarm finalized the original single-attempt delete through observation without replaying it.
- The recovery defect was fixed after the live test in commit `1eb986c` by immediately checking durable work whenever the service worker registers lifecycle wake events. The regression test failed before the fix and passed afterward. Specification and code-quality reviews approved the fix, and the corrected committed tree passed 548 tests, source checks, type checking, Chrome and Firefox builds, and build inspection. The corrected build has not yet repeated the live interruption scenario.
- Private List creation/deletion was not tested.
- Firefox manual verification was explicitly skipped by the operator.

Because the membership permission failure, corrected-build interruption rerun, private flow, and Firefox flow remain unresolved, task 8.3 remains incomplete. Task 8.4 must remain incomplete and the checked-in lifecycle release-evidence input must remain `null`.

No OAuth token, device code, authorization header, client identifier, stable List ID, raw API response, or unrelated List/catalog entry is retained in this evidence.
