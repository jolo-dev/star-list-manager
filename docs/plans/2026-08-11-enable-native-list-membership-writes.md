# Enable Native List Membership Writes Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Ship the existing native GitHub List add/remove/move workflow when its reviewed release evidence and an active account's OAuth authorization are both ready, without any manual membership-write environment flag.

**Architecture:** Add a typed, checked-in release-evidence provider beside the existing capability gate. The background derives its release gate solely from that provider, while the existing account identity/scope gate and safe mutation pipeline remain untouched. Update readiness copy and release documentation so the two gates are understandable and auditable.

**Tech Stack:** TypeScript 7, Bun 1.3, VanJS, happy-dom, OpenSpec, GitHub OAuth/GraphQL.

---

### Task 1: Make the project test command execute the test suite

**Objective:** Repair the project test script so `bun run test` runs the repository's `tests/` directory, matching README and `bun run check` expectations.

**Files:**
- Modify: `package.json:30`

**Step 1: Establish the failing baseline**

Run: `env -u NODE_OPTIONS bun run test`

Expected: FAIL with `No tests found!` because Bun's default discovery does not traverse this repository's `tests/` directory.

**Step 2: Update the test script**

Change the script to:

```json
"test": "bun test tests"
```

**Step 3: Verify the test script**

Run: `env -u NODE_OPTIONS bun run test`

Expected: PASS — all discovered tests execute; not `No tests found!`.

**Step 4: Commit**

```bash
git add package.json
git commit -m "fix: run Bun tests from tests directory"
```

### Task 2: Add typed, non-secret release capability evidence

**Objective:** Create a single reviewed source of truth for release-level native List membership capability and reject malformed or secret-bearing evidence.

**Files:**
- Create: `src/github/list-membership-release-evidence.ts`
- Modify: `src/github/list-membership-capability.ts:1-19`
- Modify: `tests/github/list-membership-capability.test.ts:1-24`
- Create: `tests/github/list-membership-release-evidence.test.ts`

**Step 1: Write failing tests**

Add tests that define this public API:

```ts
import {
  releaseNativeListMembershipCapabilityProof,
  validateNativeListMembershipReleaseEvidence
} from '../../src/github/list-membership-release-evidence'

test('bundles complete reviewed membership capability evidence', () => {
  expect(releaseNativeListMembershipCapabilityProof()).toEqual({
    schema: 'available',
    oauthUserScope: 'verified',
    accountOwnership: 'verified',
    unchangedSetMutation: 'verified',
    independentReadBack: 'verified'
  })
})

test('rejects partial, unknown-key, and credential-bearing release evidence', () => {
  expect(validateNativeListMembershipReleaseEvidence({schema: 'available'})).toBeNull()
  expect(validateNativeListMembershipReleaseEvidence({/* complete proof */, accessToken: 'secret'})).toBeNull()
})
```

Run: `env -u NODE_OPTIONS bun test tests/github/list-membership-release-evidence.test.ts`

Expected: FAIL — module/function does not exist.

**Step 2: Implement the minimal typed provider**

Create a module containing an exact-key validator and a checked-in complete proof. It must return `ListMembershipCapabilityProof | null`, accept only the five expected proof keys with their literal verified values, and reject any unknown key so credentials or fixture/user data cannot be bundled by accident.

```ts
export function releaseNativeListMembershipCapabilityProof(): ListMembershipCapabilityProof | null {
  return validateNativeListMembershipReleaseEvidence(reviewedEvidence)
}
```

**Step 3: Verify green**

Run: `env -u NODE_OPTIONS bun test tests/github/list-membership-release-evidence.test.ts tests/github/list-membership-capability.test.ts`

Expected: PASS.

**Step 4: Commit**

```bash
git add src/github/list-membership-capability.ts src/github/list-membership-release-evidence.ts tests/github/list-membership-capability.test.ts tests/github/list-membership-release-evidence.test.ts
git commit -m "feat: add reviewed List membership release evidence"
```

### Task 3: Replace the manual membership build flag and clarify readiness

**Objective:** Drive membership availability from release evidence plus the existing account OAuth gate, with no dependence on `EXTENSION_PUBLIC_GITHUB_LIST_MEMBERSHIP_WRITE_ENABLED`.

**Files:**
- Modify: `src/background.ts:59,74-88,556-565,630-654`
- Modify: `src/dashboard/scripts.ts:1482-1496,2002-2007`
- Modify: `tests/dashboard/dom.test.ts:321-347` and relevant settings-readiness test
- Create or modify: `tests/github/list-membership-release-evidence.test.ts`

