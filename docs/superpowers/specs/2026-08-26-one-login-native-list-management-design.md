# One-login native GitHub List management

**Date:** 2026-08-26

**Status:** Approved design; implementation requires a new OpenSpec change and plan

## Purpose

Star List Manager should deliver its core promise after one GitHub connection: synchronize public stars and native GitHub Lists, then let the user manage those Lists without a second authorization ceremony or hidden build-time capability gates.

The current split between a read-only GitHub App session and a separate OAuth App write credential optimizes for least privilege but creates two GitHub device flows. Checked-in membership, lifecycle, and rename release-evidence gates can then leave controls disabled even after both authorizations succeed. That experience conflicts with the product goal.

## Product decisions

- New users complete one OAuth App device authorization requesting `public_repo user`.
- The resulting account-bound credential is the sole session for identity, synchronization, starring, and native List operations.
- Private repositories remain out of scope. The product never requests `repo`.
- Checked-in release-evidence gates do not control product readiness.
- Native List membership add/remove/move must work through a supported public-only GitHub API before this redesign can ship.
- Undocumented GitHub web endpoints, browser automation, cookie reuse, and arbitrary GraphQL are prohibited.
- If no supported public-only membership route works, release is blocked rather than requesting private-repository access or shipping partially working List management.
- Creation supports name, description, and explicit public/private List visibility when exposed by the official create input.
- Post-creation rename is included. Description and visibility editing are included only if GitHub officially exposes supported update fields; their absence does not block the first complete release.

## Scope

### Included

- Replace dual read/write authorization with one OAuth session.
- Migrate existing installations without losing local data.
- Read identity, public stars, native Lists, and public List memberships with the unified credential.
- Star and unstar through the existing fixed REST routes.
- Create and delete native Lists.
- Add, remove, and move public starred repositories among native Lists.
- Rename native Lists.
- Edit additional List metadata only where the official API exposes supported fields.
- Remove membership, lifecycle, and rename release-evidence gates from runtime readiness.
- Retain previews, explicit confirmation, durable mutation intent, locking, authoritative read-back, and interruption recovery.
- Simplify the dashboard to one connect/reconnect/disconnect lifecycle.

### Excluded

- Private repository access or storage.
- GitHub's broad `repo` scope.
- Undocumented or internal GitHub.com endpoints.
- Arbitrary caller-supplied GraphQL documents, URLs, or operation names.
- Automatic replay of ambiguous mutations.
- Silent optimistic success without authoritative read-back.
- Post-creation description or visibility editing when the official update schema does not support it.

## Feasibility gate

Implementation starts with an isolated, disposable-fixture investigation of GitHub's current official API.

The investigation must:

1. Recheck current official documentation and live schema for native List membership and metadata mutations.
2. Use one OAuth App device-flow credential with exactly `public_repo user`.
3. Confirm returned scopes and the expected account without retaining credentials or raw responses.
4. Exercise only a fixed, typed membership operation against an explicitly disposable public starred repository and disposable Lists.
5. Prove add, remove, and move with complete stable observations before and independent authoritative read-back afterward.
6. Retain only sanitized status, allowlisted failure classification, and non-sensitive capability conclusions.
7. Clean up fixtures independently.

A successful result may use `updateUserListsForItem` if GitHub accepts it and independent read-back proves each effect. Another route is acceptable only when GitHub officially documents it and it can be implemented as a fixed operation. Internal web APIs are never acceptable.

If no supported public-only route succeeds, the implementation plan stops at the feasibility gate and the redesign is not released.

## Authentication architecture

### Unified session

One OAuth controller, credential store, and authenticated session replace the current read controller/session plus secondary write controller/store.

The single session:

- requests `public_repo user` once during initial connection;
- validates the granted scopes and loads the authenticated GitHub identity;
- binds the credential to the stable GitHub user ID;
- provides authenticated fetch only to fixed GitHub clients;
- clears or replaces the credential after a terminal rejection;
- preserves local library data when authorization expires, is revoked, or is disconnected unless the user separately requests complete data deletion.

The public consent disclosure must explain that GitHub's OAuth scopes grant broader public-repository and profile authority than the extension uses. The implementation remains constrained to identity, public stars, fixed Starring routes, and fixed native List documents.

### Configuration

A release uses one public OAuth client identifier. The implementation removes the separate read-app and write-app runtime distinction and rejects obsolete dual-client configuration once migration is complete. No client secret is packaged or required.

### Existing-installation migration

Migration is account-bound and atomic:

1. Load the active read identity and any stored OAuth write credential.
2. Validate that the write credential belongs to the same stable GitHub user ID, is a bearer credential, has exactly the required usable scopes, and still authenticates successfully.
3. Store it as the unified primary session before deleting either legacy credential.
4. Reassemble application state and run authoritative synchronization.
5. Delete legacy auth records only after the unified session is durable.

If promotion cannot be proven safe, retain all local repositories, Lists, annotations, history, and operation records. Keep the library locally available and present one replacement **Connect GitHub** action. Never combine or guess across accounts.

## GitHub operation boundaries

Every remote operation has a dedicated typed client. Callers supply domain input only; they cannot supply a URL, GraphQL text, operation name, authorization header, or raw variables object.

