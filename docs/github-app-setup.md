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

The extension requests `public_repo`. This scope grants broader public-repository write access than the extension uses. Production code limits the separate credential to authenticated-user Starring status, PUT, and DELETE endpoints, but that implementation boundary does not narrow GitHub's granted OAuth authority.

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
