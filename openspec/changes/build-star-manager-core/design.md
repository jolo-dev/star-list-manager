## Context

The repository is an Extension.js TypeScript scaffold with browser-specific sidebar and background entrypoints but no application domain, storage, authentication, or tests. The MVP must work in Chromium and Firefox, remain backend-free, access public repositories only, and keep GitHub credentials outside page contexts. GitHub's documented REST starring API provides the star library and timestamps. The public GraphQL schema provides `User.lists` and `UserList.items`, but native Lists remain a public-preview capability.

The later unstar and native-list mutation changes depend on this change establishing stable repository identity, typed API boundaries, durable storage, and background-only GitHub access.

## Goals / Non-Goals

**Goals:**

- Establish a cross-browser extension architecture with a full-page dashboard and background-owned GitHub integration.
- Prove GitHub App device flow and native-list read access before building the complete product path.
- Keep remote GitHub state and local app-owned state separate and reconcilable.
- Make the initial read-only product useful through triage, search, annotations, and resurfacing.
- Create storage and message contracts that can safely support later durable mutation queues.

**Non-Goals:**

- Unstarring, starring, or modifying native GitHub Lists.
- Importing private repositories.
- Hosted synchronization, accounts managed by this application, analytics, or telemetry.
- Content-script injection or repository-page actions.
- Browser notifications, automatic background polling, or a mobile application.
- Native-list creation, rename, or deletion.

## Decisions

### Use an extension dashboard as the primary surface

The toolbar action will open or focus an extension-owned dashboard page. A full page supports dense search, filters, list navigation, and repository inspection better than the generated side panel. The side panel and GitHub-page augmentation are deferred until the core information architecture is proven.

Alternative considered: a hosted website. It would require an application backend or a less reliable browser-based OAuth exchange, add operating costs, and weaken the local-only data boundary.

### Keep all credential-bearing GitHub calls in the background boundary

Dashboard pages will send discriminated request messages to the background context. The background will own device-flow token exchange, refresh, REST and GraphQL calls, synchronization coordination, and sanitized error mapping. No response message will contain credentials or raw authorization headers.

Alternative considered: direct dashboard API calls. This would reduce message code but spread token handling across UI modules and make future content-script boundaries easier to violate.

### Use GitHub App device flow

The application will use a registered GitHub App with device flow enabled. The client ID is public and can ship with the extension. Device-flow user tokens can be refreshed without shipping a client secret. Because all three approved MVP changes ship through one app registration, the minimum permission envelope is user-level Starring read/write plus implicit public-resource access and no repository or organization permission. The core change uses that token read-only and exposes no mutation path.

Before full implementation, a capability spike must prove that a device-flow user token can list public stars, query `viewer.lists`, refresh without a secret, and support the later list mutation under the intended permission. If list access fails, native-list behavior remains capability-gated rather than falling back to cookie or HTML scraping.

Alternative considered: user-supplied fine-grained PAT. It is simpler for a prototype but creates onboarding friction and asks users to paste password-equivalent material into an extension.

### Treat extension storage as browser-profile protection, not a keychain

Tokens will be stored only as needed in extension-local storage and removed on disconnect or complete-data deletion. The design will not encrypt tokens with key material stored beside them because that would not protect against a browser-profile or extension-storage compromise. Security controls instead prevent exposure to pages, logs, exports, unrelated hosts, and application backends.

Token refresh is single-flight. Concurrent callers await one refresh operation, and rotated access/refresh pairs are replaced atomically with a generation check so a delayed failed request cannot erase newer credentials.

### Separate remote records from local records

Repository identity will use the GitHub node ID. Current owner/name remains mutable routing data for URLs and future REST mutations. Storage will separate these concerns:

- repositories: current GitHub metadata and remote starred state
- nativeLists: imported List metadata and sync completeness
- nativeMemberships: relationships between List IDs and repository node IDs
- annotations: triage state, tags, note, favorite, revisit and review timestamps
- syncState: baseline marker, cursors/checkpoints, completion metadata, rate limits, and sanitized errors
- authState: credentials and authenticated user identity
- settings: local user preferences and export schema version

Every GitHub-derived or user-authored library key includes the stable authenticated GitHub user ID as its namespace. Repository identity is therefore `(githubUserId, repositoryNodeId)`, and List identity is `(githubUserId, listId)`. Disconnect retains the namespace but removes credentials. Signing into another account selects a separate namespace and cannot expose, reconcile, or execute work belonging to the previous identity.

