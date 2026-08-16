# Configure GitHub Write OAuth

## Goal

Enable the existing **Continue to GitHub** settings action to request account-scoped GitHub write authorization in local extension builds.

## Design

Add the user-provided public OAuth App client ID to the ignored `.env.local` file as `EXTENSION_PUBLIC_GITHUB_WRITE_CLIENT_ID`. Keep the existing read-only GitHub App client ID unchanged. Do not add a client secret, access token, or credential to source control.

The extension's existing background authorization flow will continue to request `public_repo user`, validate that authorization belongs to the active GitHub account, and store the resulting credential in extension-owned browser storage.

## Validation

1. Confirm `.env.local` contains both public client-ID variables without printing their values.
2. Build the Chrome extension successfully so the environment variable is compiled into the local artifact.
3. Load the built Chrome artifact and exercise **Settings → Review write authorization → Continue to GitHub**. Confirm it reaches the pending state and presents the GitHub verification action.
4. Sanitize validation output: report only success/failure, the expected GitHub verification host, and whether a user code was present. Do not print or retain the raw device-code response, device code, user code, access token, or authorization headers.
5. Cancel the pending authorization without completing it outside the extension.
6. Confirm `.env.local` remains ignored and no credential or token enters the Git diff.

## Scope

This change configures local builds only. It does not alter source behavior, commit the public client ID, enable unproven native List membership writes, or store a GitHub client secret.