Supported clients are:

- public identity and star synchronization;
- native List catalog and membership observation;
- fixed Starring status/PUT/DELETE routes;
- fixed native List creation;
- fixed native List deletion;
- fixed complete-set membership replacement through the feasibility-proven official route;
- fixed native List update for officially supported fields.

All clients validate canonical IDs, names, descriptions, visibility values, account ownership, scopes, and response shapes before exposing domain results.

## Runtime readiness

There are no checked-in membership, lifecycle, or rename evidence objects in the runtime readiness path.

A control is ready when:

- the unified credential is present and belongs to the active account;
- `public_repo` and `user` are granted;
- the required authoritative catalog or membership observation is complete;
- no conflicting native List mutation owns the shared lock;
- no same-operation request is pending;
- the requested operation is part of the supported fixed client set.

Capability probes, browser verification, and release review remain engineering evidence. Users do not authorize or satisfy those checks.

If a released operation later receives a deterministic schema or permission rejection, the application records a sanitized operation-specific failure and marks only that operation unavailable for the current session. It does not replay automatically or disable unrelated List operations. Reconnect or explicit refresh may re-evaluate availability.

## User experience

### Connection

The first-run interface has one **Connect GitHub** action and one scope disclosure. The device-flow code and verification link are shown once. Successful authorization proceeds directly to initial synchronization.

Settings show the connected account and one **Disconnect GitHub** action. There is no separate write-access card, preview, authorization code, readiness state, or disconnect action.

### List management

After synchronization:

- the `+` control beside **My Lists** creates a List;
- synchronized native Lists expose rename and delete controls;
- repository inspection supports add, explicit remove, and move;
- **Unlist** remains a derived local view and never receives rename or delete actions;
- unsupported metadata fields are omitted rather than shown as permanently disabled controls.

Creation collects a validated name, optional description when officially supported, and explicit public/private List visibility. Delete confirmation retains the exact List name, latest GitHub-reported item count, partial-import warning, no-undo warning, and assurance that repositories remain starred.

## Mutation data flow

Every mutation follows the same safety sequence:

1. Confirm the active account and unified credential.
2. Obtain a fresh complete authoritative observation.
3. Build a read-only preview and confirmation fingerprint.
4. Require explicit user confirmation.
5. Revalidate account, scopes, target identity, and stale-sensitive metadata.
6. Acquire the shared native List mutation lock.
7. Persist durable intent before dispatch.
8. Dispatch the fixed mutation at most once.
9. Perform independent authoritative read-back.
10. Reconcile local state only from complete GitHub observations.
11. Persist a sanitized terminal or recovery state and release the lock.

Ambiguous create, update, membership, or delete outcomes are recovered through observation. They are never automatically replayed.

## Failure handling

- **Expired or revoked credential:** preserve local data and show one **Reconnect GitHub** action.
- **Missing required scope:** send no mutation and replace the same unified authorization; never add a second credential.
- **Account mismatch:** send no request, preserve account namespaces, and require explicit reconnection.
- **Stale preview:** send no mutation and require refreshed review and confirmation.
- **Permission or schema rejection:** expose fixed sanitized guidance and mark only the affected operation unavailable for the session.
- **Rate limit:** retain only safe timing metadata and require an explicit later retry.
- **Ambiguous transport outcome:** observe authoritative state without replay.
- **Read-back mismatch:** report desired versus observed state and require a new preview.
- **Worker interruption:** resume durable observational recovery when the worker evaluates, starts, or receives its dedicated alarm.

Tokens, device codes, authorization headers, client identifiers, raw GitHub messages, raw responses, and returned stable List IDs never enter logs, exports, release evidence, or user-facing diagnostics.

## Verification and release

The release requires:

- a successful official-API feasibility probe for add, remove, and move;
- disposable-fixture verification of create, delete, and rename;
- independent cleanup and authoritative read-back for every mutation class;
- migration tests for valid promotion, missing write credential, mismatched account, rejected credential, interrupted migration, and rollback;
- controller/session tests proving one device flow and one credential;
- source tests proving no caller can inject GraphQL, URLs, headers, or unsupported fields;
- complete-set membership tests preserving unrelated memberships;
- stale confirmation, ambiguity, rate-limit, worker restart, and cross-account tests;
- dashboard tests proving one connect flow and the absence of write-authorization UI;
- Chrome and Firefox production builds, inspection, and isolated-profile verification;
- strict OpenSpec validation and independent specification/security review.

Release checks are completed by maintainers. They do not become checked-in booleans that disable controls for authenticated users.

## Documentation impact

Update the README, store listing, privacy disclosure, GitHub App/OAuth setup documentation, capability results, fixture procedures, and manual test checklist to describe:

- one OAuth authorization;
- the broad GitHub-granted scopes and narrow implementation boundary;
- public-repository-only behavior;
- supported native List operations;
- migration from dual credentials;
- authoritative read-back and no automatic replay;
- the absence of runtime release-evidence gates.

## Planning boundary

This design changes the authentication model and extends beyond the existing `add-native-list-lifecycle` change. It should be represented by a new OpenSpec change rather than rewriting the historical intent of the nearly completed lifecycle change. The implementation plan must put the membership feasibility gate first and stop if that gate fails.
