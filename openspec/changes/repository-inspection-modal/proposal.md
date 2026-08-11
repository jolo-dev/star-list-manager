## Why

The dashboard currently reserves a persistent inspector column beside the repository list, which narrows the result view even when no repository is being reviewed. Opening the selected repository in a modal keeps the library focused on browsing while preserving the complete inspection and action workflow.

## What Changes

- Replace the persistent repository inspector and its empty placeholder in the library grid with an on-demand repository-inspection modal.
- Open the modal when the user activates a repository result and render all existing inspector content inside it: synchronized metadata, local annotations, native List membership controls, GitHub write actions, and operation history.
- Provide accessible modal behavior, including an explicit close action, keyboard dismissal, focus management, and a return to the invoking repository result.
- Keep local annotation and GitHub account-change behavior unchanged; this change only changes the presentation and interaction surface for a selected repository.

## Capabilities

### New Capabilities


### Modified Capabilities

- `repository-discovery-ui`: Change repository inspection from a persistent dashboard section to an accessible modal opened from a repository result.

## Impact

- Updates the dashboard renderer and stylesheet that define the library grid, repository rows, and inspector presentation.
- Updates dashboard DOM and accessibility tests for repository selection, modal lifecycle, and retention of existing inspector controls.
- Does not change GitHub APIs, browser permissions, storage schemas, synchronization, or mutation semantics.
