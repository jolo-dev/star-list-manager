## Why

GitHub stars are easy to collect but difficult to revisit, classify, and search meaningfully. The first product increment should turn the existing extension scaffold into a local-first library that imports the user's public stars and native GitHub Lists, then gives each star a useful lifecycle after capture.

## What Changes

- Replace the template sidebar experience with a full-page extension dashboard as the primary management surface.
- Authenticate without a pasted personal access token by using GitHub App device flow and fine-grained user permissions.
- Import the authenticated user's public starred repositories through the documented REST API, including original star timestamps.
- Import native GitHub Lists and their accessible public-repository memberships through the public GraphQL schema.
- Classify first-import repositories already in native Lists as organized, unlisted historical repositories as Backlog, and stars discovered after the baseline sync as Inbox.
- Add local-only triage state, tags, notes, favorites, and revisit dates without overwriting GitHub state.
- Add fast local search, filtering, built-in library views, and dashboard resurfacing queues.
- Add local JSON export/import and complete local-data removal; no backend, telemetry, hosted synchronization, content-script access, or remote mutation is introduced by this change.

## Capabilities

### New Capabilities

- `github-device-auth`: GitHub App device-flow authentication, token refresh, least-privilege boundaries, and disconnect behavior.
- `star-library-sync`: Import and reconcile public starred repositories into a stable local mirror.
- `native-list-import`: Read native GitHub Lists and accessible public-repository memberships without mutating GitHub.
- `star-triage`: Inbox, Backlog, reviewed, snoozed, and due-for-review lifecycle behavior.
- `local-library-data`: Local annotations, durable storage, data portability, and data deletion behavior.
- `repository-discovery-ui`: Full-page dashboard, search, filtering, built-in views, and repository inspection behavior.

### Modified Capabilities

None.

## Impact

- Replaces the generated Extension.js template UI and broad content-script permission with extension-owned dashboard and authentication pages.
- Adds typed background messaging, IndexedDB persistence, GitHub REST and GraphQL clients, and VanJS dashboard components.
- Requires a registered development/production GitHub App with device flow enabled and user-level Starring permission.
- Restricts network and host permissions to GitHub login and API endpoints and restricts MVP repository scope to public repositories.
- Establishes the domain and storage contracts that later unstar and native-list mutation changes will extend.
