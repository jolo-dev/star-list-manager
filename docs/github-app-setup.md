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

Native List membership uses GitHub's public-preview GraphQL API and is limited to public starred repositories. A successful OAuth authorization alone does not enable production native List controls; it is account authorization, not release capability evidence.

`EXTENSION_PUBLIC_GITHUB_LIST_MEMBERSHIP_WRITE_ENABLED` is retired and must not be supplied. For a release, maintainers must run the existing disposable-account unchanged-complete-set probe, review its sanitized output, update and review the checked-in non-secret null-prototype evidence, and run validation and build checks. That evidence must contain exactly five verified assertions: availability schema, OAuth `user` scope, account ownership, unchanged complete-set mutation, and independent read-back. Absent, unverified, malformed, or sensitive evidence fails closed and leaves Lists read-only. Re-run this process whenever the write OAuth application or documented membership mutation changes. A released build still requires each active account's matching `public_repo` and `user` authorization, and retains the existing preview, confirmation, stable-observation, queue, and independent read-back protections. This capability changes membership among existing Lists only; it provides no List create, rename, visibility, or delete controls.

Rename has its own default-disabled build flag: `EXTENSION_PUBLIC_GITHUB_LIST_RENAME_ENABLED=false` in `.env.example`. Do not set it for a general-user or release build. A future isolated manual-test build may use it only after a separate disposable probe has proven schema availability, `user` permission, same-account ownership, an explicitly confirmed disposable List, a unique temporary name, exact independent catalog read-backs, and restoration. If temporary or restoration cleanup cannot be verified, inspect and restore the List manually before treating any proof as valid. The separate membership probe is not rename proof.