Separating and namespacing the records lets full remote reconciliation replace GitHub-owned fields without overwriting annotations, lets renamed or transferred repositories retain local history, and prevents cross-account mutation.

Alternative considered: key repositories by `owner/name` and embed `listIds`. That is simpler initially but breaks identity across renames and couples partial native-list sync to repository writes.

### Decode external data at explicit boundaries

Network responses, imported JSON, and extension messages will enter validation as `unknown` and be decoded into explicit contracts before reaching domain logic. Application code will prohibit `any` but will allow `unknown` at untrusted boundaries because it is the safe TypeScript representation of unvalidated data.

### Split REST star sync from GraphQL List sync

REST `GET /user/starred` with `application/vnd.github.star+json` and API version `2026-03-10` is authoritative for public star state and `starred_at`. GraphQL is authoritative only for native List metadata and accessible memberships.

REST pagination does not provide a point-in-time snapshot: stars added or removed between pages can shift results. Star sync therefore treats a page traversal as one observation, deduplicates by node ID, and requires two consecutive complete observations with identical public node ID sets before establishing the baseline or reconciling omissions. If bounded observations do not converge, the previous authoritative set remains intact and the UI reports unstable synchronization. Duplicate refresh requests coalesce into one active run.

List synchronization will fetch List metadata first, then paginate each List's items independently because nested GraphQL connections have separate cursors. Partial access will be recorded explicitly when reported counts exceed accessible nodes.

### Establish the first-import lifecycle only after both baseline reads settle

The initial classification waits for a converged star baseline and a terminal native-list result: complete, partial, or unavailable. Historical repositories with observed native membership become reviewed and qualify for Organized. Other historical repositories enter Backlog. When coverage is partial, the dashboard retains a partial-organization marker rather than claiming those Backlog items are definitely unlisted. Repositories first observed after the star baseline enter Inbox.

This avoids flooding Inbox with years of existing stars and avoids misclassifying historical stars while List import is still in progress.

### Keep resurfacing deterministic and local

Inbox, Backlog, Due, Organized, All Stars, native List, and local tag views are fixed built-in views derived from local records. User-created saved queries are outside this change. Due is based on `revisitAt <= now`; no remote call is required. The toolbar badge may show actionable Inbox and Due counts without requesting browser notification permission.

### Use versioned non-destructive export/import

Exports contain no credentials and include a schema version plus the active stable GitHub user ID. Import validates the entire file before applying any records and refuses to merge an account namespace into a different active identity without an explicit account-mismatch flow outside this change. Annotations merge by repository node ID within the matching account namespace using later `localModifiedAt` wins and equal timestamps keep local data. Imported repository metadata only fills missing historical fields; synchronized GitHub metadata remains authoritative. Settings are replaced only when explicitly selected in the preview. Import never deletes records absent from the file. Complete deletion is a separate confirmed operation.

## Risks / Trade-offs

- [GitHub native Lists remain public preview] -> Gate the feature behind a capability probe, decode defensively, and keep local organization usable when unavailable.
- [GitHub App Starring permission may not authorize every GraphQL List operation] -> Make a development-app capability spike the first task and prevent later write work until verified.
- [Public-only access can produce partially visible native Lists] -> Record partial status and never infer or display details about inaccessible items.
- [Browser-local token storage is not an OS keychain] -> Use short-lived access tokens, refresh rotation, strict context isolation, sanitized errors, revocation guidance, and easy disconnect.
- [Initial synchronization can be large and requires convergence] -> Paginate, expose observation progress, coalesce refreshes, bound repeated scans, retain the previous authoritative set, and avoid rendering all records eagerly when measurements require paging.
- [Firefox and Chromium background lifecycles differ] -> Persist synchronization checkpoints and avoid relying on in-memory state for correctness.
- [Local-only annotations do not automatically follow the user to another profile] -> Provide versioned export/import and state this limitation clearly; hosted sync remains outside MVP.

## Migration Plan

1. Add baseline type declarations and strict verification commands while preserving a buildable extension.
2. Register a development GitHub App and complete the read-only capability spike before building dependent UI.
3. Replace broad `<all_urls>` content-script access and side-panel-first behavior with extension dashboard, login, and GitHub-only host permissions.
4. Introduce domain contracts, storage schema version 1, typed messages, and empty-state dashboard behavior.
5. Add authentication, star synchronization, native-list import, first-import classification, and local features incrementally behind explicit states.
6. Verify Chromium and Firefox manifests, builds, first-run behavior, disconnect, export/import, and complete-data deletion.

Rollback is removal of the development extension or complete local-data deletion. No server migration or remote GitHub mutation is performed by this change.
