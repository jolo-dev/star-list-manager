## 1. Establish safe rename contracts

- [x] 1.1 Inspect the current native List metadata, account-bound write credential, static membership transport, and capability-probe conventions; retain the existing read-only import and exact allowlist boundaries.
- [x] 1.2 Add pure List-name canonicalization: trim display/persisted input, require non-empty text, normalize with NFKC plus case-insensitive comparison, and exclude the target List ID when detecting duplicates.
- [x] 1.3 Add unit tests for blank, whitespace-only, unchanged, duplicate, case-variant duplicate, Unicode-equivalent duplicate, and distinct valid names.
- [x] 1.4 Add a dedicated owner-bound rename request type that accepts only expected GitHub user ID, current List node ID, and already validated name; reject extra fields and arbitrary documents/URLs/variables locally.

## 2. Prove and execute the remote capability

- [x] 2.1 Implement a static, documented native List rename mutation contract and defensive response/error decoding without exposing a generic GraphQL write client.
- [x] 2.2 Extend the OAuth readiness model and pre-authorization disclosure only with the proven scope/rename capability requirement; preserve read-only and membership-only fallback states.
- [ ] 2.3 Add a development probe requiring an explicitly approved disposable List; verify owner identity, schema/scope, rename, and independent complete-catalog read-back while recording only sanitized evidence.
- [x] 2.4 Gate production rename controls on successful capability proof; show imported Lists as read-only when the proof is missing, rejected, or stale.
- [x] 2.5 Add fake-transport tests for owner mismatch, unavailable schema, scope/permission denial, deleted List, malformed response, rate limit, network ambiguity, and sanitized errors.

## 3. Reconcile authoritative List state

- [x] 3.1 Add an exact runtime request/response contract for rename that contains no credentials and validates target ID/name again in the background.
- [x] 3.2 Preflight the current account-scoped catalog before dispatch; reject unavailable/deleted Lists without a remote write.
- [x] 3.3 After mutation, fetch a fresh complete List catalog and update the local record only when the same ID has the requested canonical name.
- [x] 3.4 On changed account, ambiguous request, missing List, or divergent read-back, preserve/refresh authoritative local metadata and require a fresh user Save instead of automatic retry.
- [x] 3.5 Test local reconciliation, reload persistence, sidebar/header consistency, catalog deletion, stale concurrent rename, and no changes to memberships or local annotations.

## 4. Build the inline dashboard editor

- [x] 4.1 Render the selected native List detail header from the synchronized List record and add a visible Edit button beside its title; keep sidebar names navigational only.
- [x] 4.2 Implement focused inline edit mode with text input, Save, Cancel, Escape, pending/busy state, and restoration of focus to the Edit button.
- [x] 4.3 Display accessible inline errors for blank/equivalent-duplicate/server-rejected names; do not send invalid requests.
- [x] 4.4 Refresh the shared dashboard state from verified reconciliation so the sidebar and active detail header update together immediately.
- [x] 4.5 Test DOM structure, keyboard flow, accessible labels/live feedback, duplicate blocking, cancel behavior, pending double-submit prevention, success render, and capability-disabled fallback.

## 5. Verify and document

- [x] 5.1 Update README, privacy/store material, and manual test guidance to describe optional remote rename, user-supplied naming responsibility, validation, capability gating, and concurrent-edit behavior.
- [ ] 5.2 Run `bun run check:source`, `bun run typecheck`, `bun test`, `bun run build:chrome`, `bun run build:firefox`, and `bun run inspect:build`.
- [ ] 5.3 Manually verify in isolated Chromium and Firefox profiles: read-only fallback; valid rename; blank/case/Unicode-equivalent duplicate rejection; cancel/Escape; reload persistence; sidebar/detail synchronization; server rejection; deleted List; and concurrent external rename recovery.
