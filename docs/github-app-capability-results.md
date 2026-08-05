# GitHub App capability results

Verified against the development GitHub App on 2026-08-03. No access token, refresh token, device code, or authorization header was retained in this file.

## Read-only device-flow probe

- Device authorization completed successfully for the development app.
- The device-flow access token included a refresh token.
- Refresh succeeded without a client secret.
- The refreshed token authenticated the expected GitHub identity.
- `GET /user/starred?per_page=1` returned an authenticated public-star response.
- GraphQL `viewer.lists(first: 1)` succeeded and reported 21 native Lists.

Command:

```bash
bun run spike:github-app
```

## Disposable mutation probe

The intended permission envelope does not support the later write changes:

- REST `PUT /user/starred/{owner}/{repo}` returned HTTP 403 for the GitHub App user token.
- GraphQL `CreateUserList` was rejected because the user did not have the correct permission.
- GraphQL `UpdateUserListsForItem` was rejected with the same permission failure even when called with an empty complete membership set.
- The `updateUserListsForItem` probe used `octocat/Spoon-Knife`, which was temporarily starred through the existing local `gh` authorization only to create an isolated no-membership fixture.
- The probe attempted no existing List ID and changed no existing List membership.
- The temporary star was removed after every attempt, including failures and expired device codes.

Conclusion: the registered GitHub App is sufficient for the read-only core, but the planned write changes need a revised and separately verified authentication permission model before implementation.

## Starring write follow-up

An isolated follow-up evaluated whether upgrading the same GitHub App could provide the narrow write boundary required by the proposed mutation roadmap. Temporary test tooling required an explicit disposable repository and retained no credentials.

On 2026-08-03 and 2026-08-04, fresh device authorizations still did not produce independently verified removal and restoration of the disposable `octocat/Spoon-Knife` star. After the GitHub App was confirmed as **Starring: Read and write** with mandatory **Metadata: Read-only**, the REST write response remained HTTP 403 and reported the accepted GitHub App permission set as `starring=write,metadata=read`. Independent checks confirmed that the fixture never changed, and the temporary star used for the probe was removed afterward through the existing local `gh` authorization.

Conclusion: the current GitHub App user-token design remains unverified for arbitrary public-star writes despite the documented permission configuration. The product remains read-only, no write capability or mutation control is packaged, and the development GitHub App should remain configured with Starring read-only permission.

## OAuth App Starring probe

The project now contains a separate OAuth App device-flow implementation requesting `public_repo` and an isolated destructive probe. The probe requires explicit fixture confirmation, stable GitHub user and repository node IDs, complete paginated star observations, two-observation convergence for removal, and verified restoration.

Command shape:

```bash
env -u NODE_OPTIONS bun run probe:oauth-starring -- \
  --confirm-disposable \
  --fixture=owner/name \
  --fixture-node-id=R_node_id \
  --github-user-id=123456
```

On 2026-08-04, the development OAuth App completed device authorization for the expected stable GitHub user ID with `public_repo`. The confirmed public fixture was `octocat/Spoon-Knife`, matched stable repository node ID `MDEwOlJlcG9zaXRvcnkxMzAwMTky`, and was explicitly prepared as disposable.

The probe successfully:

- removed the fixture star through the exact authenticated-user Starring DELETE route
- observed complete paginated public-star results converging to absence twice
- restored the fixture through the exact Starring PUT route
- observed complete results converging to presence twice
- independently confirmed the fixture remained starred afterward

An isolated Chromium profile also verified the local disclosure and Cancel path, matching-account authorization, account-bound `public_repo` storage, absence of token material in the DOM, and write-only disconnect while retaining read authentication. No browser console errors were observed. No access token, device code, authorization header, or raw OAuth response was retained in this evidence.
