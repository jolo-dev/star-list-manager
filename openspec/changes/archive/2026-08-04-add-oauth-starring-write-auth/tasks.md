## 1. Add isolated write-auth storage

- [x] 1.1 Define OAuth write credential, granted scope, authorization phase, readiness, and sanitized failure types without adding them to exports or read-auth messages.
- [x] 1.2 Add IndexedDB version 2 with an account-keyed `writeAuthState` store and test fresh creation, v1 upgrade preservation, rollback, lookup, and complete deletion.
- [x] 1.3 Implement account-scoped save, load, delete-current, delete-account, and clear-all write credential operations.

## 2. Implement OAuth App device authorization

- [x] 2.1 Add `EXTENSION_PUBLIC_GITHUB_WRITE_CLIENT_ID` public configuration and a separate OAuth device-code request with the exact `public_repo` scope.
- [x] 2.2 Implement polling, slow-down, cancellation, expiry, denial, OAuth token decoding, scope validation, and authenticated identity validation without a client secret.
- [x] 2.3 Reject and discard tokens whose stable GitHub user ID differs from the active read-only identity or whose normalized granted scopes omit `public_repo`.
- [x] 2.4 Add tests for successful authorization, cancellation, denial, expiry, malformed payloads, missing scope, account mismatch, and credential redaction.

## 3. Add owner-bound Starring transport

- [x] 3.1 Implement a structured write session accepting only expected account ID, owner/name segments, and status, star, or unstar operations.
- [x] 3.2 Enforce exact GitHub Starring URL construction, method allowlisting, active read-account matching, matching write credential ownership, and local rejection of arbitrary endpoints.
- [x] 3.3 Clear only the current OAuth write credential on 401 and retain sanitized permission/scope guidance on 403 and rate-limit responses.
- [x] 3.4 Add tests for owner match, account switch, encoded routes, all allowed methods, forbidden routes, 401 cleanup, 403 retention, and no credential leakage.

## 4. Expose optional authorization safely

- [x] 4.1 Extend strict dashboard messages and application state with non-secret write authorization preview, pending flow, readiness, cancellation, and disconnect contracts.
- [x] 4.2 Add a Settings disclosure explaining `public_repo`, the Starring-only implementation boundary, token storage, revocation, and explicit Continue/Cancel controls.
- [x] 4.3 Wire background authorization, polling state, account validation, disconnect-write, ordinary disconnect, account switching, and complete deletion without changing read-only sync behavior.
- [x] 4.4 Test Settings and background behavior for cancellation creating no credential, successful readiness, account isolation, write-only disconnect, full disconnect, and complete deletion.

## 5. Verify real capability and release safety

- [x] 5.1 Add a disposable OAuth capability probe with explicit fixture confirmation, stable node-ID validation, converged DELETE verification, best-effort PUT restoration, and converged restoration verification.
- [x] 5.2 Unit-test removal/restoration, delayed visibility, instability, route failure, 401, 403, rate limit, malformed data, and cleanup failure using fake credentials.
- [x] 5.3 Register a development OAuth App with device flow, configure the public write client ID locally, authorize `public_repo`, and complete the real disposable probe.
- [x] 5.4 Update README, STORE, privacy, setup, capability evidence, manual testing, and `.env.example` with the broad-scope disclosure and revocation guidance.
- [x] 5.5 Inspect both builds for exact browser permissions/hosts, no client secret or credential, no remote code or analytics, and no write token in dashboard bundles.
- [x] 5.6 Run source checks, strict TypeScript, all tests, Chromium and Firefox builds, build inspection, strict OpenSpec validation, and isolated-profile authorization/disconnect verification.
