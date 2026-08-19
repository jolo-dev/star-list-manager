# Rebuild Archive.Stars Reference Layout

## Why

The shipped Archive.Stars iteration changed visual tokens without fully replacing the old dashboard information architecture. It still presents card-heavy application surfaces instead of the sparse, indexed archive composition supplied in `redesign.md`.

## What Changes

- Recompose every dashboard view into one centered, editorial Archive.Stars frame.
- Replace panel/card composition with a directory index, archive content column, compact utilities, and divided repository records.
- Apply the same structural grammar to Library, Operations, Settings, state pages, confirmations, and inspection dialogs.
- Preserve every existing interaction, safety boundary, and data source.

## Non-goals

- No data/API/storage/authentication/runtime-message/mutation changes.
- No new dependencies or remote design assets.
- No fake reference content.

## Impact

- `src/dashboard/scripts.ts`, `src/dashboard/styles.css`, and dashboard DOM/style tests.
- Existing dashboard design change remains as the behavioral baseline; this change replaces its visual/layout composition.
