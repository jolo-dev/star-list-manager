## Why

The sidebar currently mixes Triage, imported GitHub Lists, local tags, and utility destinations. This change narrows navigation to the user's GitHub List organization while retaining a first-class way to see repositories that have not been placed in any imported GitHub List. That view must remain useful for retained unstarred History records as well as current stars.

## What Changes

- Remove the Triage, Local tags, and Utilities sections from the sidebar so GitHub Lists is its only navigation section.
- Always display the GitHub Lists section, even when the account has no imported native Lists.
- Add **Unlist** as the first, derived sidebar entry. It shows every locally stored repository with zero currently imported native-List memberships, including unstarred History records.
- Make Unlist the dashboard's initial view and show a derived-view identity so it is not mistaken for a remote GitHub List.
- Calculate Unlist only from the local snapshot's currently stored memberships. When native Lists are unavailable and no memberships are stored, all locally stored repositories appear in Unlist.
- Keep synchronization, storage, GitHub List mutations, local annotations, filters, search, operations, and settings behavior unchanged; this change removes their sidebar navigation entries only.

## Capabilities

### New Capabilities

- None.

### Modified Capabilities

- `repository-discovery-ui`: Replace multi-section sidebar navigation with GitHub Lists-only navigation and add the derived Unlist view.

## Impact

- Updates dashboard view/query/count logic, initial view selection, sidebar rendering, and active-view titles.
- Updates dashboard unit and DOM tests for Unlist membership semantics and the reduced sidebar structure.
- Does not change GitHub APIs, browser permissions, persistent schemas, synchronization contracts, or mutation semantics.
