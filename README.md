# Star List Manager

Star List Manager is a local-first browser extension for searching, triaging, and revisiting public GitHub stars. It imports native GitHub Lists read-only and keeps notes, tags, favorites, review state, and revisit dates inside the browser profile.

## Scope

- Chromium and Firefox extension-owned dashboard.
- Read-only GitHub App device-flow authentication without a client secret or pasted token.
- Optional, separately stored OAuth App authorization for confirmed Starring writes.
- Public starred repositories only. Private repository metadata is not persisted.
- Read-only native GitHub List import through the public GraphQL schema.
- Explicit single and bulk unstar controls use a durable sequential queue, remote verification, and operation history.
- No automatic cleanup rules, re-star, Undo, or native List mutation control is included.
- No backend, hosted synchronization, analytics, advertising, or content scripts.

## Permissions

- `storage`: saves credentials, synchronized public metadata, local annotations, and settings in the browser profile.
- `alarms`: wakes eligible persisted unstar jobs while the browser remains open.
- `https://github.com/login/*`: performs GitHub device authorization and token refresh.
- `https://api.github.com/*`: reads the authenticated user's public stars, identity, and available native Lists.

The GitHub App requests user-level Starring read permission and implicit public-resource access. It does not request repository, organization, private-repository, content, Gist, or write permission.

Optional write authorization uses a separate GitHub OAuth App and requests `public_repo`. GitHub defines that scope broadly: it can write more public-repository resources than Star List Manager uses. The extension stores that token separately, validates that it belongs to the active GitHub user, and permits it only through exact authenticated-user Starring status, star, and unstar routes.

Unstar confirmation identifies the operation as a GitHub account change and lists every affected repository. Confirmed jobs are stored before network work, execute one at a time, and keep repositories in active starred views until complete observations verify remote absence. Successful unstars retain metadata, notes, tags, favorites, triage, and history. There is no Undo because restoring a GitHub star requires a separately confirmed remote write.

## Local Data

Credentials and library data remain in extension-owned browser storage. Browser-profile storage is not an operating-system keychain. Read and optional write tokens are stored separately and isolated from rendered pages, logs, exports, and unrelated hosts, but a compromised browser profile can expose extension storage.

Settings can disconnect only optional write access while retaining read-only synchronization. Disconnect GitHub removes both active credentials while retaining local library data. A separate confirmed action removes all credentials and extension-owned data. Versioned JSON export/import supports moving one active account namespace between browser profiles; see [`docs/export-format.md`](docs/export-format.md).

Native GitHub Lists use a public-preview GraphQL capability. The extension remains useful with local organization if that capability is unavailable or partially visible.

Queued jobs may be cancelled only before remote execution begins. Network and server failures retry within a bounded policy, rate-limited work waits for the known reset, and authorization failures require corrective action. `Blocked unknown` means repository identity or remote star state could not be verified; it is not retried automatically and never changes local starred state.

## Development

Install with Bun 1.3.14 or a compatible Bun release:

```bash
bun install
```

Create `.env.local` with public client IDs for a read-only GitHub App and, when testing optional Starring writes, a separate OAuth App. Both apps must have device flow enabled:

```text
EXTENSION_PUBLIC_GITHUB_CLIENT_ID=your_public_client_id
EXTENSION_PUBLIC_GITHUB_WRITE_CLIENT_ID=your_write_oauth_client_id
```

The client ID is public configuration. Do not add client secrets or tokens.

Run development builds:

```bash
bun run dev
bun run dev -- --browser=firefox
```

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
