## 1. Release capability evidence

- [ ] 1.1 Add a typed, non-secret native List membership release-evidence module adjacent to the existing capability gate.
- [ ] 1.2 Make the module represent either no verified release evidence or the exact complete `ListMembershipCapabilityProof` returned by the reviewed disposable probe.
- [ ] 1.3 Add unit coverage that accepts complete evidence and rejects absent, partial, malformed, or secret-bearing evidence.
- [ ] 1.4 Remove `EXTENSION_PUBLIC_GITHUB_LIST_MEMBERSHIP_WRITE_ENABLED` from source, build configuration, documentation, and tests.

## 2. Background capability gating

- [ ] 2.1 Replace the public-environment boolean branch in `src/background.ts` with the typed release-evidence source.
- [ ] 2.2 Preserve the existing active-account identity and `WriteAuthController.membershipReady` checks after release capability has passed.
- [ ] 2.3 Add background/message tests showing that a verified release plus eligible account can request a move preview, while missing release evidence or account authorization fails closed with distinct sanitized messages.
- [ ] 2.4 Verify that no membership mutation request is sent when either gate is unavailable.

## 3. Dashboard readiness and move UX

- [ ] 3.1 Render distinct readiness guidance for an unverified build versus a verified build whose active account still needs List membership authorization.
- [ ] 3.2 Enable the existing add, remove, and move review controls when both gates are ready, while retaining source/destination validation and active-job disabling.
- [ ] 3.3 Add DOM coverage for build-unavailable, authorization-required, and ready-to-move states, including accessible status text and the disabled/enabled review button.

## 4. Release workflow and verification

- [ ] 4.1 Document the operator-confirmed disposable fixture probe, evidence review/update, and re-verification requirement for an OAuth application or mutation change.
- [ ] 4.2 Add a CI-checkable validation that bundled evidence is complete, typed, and non-secret.
- [ ] 4.3 Run `env -u NODE_OPTIONS bun run check` and manually verify an authorized account can preview and confirm a move without setting any public environment flag.
- [ ] 4.4 Manually verify a build without evidence remains read-only and that unstar behavior is unchanged.
