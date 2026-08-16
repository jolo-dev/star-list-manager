# Configure GitHub Write OAuth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Configure and verify the existing GitHub write-authorization device flow for this machine's local extension build.

**Architecture:** Add the user-provided public OAuth App client ID only to the ignored `.env.local` file. Rebuild the Chrome extension so the bundler embeds the public configuration, then validate the OAuth device-flow boundary with redacted output and verify the real settings action after reloading the built extension.

**Tech Stack:** Bun 1.3.14, TypeScript, Extension.js, GitHub OAuth device flow, Chrome extension

---

### Task 1: Configure the local write OAuth client

**Files:**
- Modify (ignored local configuration): `.env.local`
- Reference: `.env.example`

- [ ] **Step 1: Confirm the read client is present and the write client is absent**

Run:

```bash
bun -e 'const text=await Bun.file(".env.local").text(); for (const name of ["EXTENSION_PUBLIC_GITHUB_CLIENT_ID","EXTENSION_PUBLIC_GITHUB_WRITE_CLIENT_ID"]) { const matches=text.split(/\r?\n/).filter((line)=>line.startsWith(`${name}=`)); const state=matches.length===0?"<absent>":matches.length===1&&matches[0].slice(name.length+1).trim()?"<set>":"<invalid>"; console.log(`${name}=${state}`) }'
```

Expected: the read client reports `<set>` and the write client reports `<absent>`. No value is printed.

- [ ] **Step 2: Add the approved public client ID**

Provide the user-supplied value to the executor as `APPROVED_WRITE_CLIENT_ID`, then run:

```bash
printf '\nEXTENSION_PUBLIC_GITHUB_WRITE_CLIENT_ID=%s\n' "$APPROVED_WRITE_CLIENT_ID" >> .env.local
```

Do not add a client secret or token.

- [ ] **Step 3: Reject empty or duplicate assignments without exposing values**

Run:

```bash
bun -e 'const text=await Bun.file(".env.local").text(); let valid=true; for (const name of ["EXTENSION_PUBLIC_GITHUB_CLIENT_ID","EXTENSION_PUBLIC_GITHUB_WRITE_CLIENT_ID"]) { const matches=text.split(/\r?\n/).filter((line)=>line.startsWith(`${name}=`)); const set=matches.length===1&&Boolean(matches[0].slice(name.length+1).trim()); console.log(`${name}=${set?"<set>":matches.length===0?"<absent>":"<invalid>"}`); valid&&=set } if(!valid) process.exit(1)'
```

Expected: both names report `<set>` exactly once and the command exits 0.

- [ ] **Step 4: Confirm local configuration remains untracked**

Run: `git check-ignore -v .env.local && git status --short`

Expected: `.env.local` is ignored and does not appear in Git status.

### Task 2: Build and verify write authorization

**Files:**
- Build output: `dist/chrome/`
- Verify: `src/background.ts`
- Verify: `src/auth/write-device-flow.ts`
- Verify: `src/dashboard/scripts.ts`

- [ ] **Step 1: Build the Chrome extension**

Run: `env -u NODE_OPTIONS bun run build:chrome`

Expected: exit code 0 and a refreshed `dist/chrome/` artifact.

- [ ] **Step 2: Run repository validation**

Run:

```bash
bun run typecheck
bun run inspect:build chrome
```

Expected: both commands exit 0.

- [ ] **Step 3: Verify the OAuth App accepts a device-code request**

Run this sanitized probe. It proves the configured OAuth App accepts a device-code request containing `scope=public_repo user`; granted scopes are validated later by the extension after authorization and token exchange.

```bash
EXTENSION_PUBLIC_GITHUB_WRITE_CLIENT_ID="$(awk -F= '$1=="EXTENSION_PUBLIC_GITHUB_WRITE_CLIENT_ID" {print substr($0,index($0,"=")+1)}' .env.local)" bun -e 'const response=await fetch("https://github.com/login/device/code",{method:"POST",headers:{Accept:"application/json","Content-Type":"application/x-www-form-urlencoded"},body:new URLSearchParams({client_id:Bun.env.EXTENSION_PUBLIC_GITHUB_WRITE_CLIENT_ID??"",scope:"public_repo user"})}); let value:unknown=null; try {value=await response.json()} catch {} const record=value&&typeof value==="object"?value as Record<string,unknown>:{}; let expectedHost=false; try {expectedHost=new URL(typeof record.verification_uri==="string"?record.verification_uri:"").hostname==="github.com"} catch {} const codePresent=typeof record.user_code==="string"&&record.user_code.length>0; console.log(`request_ok=${response.ok}`); console.log(`verification_host_ok=${expectedHost}`); console.log(`user_code_present=${codePresent}`); if(!(response.ok&&expectedHost&&codePresent)) process.exit(1)'
```

Never print or persist the raw response, device code, user code, access token, or authorization headers. Do not poll for or complete authorization from this probe.

Expected: all three fixed boolean fields report `true` and the command exits 0.

- [ ] **Step 4: Verify and cancel the real extension action**

Reload `dist/chrome/` in Chrome, open the existing connected account's Settings page, and select **Review write authorization → Continue to GitHub**.

Expected: the card enters **Approve GitHub write access** and presents **Open GitHub**. Select **Cancel** after observing the pending state; do not complete this validation authorization.

- [ ] **Step 5: Inspect the final repository state**

Run: `git status --short`

Expected: no source/config credential changes and no `.env.local` entry. Only intentionally tracked planning/specification commits exist.
