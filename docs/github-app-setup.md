# GitHub authentication setup

The extension uses separate device-flow applications for read and optional write access. Client IDs are public and may be included in the extension build; never add a client secret.

## Read-only GitHub App

1. Open GitHub **Settings > Developer settings > GitHub Apps > New GitHub App**.
2. Use a development-specific name and the project repository as the homepage URL.
3. Disable webhooks unless a later change explicitly requires them.
4. Under **Account permissions**, grant **Starring: Read-only**.
5. Grant no repository or organization permissions.
6. Create the app, open its settings, and enable **Device flow**.
7. Copy `.env.example` to `.env.local` and set:

   ```text
   EXTENSION_PUBLIC_GITHUB_CLIENT_ID=your_public_client_id
   ```

The `.env.local` file is ignored by Git. Do not create or store a client secret for the extension.

## Optional OAuth App

1. Open GitHub **Settings > Developer settings > OAuth Apps > New OAuth App**.
2. Use a development-specific name and the project repository as the homepage URL.
3. Use a local placeholder authorization callback URL; device flow does not redirect the extension through it.
4. Create the OAuth App and enable **Device flow** in its settings.
5. Set the public client ID in `.env.local`:

   ```text
   EXTENSION_PUBLIC_GITHUB_WRITE_CLIENT_ID=your_oauth_app_client_id
   ```

The extension requests `public_repo user`. `public_repo` grants broader public-repository write access than the extension uses. `user` grants broader read/write profile authority, including email and follow subscopes, but is required by GitHub for native List writes; the extension implements no profile, email, or follow requests. Production code limits the separate account-matched credential to authenticated-user Starring status, PUT, and DELETE endpoints; one static, internally constructed `UpdateUserListsForItem` document accepting only a repository node ID and complete canonical List IDs; and one static owner-bound `UpdateUserList` document accepting only an existing List ID and validated name. Callers cannot provide another URL, GraphQL document, operation name, or unrelated variables. Neither implementation boundary narrows GitHub's granted OAuth authority. Previously stored account-matched `public_repo`-only credentials remain usable only for Starring and require reauthorization before either native List operation. Credentials must never be shown in the dashboard, logs, exports, screenshots, or reports.

Users can remove only this credential in extension Settings or revoke the OAuth App under GitHub **Settings > Applications > Authorized OAuth Apps**.

## Capability verification

Use an explicitly confirmed disposable public starred repository for OAuth Starring verification. Record its stable repository node ID before running:

```bash
env -u NODE_OPTIONS bun run probe:oauth-starring -- \
  --confirm-disposable \
  --fixture=owner/name \
  --fixture-node-id=R_node_id \
  --github-user-id=123456
```

The probe verifies the OAuth identity, exact public fixture and node ID, removes the star, requires two complete observations of absence, restores the star, and requires two complete observations of presence. If restoration cannot be verified, follow the printed manual cleanup guidance and do not claim capability success.

The read-only GitHub App verification covers:

- device-code authorization and identity validation
- access-token refresh without a client secret
- `GET /user/starred` with public repositories only
- read-only GraphQL `viewer.lists` access

Do not use an important repository as the OAuth fixture and never include tokens or raw authorization responses in recorded evidence.

Native List membership uses GitHub's public-preview GraphQL API and is limited to public starred repositories. It has a separate unchanged-complete-set probe; follow the disposable repository and List isolation steps in [`native-list-membership-fixture.md`](native-list-membership-fixture.md). A successful OAuth authorization alone does not enable production native List controls or the separately guarded rename control.

The production membership build gate is off unless `EXTENSION_PUBLIC_GITHUB_LIST_MEMBERSHIP_WRITE_ENABLED` is exactly `true`. Set it only for an isolated build after the schema, `user` permission, account ownership, unchanged-set mutation, and independent stable read-back all succeed with the combined `public_repo user` authorization. The probe does not persist or enable this gate. Leave the variable unset to retain read-only Lists, and do not enable it for a release that has not completed the disposable and manual fixture checks. This capability changes membership among existing Lists only; it has no List create, delete, or visibility functions and does not enable rename.

Rename has its own default-disabled build flag: `EXTENSION_PUBLIC_GITHUB_LIST_RENAME_ENABLED=false` in `.env.example`. Do not set it for a general-user or release build. A future isolated manual-test build may use it only after a separate disposable probe has proven schema availability, `user` permission, same-account ownership, an explicitly confirmed disposable List, a unique temporary name, exact independent catalog read-backs, and restoration. If temporary or restoration cleanup cannot be verified, inspect and restore the List manually before treating any proof as valid. The separate membership probe is not rename proof.
