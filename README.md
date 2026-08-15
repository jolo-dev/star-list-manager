# Star List Manager

Star List Manager is a local-first browser extension for searching, triaging, and revisiting public GitHub stars. It imports native GitHub Lists read-only and keeps notes, tags, favorites, review state, and revisit dates inside the browser profile.

## Scope

- Chromium and Firefox extension-owned dashboard.
- Read-only GitHub App device-flow authentication without a client secret or pasted token.
- Optional, separately stored OAuth App authorization restricted to confirmed Starring writes, one structured native List membership mutation, and one owner-bound native List rename mutation.
- Public starred repositories only. Private repository metadata is not persisted.
- Read-only native GitHub List import through GitHub's public-preview GraphQL API.
- Previewed add, remove, and move membership actions for public starred repositories among existing Lists. There are no native List create, delete, or visibility functions.
- A guarded native List rename implementation exists for an existing List, but it is disabled by default. It remains unavailable unless a separate disposable rename probe has succeeded and a manual, isolated-build gate has been deliberately applied; membership proof never enables rename.
- Explicit single and bulk unstar controls use a durable sequential queue, remote verification, and operation history.
- No automatic cleanup rules, re-star, or Undo. Production native List membership controls are disabled by default until the separate capability gate is deliberately enabled after successful fixture verification.
- No backend, hosted synchronization, analytics, advertising, or content scripts.

## Permissions

- `storage`: saves credentials, synchronized public metadata, local annotations, and settings in the browser profile.
- `alarms`: wakes eligible persisted unstar jobs while the browser remains open.
- `https://github.com/login/*`: performs GitHub device authorization and token refresh.
- `https://api.github.com/*`: reads the authenticated user's public stars, identity, and available native Lists.

The GitHub App requests user-level Starring read permission and implicit public-resource access. It does not request repository, organization, private-repository, content, Gist, or write permission.

Optional write authorization uses a separate GitHub OAuth App and requests `public_repo user`. GitHub defines both scopes broadly: `public_repo` can write more public-repository resources than Star List Manager uses, while `user` grants read/write profile authority, including email and follow subscopes. The extension stores that token separately, validates that it belongs to the active GitHub user, and permits it only through exact authenticated-user Starring status, star, and unstar routes; the static `UpdateUserListsForItem` membership mutation; or the static owner-bound `UpdateUserList` rename mutation. It implements no profile, email, or follow requests, arbitrary GraphQL, or caller-provided URLs. The membership transport accepts only an expected account, repository node ID, and complete canonical List ID set. The rename transport accepts only the expected account, an existing List node ID, and a validated name. Neither accepts caller-provided documents, operation names, or unrelated variables. Previously stored account-matched `public_repo`-only credentials remain limited to Starring and cannot enable membership or rename writes.

Unstar confirmation identifies the operation as a GitHub account change and lists every affected repository. Confirmed jobs are stored before network work, execute one at a time, and keep repositories in active starred views until complete observations verify remote absence. Successful unstars retain metadata, notes, tags, favorites, triage, and history. There is no Undo because restoring a GitHub star requires a separately confirmed remote write.

Native List membership previews show each affected repository's current, resulting, added, removed, and unchanged Lists. Add unions destinations into the observed set, remove excludes only explicit selections, and move removes one source and adds one destination. GitHub's mutation is replace-all rather than additive: every operation submits the complete desired membership set and preserves unrelated memberships from the final stable pre-write observation.

Membership discovery and read-back enumerate the List catalog and paginated items repeatedly, requiring two consecutive complete matching observations. These multi-request observations are not atomic and provide no transactional isolation from concurrent GitHub edits. A changed membership or referenced List before execution pauses without writing and requires a refreshed preview and confirmation; after a write, an independent stable read-back verifies the complete set. A mismatch records desired versus observed memberships, updates the local mirror to the observed GitHub state, and requires a new preview before retry. Native membership changes retain local tags, notes, favorites, triage state, revisit dates, and review history.

## Local Data

