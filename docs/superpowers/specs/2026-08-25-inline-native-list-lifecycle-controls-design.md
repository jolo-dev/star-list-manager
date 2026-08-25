# Inline Native GitHub List Lifecycle Controls

**Date:** 2026-08-25  
**Status:** Approved interaction direction

## Goal

Replace the dedicated **Manage GitHub Lists** destination with direct lifecycle controls in the **My Lists** navigation rail. Users should create and remove native GitHub Lists where those Lists are already displayed, without losing the existing safety, capability, confirmation, recovery, or accessibility guarantees.

## Interaction Design

### Create control

The **My Lists** heading becomes a compact heading row with a visible `+` button aligned beside the label.

- The visible glyph is `+`.
- The accessible name is **Create GitHub List**.
- Activating it opens the existing create dialog directly.
- It remains visible but disabled when lifecycle writes are unavailable, another conflicting native-List operation is active, or a lifecycle request is pending.
- When disabled, a short readiness or conflict explanation appears near the heading rather than relying on disabled-button hover behavior. The shared explanation has a stable ID referenced by `aria-describedby` from every disabled lifecycle control.

### Remove controls

Every synchronized native GitHub List row has two sibling controls:

1. The existing List navigation control, including its marker, name, count, and current-page state.
2. A visible remove control with an accessible name that includes the List name, such as **Remove Research GitHub List**.

The controls must not be nested. Each entry remains a direct `<li>` child of the existing `<ul class="nav-list">`; the navigation and remove buttons are siblings inside that `<li>`. Only the navigation button carries `.nav-item`, view metadata, and `aria-current`. Rail guidance and status remain outside the navigation `<ul>`. **Unlist** is a derived local view and never receives a remove control.

Activating remove opens the existing deletion preview. Empty and populated Lists retain their current confirmation strength, exact-name requirements, reported repository count, partial-import warning, no-undo language, and assurance that repositories remain starred but become unlisted.

### Removed workspace

The **Manage GitHub Lists** navigation item and dedicated management workspace are removed. The application must not retain an unreachable management route.

The dedicated management page’s create section and synchronized catalog are unnecessary because their useful actions move into the existing List rail. Ordinary Library Refresh continues its existing star synchronization behavior; it is not treated as an equivalent lifecycle recovery command. A compact, contextual **Refresh GitHub Lists** action remains in the rail status surface whenever catalog synchronization or lifecycle recovery requires explicit user action, and it continues to dispatch the existing `refresh-native-list-lifecycle` message.

## Status and Readiness

Lifecycle state remains visible without a dedicated page.

- When create/remove controls are disabled, the rail shows one concise explanation beneath the **My Lists** heading. Blocker copy is deterministic: pending lifecycle request or active lifecycle operation first, then active membership work, active rename work, account authorization, unproven release capability, and finally catalog synchronization state.
- Native List catalog states—never synchronized, running, partial, stale, unavailable, or complete—remain visible when they affect lifecycle safety or require action.
- Active, failed, stale-confirmation, or ambiguous lifecycle outcomes appear in a compact rail status surface with reauthorization, refresh, or inspection guidance as applicable.
- A queued or preflight operation retains a visible **Cancel queued operation** action. Interactive refresh and cancellation controls sit outside `role="status"`/`role="alert"` text while remaining programmatically associated with it.
- Verified terminal outcomes may be shown briefly or until the next relevant state refresh, using the existing truthful read-back wording.
- Error and status text retains semantic `alert` or `status` roles as appropriate.
- The interface never reports success before authoritative GitHub read-back.

The sidebar presentation must remain compact enough that repository retrieval is not displaced on narrow screens. Detailed historical operation information remains available through the existing Operations destination where already supported; the rail only communicates the current actionable lifecycle state.

## Component and State Architecture

### Navigation composition

Refactor native List rendering into a row component with separate navigation and remove controls. This component owns presentation only and receives the current List record plus lifecycle availability.

The navigation list remains direct under **My Lists**; no collapsible **GitHub Lists** group is introduced.

### Dialog ownership

