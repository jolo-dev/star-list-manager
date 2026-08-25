# Native List lifecycle probe evidence — 2026-08-25

## Sanitized fixture

- Probe time: `2026-08-25T17:47:35Z`
- Source commit: `e8a26a6d4bae2aa07922ef10f34e1dfa5056918e`
- Expected GitHub user ID: `54506108`
- Fixture name: `Disposable lifecycle 2026-08-25`
- Explicit visibility: public
- Operator confirmation: the fixture was deliberately disposable and safe to create and delete

## Sanitized result

- OAuth account ownership: verified
- Required OAuth scope: verified
- Fixed `createUserList` mutation: succeeded
- Independent complete-catalog create read-back: verified the returned stable List identity, exact name, and public visibility
- Fixed `deleteUserList` mutation: invoked once for only the stable identity returned by creation
- Independent complete-catalog delete read-back: verified that returned identity was absent
- Separate cleanup inspection: the operator confirmed through GitHub that `Disposable lifecycle 2026-08-25` was absent and no pre-existing List was changed

No OAuth token, device code, authorization header, client identifier, returned List ID, raw API response, or unrelated catalog entry is retained in this evidence.

## Release status

This probe evidence verifies the disposable fixture path only. Isolated Chrome and Firefox profile verification remains pending under task 8.3. The checked-in lifecycle release-evidence input therefore remains `null`, and production lifecycle controls remain disabled until task 8.4 is separately reviewed and completed.