Credentials and library data remain in extension-owned browser storage. Browser-profile storage is not an operating-system keychain. Read and optional write tokens are stored separately and never rendered in the dashboard, written to logs, or included in exports; they are isolated from unrelated hosts, but a compromised browser profile can expose extension storage. Never paste tokens into issues, screenshots, or other reports.

Settings can disconnect only optional write access while retaining read-only synchronization. Disconnect GitHub removes both active credentials while retaining local library data. A separate confirmed action removes all credentials and extension-owned data. Versioned JSON export/import supports moving one active account namespace between browser profiles; see [`docs/export-format.md`](docs/export-format.md).

Native GitHub Lists use a public-preview GraphQL capability. The extension remains useful with local organization if that capability is unavailable or partially visible.

Queued jobs may be cancelled only before remote execution begins. Network and server failures retry within a bounded policy, rate-limited work waits for the known reset, and authorization failures require corrective action. `Blocked unknown` means repository identity or remote star state could not be verified; it is not retried automatically and never changes local starred state.

## Development

Install dependencies with Bun 1.3.14:

```bash
bun install --frozen-lockfile
```

Create `.env.local` with public client IDs for a read-only GitHub App and a separate OAuth App for optional Starring, native List membership, and guarded rename writes. Both apps must have device flow enabled:

```text
EXTENSION_PUBLIC_GITHUB_CLIENT_ID=your_public_client_id
EXTENSION_PUBLIC_GITHUB_WRITE_CLIENT_ID=your_write_oauth_client_id
```

The client ID is public configuration. Do not add client secrets or tokens.

Native List membership writes remain disabled by default. Development capability verification requires the same-account `user` scope, an explicitly confirmed disposable public star, an unchanged complete membership-set mutation, and an independent stable read-back. See [`docs/native-list-membership-fixture.md`](docs/native-list-membership-fixture.md).

Native List rename is independently disabled by default: `.env.example` sets `EXTENSION_PUBLIC_GITHUB_LIST_RENAME_ENABLED=false`. Do not change that flag for a general-user or release build. It can be considered only for an isolated manual-test build after a separate disposable rename probe has proven the required schema, `user` permission, same-account ownership, unique temporary rename, exact independent catalog read-backs, and restoration. Membership capability evidence does not enable rename.

Run development builds:

```bash
bun run dev
bun run dev -- --browser=firefox
```

Build production bundles:

```bash
env -u NODE_OPTIONS bun run build:chrome
env -u NODE_OPTIONS bun run build:firefox
```

The unpacked extensions are written to `dist/chrome/` and `dist/firefox/`.

Native List membership controls are disabled by default. Enable them only after completing the capability and isolated-profile checks in [`docs/native-list-membership-fixture.md`](docs/native-list-membership-fixture.md):

```bash
EXTENSION_PUBLIC_GITHUB_LIST_MEMBERSHIP_WRITE_ENABLED=true \
  env -u NODE_OPTIONS bun run build:chrome
```

To load the Chromium build, open `chrome://extensions`, enable Developer mode, select **Load unpacked**, and choose `dist/chrome/`.

To load the Firefox build, open `about:debugging#/runtime/this-firefox`, select **Load Temporary Add-on**, and choose `dist/firefox/manifest.json`.

Run the complete verification suite:

```bash
env -u NODE_OPTIONS bun run check
```

The check runs the source guard, strict TypeScript, unit and DOM tests, Chromium and Firefox builds, and built manifest/bundle inspection.

## Documentation

- [`STORE.md`](STORE.md): store listing and permission explanation.
- [`PRIVACY.md`](PRIVACY.md): data handling and deletion policy.
- [`docs/manual-test-checklist.md`](docs/manual-test-checklist.md): isolated-profile release verification.
- [`docs/github-app-setup.md`](docs/github-app-setup.md): read-only GitHub App and optional OAuth App configuration.
- [`docs/native-list-membership-fixture.md`](docs/native-list-membership-fixture.md): disposable fixture setup, capability probe, and cleanup.