Move the native List lifecycle dialog host out of the deleted management workspace and mount it once in the retained ready dashboard shell. The existing dialog state, focus capture, focus trap, Escape behavior, error targeting, pending protection, and fallback focus restoration remain authoritative.

After dialog dismissal or a completed request, focus returns to the invoking `+` or remove control when it is still present and available. Confirmation normally returns a queued state before authoritative reconciliation removes a deleted List, so dashboard state reconciliation must also detect a focused remove control whose `listNodeId` disappears during a later publication. It then moves focus deterministically to the enabled `+` control, otherwise to the nearest surviving List navigation control, and finally to **Unlist**.

### Lifecycle requests

Reuse the existing credential-free message protocol and background lifecycle services:

- preview create
- confirm create
- preview delete
- confirm delete
- cancel queued operation
- refreshed authoritative state through `refresh-native-list-lifecycle`

No mutation transport, storage schema, release gate, authorization boundary, lock, recovery rule, or retry policy changes as part of this UI refinement.

## Responsive and Accessible Behavior

- The heading row must preserve the **My Lists** label and `+` control without wrapping at the supported 320px viewport.
- Each List row uses a grid with a shrinking navigation column and a fixed remove-control column.
- Long List names wrap or truncate safely without pushing the remove control outside the rail.
- Create and remove controls have visible focus indicators and at least 44px touch targets at narrow widths.
- Disabled controls remain legible, reference the shared blocker text with `aria-describedby`, and never rely on a tooltip as their only explanation.
- Remove controls use text or a self-contained symbol plus an explicit accessible name; color alone never communicates deletion.
- Forced-colors, dark mode, and reduced-motion behavior follow the existing dashboard system.

## Error Handling

- Preview failures remain sanitized and focus the relevant dialog action or field.
- A failed remove preview leaves the List row intact and reports the error near the lifecycle controls.
- A response-lost or otherwise ambiguous mutation is never replayed automatically.
- Account changes invalidate stale preview responses and prevent them from updating the current dashboard.
- Conflicting lifecycle, membership, and rename operations disable both create and remove controls until safe.

## Testing

Update or add DOM tests that verify:

- `+` appears beside **My Lists** with the correct accessible name.
- The management navigation item and workspace are absent.
- The create dialog opens from `+`, including an empty catalog.
- Each native List has one separate remove control; **Unlist** has none.
- Remove opens the existing empty/populated deletion confirmation flows.
- Create/remove controls remain visible but disabled with nearby guidance when writes are unavailable or conflicting.
- No nested interactive controls are rendered.
- Focus returns immediately to the invoker after queueing, then moves to the specified stable fallback when a later authoritative publication removes the focused deleted row.
- Pending and ambiguous lifecycle states, catalog synchronization state, reauthorization guidance, and queued cancellation remain visible in the rail.
- Contextual **Refresh GitHub Lists** dispatches `refresh-native-list-lifecycle` and can advance the documented recovery path; ordinary Library Refresh is not substituted for this protocol.
- Disabled-control guidance follows the documented blocker priority and is associated through `aria-describedby`.
- Direct List navigation, counts, markers, current-page semantics, keyboard behavior, and narrow layouts remain intact.

Update style tests for the heading action, two-control List rows, wrapping, touch targets, forced colors, and the removal of management-page-only rules.

Run the complete source check, typecheck, test suite, Chrome and Firefox builds, build inspection, and strict OpenSpec validation.

## Documentation Impact

Revise the active `add-native-list-lifecycle` OpenSpec artifacts so they specify inline List-rail controls rather than a dedicated management destination. Refresh `DESIGN.md` and `.impeccable/design.json` to remove the management-panel component and document the compact heading, row action, and rail status patterns.

## Non-Goals

- No live GitHub mutation during implementation or automated verification.
- No change to release evidence; controls remain fail-closed while evidence is `null`.
- No bulk List deletion.
- No removal control for **Unlist**.
- No context menus, hover-only actions, arbitrary GraphQL, or automatic replay of ambiguous mutations.
- No change to repository membership, starring state, local annotations, or history when a List is deleted.
