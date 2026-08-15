## Context

The dashboard currently derives native List membership from the locally synchronized `nativeMemberships` snapshot and uses that data for native List navigation. The sidebar also exposes fixed Triage views, local tags, and utility destinations. Issue #1 requires GitHub Lists to become the only sidebar section, while adding an Unlist entry for repositories that are not members of an imported native GitHub List.

The requested Unlist semantics intentionally extend beyond current stars: retained unstarred History records belong in Unlist whenever they have no currently stored native-List membership.

## Goals / Non-Goals

**Goals:**

- Make GitHub Lists the sole sidebar navigation section.
- Provide a reliably counted, selectable Unlist view before imported native Lists.
- Include starred and unstarred repository records with zero stored native-List memberships.
- Use the latest local membership snapshot without introducing network work or treating a derived view as a GitHub resource.
- Keep the sidebar usable when no native Lists have been imported or the capability is unavailable.

**Non-Goals:**

- Create, rename, synchronize, or mutate a GitHub List named Unlist.
- Change GitHub List import or mutation behavior.
- Delete local annotations, repository records, operation history, settings, filters, or search behavior.
- Add replacement sidebar destinations for Triage, Local tags, or Utilities.
- Infer remote membership that has not been imported into the local snapshot.

## Decisions

### Model Unlist as a derived built-in view

Add `unlist` to the existing built-in library-view model rather than persisting a synthetic `NativeListRecord`. The query matches an item exactly when `item.nativeLists.length === 0`; it does not filter on `repository.isStarred`. This preserves the approved behavior for both current stars and unstarred History records.

The count is derived in the same pass as existing view and List counts. It therefore stays consistent with the displayed local snapshot and requires no new storage migration, GitHub request, or write boundary.

Alternative considered: write a synthetic native List into storage. Rejected because it would blur local derived state with GitHub-owned data and could incorrectly enter List mutation paths.

### Render GitHub Lists as the only and always-present sidebar group

The sidebar renders one open GitHub Lists group regardless of the imported native-List catalog size. Its first entry is Unlist; subsequent entries are imported native Lists in the existing alphabetical order. Triage, Local tags, and Utilities are not rendered.

The initial active view becomes Unlist so a first-time or unavailable-native-List library opens into the only remaining navigation model. The view title and explanatory identity state that Unlist is locally derived, preventing it from appearing to be a GitHub-synchronized List.

Alternative considered: hide the GitHub Lists group when native Lists are unavailable. Rejected because it would hide Unlist precisely when it provides the broadest useful fallback.

### Define unavailable and partial-data behavior from the local snapshot

Unlist never issues a native-List discovery request. It uses currently stored memberships. If no memberships are stored because native Lists are unavailable, every locally stored repository appears in Unlist. If data is stale or partial, the view remains available and reflects only what the local snapshot currently records; it must not claim remote completeness.

### Preserve non-sidebar functionality

Removing navigation entries is a presentation change. It neither removes backing data nor changes synchronization, mutation, filters, search, operations, or settings behavior. Existing non-sidebar flows remain technically intact, but the specified sidebar does not expose Triage, tag, Utilities, Operations, Settings, or Unstarred History destinations.

## Risks / Trade-offs

- [Unlist can differ from GitHub's current state when imported memberships are stale or unavailable] -> Describe it as a derived local view and calculate only from the local snapshot rather than making unsupported remote-completeness claims.
- [Removing sidebar entries reduces direct discoverability of existing features] -> Keep the change strictly scoped to navigation presentation and avoid destructive data or capability removal.
- [Users may mistake Unlist for a native GitHub List] -> Place it before imported Lists and identify the corresponding view as derived/local.

## Testing Strategy

- Unit-test Unlist querying and counts for starred repositories, unstarred History repositories, repositories with one or multiple native memberships, and empty membership snapshots.
- DOM-test that GitHub Lists is the only sidebar group, Unlist precedes imported Lists, imported Lists retain alphabetical order, and removed groups/items are absent.
- Test initial active-view, title, and fallback behavior when the imported native-List catalog is empty or unavailable.
- Run the project's source guard, strict TypeScript check, tests, and Chromium/Firefox builds after implementation.
