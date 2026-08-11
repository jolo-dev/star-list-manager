## Context

The extension already has a narrow `UpdateUserListsForItem` transport, a disposable probe that submits the unchanged full membership set and independently reads it back, and a typed `ListMembershipCapabilityProof`. At runtime, `src/background.ts` reduces that proof to one public environment variable. If the variable is absent, `nativeListMembershipControlsEnabled()` returns false, the dashboard reports membership unavailable, and moving between Lists stays disabled even when the active account has successfully completed the `public_repo` and `user` OAuth flow.

The selected product policy is release-gated enablement: a release may expose membership mutations only after the existing probe has verified the configured OAuth application, but a normal user must not need to run a probe or set a build flag.

## Goals / Non-Goals

**Goals**

- Make a successfully verified release enable existing native List add, remove, and move controls after eligible account authorization.
- Keep release evidence non-secret, checked in or otherwise bundled as a reviewed build input, and directly testable.
- Preserve both independent gates: release-level capability verification and account-level OAuth identity/scope readiness.
- Give users actionable, distinct reasons for a disabled membership action.

**Non-Goals**

- Per-user automatic probes, background test mutations, or any mutation before explicit user confirmation.
- A generic GraphQL client or broader OAuth authorization.
- Changes to safe unstar, List lifecycle, or repository data semantics.

## Decisions

### Replace the public boolean with typed release capability evidence

Introduce one typed release-evidence source owned by the native List membership capability module. It contains only the assertions produced by a successful disposable probe: schema availability, OAuth `user` scope verification, account ownership verification, unchanged-set mutation verification, and independent read-back verification. It must contain no OAuth token, device code, authorization header, user identity, repository identifier, or raw response.

The production extension derives `membershipWriteCapabilityProven` exclusively from this source through `nativeListMembershipControlsEnabled()`. It must not read `EXTENSION_PUBLIC_GITHUB_LIST_MEMBERSHIP_WRITE_ENABLED` or use a default-on public environment boolean. An unverified/development release can deliberately provide absent evidence and remains read-only.

This makes the product decision reviewable and prevents a release from silently depending on an undocumented environment toggle. It does not claim that a prior probe makes GitHub immutable: ordinary requests still handle schema, authorization, and remote verification failures safely.

### Keep release evidence and account authorization as separate gates

Release evidence says the configured integration was independently verified before release. It does not authorize a specific user. The existing `WriteAuthController` remains the sole source of account-scoped readiness; List membership needs an active read identity matching the credential plus both `public_repo` and `user` scopes.

The dashboard state exposes these independently. When evidence is present but the account is not ready, the UI directs the user to authorize List membership. When account authorization is ready but evidence is absent, the UI states that this build does not enable List mutations. Once both are true, move controls become available subject to their existing source/destination selection and active-job checks.

### Preserve the existing mutation safety boundary

No part of this change bypasses the established operation pipeline. A move still removes one selected current List, adds one distinct destination List, preserves unrelated memberships from a complete stable observation, previews the full before/after set, requires explicit confirmation, rechecks stale inputs, processes sequentially, and verifies a fresh complete stable read-back.

The existing static OAuth allowlist and secret-redaction rules remain unchanged. A runtime GraphQL, permission, account, rate-limit, unstable-observation, stale-preview, or read-back failure disables or pauses only the affected operation using the existing sanitized failure path.

### Make release verification reproducible and auditable

Keep the existing operator-confirmed probe as the only mechanism that produces positive evidence. Document the release workflow: run the probe against a disposable public starred fixture, inspect its sanitized result, update the typed evidence only after review, then run the automated test suite and extension builds. CI validates that the bundled evidence has the exact complete proof shape; it must reject a partial, malformed, or secret-bearing record.

The evidence is not user-specific and is not persisted in browser storage. Changing the configured write OAuth application or the supported GraphQL mutation requires a new probe and review before a release can enable membership writes.

## Risks / Trade-offs

- **GitHub behavior changes after release** → Existing narrow transport failures, stable observations, and read-back verification remain authoritative; the UI safely fails closed per operation.
- **Evidence is accidentally broadened** → Keep it typed, static, non-secret, and validated by tests; do not accept an arbitrary public environment value.
- **A user mistakes release readiness for authorization** → Render separate status/copy for build evidence and account authorization.
- **A new OAuth application is deployed without re-verification** → Require its evidence update as part of the release workflow; missing evidence leaves membership writes disabled.

## Migration Plan

1. Add the typed release evidence source and unit tests that accept only the complete non-secret proof shape.
2. Replace the environment-flag branch in the background runtime with that source and test both verified and unverified build configurations.
3. Update dashboard readiness text and DOM tests for the three states: build unavailable, authorization required, and ready-to-move.
4. Document the probe-to-evidence release procedure and test it in CI alongside the existing source/type/test/build checks.
5. Roll back by supplying no evidence in a follow-up release; synchronization remains read-only and no user data migration is required.