**Step 1: Write failing tests**

Add focused tests that assert:

```ts
test('release capability evidence enables the existing capability gate', () => {
  expect(nativeListMembershipControlsEnabled(
    releaseNativeListMembershipCapabilityProof()
  )).toBe(true)
})

test('explains that an unverified build is read-only', () => {
  expect(membershipReadinessMessage({
    ...membershipReadyDashboardState(),
    nativeListMembership: {readiness: 'capability-unproven'}
  })).toContain('this build does not enable verified native List membership writes')
})
```

Run: `env -u NODE_OPTIONS bun test tests/github/list-membership-release-evidence.test.ts tests/dashboard/dom.test.ts`

Expected: FAIL — runtime source has no release evidence provider and readiness copy still references an unrecorded no-op mutation.

**Step 2: Implement the minimal runtime change**

- Import `releaseNativeListMembershipCapabilityProof` in `src/background.ts` and compute `membershipWriteCapabilityProven` with it and the existing `nativeListMembershipControlsEnabled()` function.
- Delete the `EXTENSION_PUBLIC_GITHUB_LIST_MEMBERSHIP_WRITE_ENABLED` environment branch entirely.
- Preserve `writeAuthorization.membershipReady` as the separate account gate and leave preview, confirmation, queue, and read-back handling untouched.
- Change user-visible copy to distinguish an unverified/read-only build from a verified build that still needs account write authorization.

**Step 3: Verify green**

Run: `env -u NODE_OPTIONS bun test tests/github/list-membership-release-evidence.test.ts tests/github/list-membership-capability.test.ts tests/dashboard/dom.test.ts`

Expected: PASS.

**Step 4: Commit**

```bash
git add src/background.ts src/dashboard/scripts.ts tests/github/list-membership-release-evidence.test.ts tests/dashboard/dom.test.ts
git commit -m "fix: enable verified native List membership releases"
```

### Task 4: Document the probe-to-release workflow and remove the obsolete flag

**Objective:** Make it explicit that only a reviewed disposable probe updates the bundled release evidence; ordinary users do not run probes or set membership build flags.

**Files:**
- Modify: `README.md:79-84`
- Modify: `docs/github-app-setup.md:60-62`
- Modify: `docs/native-list-membership-fixture.md:25-31`
- Modify: `openspec/changes/enable-native-list-membership-writes/tasks.md`

**Step 1: Update documentation**

Replace every instruction to set `EXTENSION_PUBLIC_GITHUB_LIST_MEMBERSHIP_WRITE_ENABLED` with the release-evidence workflow: run the existing disposable probe, review its sanitized complete result, update the checked-in evidence for a release, rebuild, and rerun the test/build checks. State that changing the write OAuth application or membership mutation requires renewed evidence.

**Step 2: Mark completed OpenSpec tasks**

Check off implementation tasks only after their associated code/docs/verification steps pass.

**Step 3: Verify no obsolete flag remains**

Run:

```bash
! rg -n 'EXTENSION_PUBLIC_GITHUB_LIST_MEMBERSHIP_WRITE_ENABLED' --glob '!openspec/changes/archive/**' .
```

Expected: exit 0 with no output.

**Step 4: Commit**

```bash
git add README.md docs/github-app-setup.md docs/native-list-membership-fixture.md openspec/changes/enable-native-list-membership-writes/tasks.md
git commit -m "docs: describe verified List membership releases"
```

### Task 5: Run the full verification matrix

**Objective:** Prove source quality, strict types, tests, Chromium/Firefox builds, bundle inspection, and OpenSpec validity.

**Files:**
- Verify only; no planned production changes.

**Step 1: Run OpenSpec validation**

Run: `bunx --yes @fission-ai/openspec@latest validate enable-native-list-membership-writes --strict`

Expected: `Change 'enable-native-list-membership-writes' is valid`.

**Step 2: Run the full project check**

Run: `env -u NODE_OPTIONS bun run check`

Expected: source guard, TypeScript, 270+ tests, Chromium and Firefox builds, and build inspection all exit 0.

**Step 3: Review final diff**

Run:

```bash
git status --short --branch
git log --oneline origin/master..HEAD
git diff --check origin/master...HEAD
```

Expected: branch contains only the OpenSpec change, plan, implementation/tests, and documentation commits; no whitespace errors or uncommitted files.

**Step 4: Commit any final task-state updates**

```bash
git add openspec/changes/enable-native-list-membership-writes/tasks.md
git commit -m "docs: complete List membership release-gating tasks"
```
