# Disposable Native List Lifecycle Fixture

Use this procedure only to verify the fixed native GitHub List create/delete mutations for a development build. It is not a normal product workflow. The probe creates and deletes a List; never run it against a personal List, a shared account, or a normal browser profile.

## Disposable setup

1. Create or select a development-only GitHub account and open a fresh isolated browser profile.
2. Ensure the account has no List with the exact proposed disposable fixture name. Choose a unique, clearly temporary name, for example `Disposable lifecycle 2026-08-20`.
3. Choose **public** or **private** deliberately. The visibility is an explicit fixture input and must be recorded with the sanitized result.
4. Confirm that the account, name, and visibility are disposable and that deleting the created List is safe. The fixture must be empty; do not add repositories to it.
5. Record the account's stable numeric GitHub user ID. It is fixture metadata, not a credential.
6. Configure only the public OAuth client ID described in [GitHub authentication setup](./github-app-setup.md). Never put an OAuth token, device code, authorization header, or raw API response in notes, screenshots, commits, or reports.

Run the probe only after this confirmation:

```bash
env -u NODE_OPTIONS bun run probe:oauth-list-lifecycle -- \
  --confirm-disposable-list-lifecycle \
  --fixture-name='Disposable lifecycle 2026-08-20' \
  --visibility=private \
  --github-user-id=123456
```

The confirmation flag and all three fixture arguments are required exactly once. The script authorizes in memory, validates the expected account, reads the complete paginated `viewer.lists` catalog, confirms that the requested name is absent, creates one empty List through the fixed create mutation, and reads the complete catalog again. It requires the returned stable List ID, exact name, and exact visibility to appear. It then calls the fixed delete mutation once for only that returned ID and requires a final complete catalog observation in which that ID is absent.

The script never logs an OAuth token or raw GraphQL/HTTP response. It does not accept arbitrary GraphQL, URLs, variables, descriptions, renames, or visibility updates. Ambiguous create or delete results are never automatically replayed.

## Evidence review and validation

A successful probe is evidence only that the configured OAuth App and build exposed the tested lifecycle surface. It does **not** authorize an end user and does not replace the matching active-account OAuth credential and `public_repo user` scope checks required for every production write.

Before a release maintainer records any lifecycle capability evidence:

1. Independently inspect GitHub and confirm the returned List ID is absent and no pre-existing List was changed.
2. Retain only non-secret facts: pass/fail status, timestamp, account ID, explicit fixture name and visibility, and sanitized failure category if applicable. Do not retain tokens, device codes, authorization headers, raw responses, or unrelated catalog entries.
3. Review the sanitized probe result, independent cleanup check, fixed mutation documents, and the focused probe/release-evidence tests.
4. Only after manual verification, update the dedicated checked-in lifecycle release-evidence input with the exact reviewed null-prototype proof shape, review that change, and run validation and build checks. Until then it must remain `null`, which leaves lifecycle controls disabled.
5. Re-run the complete procedure whenever the write OAuth App, lifecycle mutation documents, catalog observation, or release build input changes.

## Cleanup and failures

On success, independently verify that the returned stable List ID is absent. On any failure after creation, especially a response-lost or failed delete outcome, treat the script's **CLEANUP REQUIRED** message as authoritative: manually inspect GitHub, locate only the List created by this probe using its returned ID and confirmed fixture metadata, delete it manually if it remains, and independently verify absence through GitHub before recording evidence or rerunning a probe.

Do not delete a List based only on a matching name. Do not retry an ambiguous mutation automatically. If the create outcome is unknown and no returned ID is available, inspect the disposable account manually before doing anything else. Remove the isolated browser profile and revoke the development OAuth authorization when the verification session is complete.
