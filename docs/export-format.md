# Star List Manager Export Format

Exports are UTF-8 JSON documents with `format: "star-list-manager"` and `version: 1`.
Each document contains one GitHub account namespace identified by the stable numeric
`githubUserId` string.

## Version 1 Fields

- `exportedAt`: ISO date-time when the file was generated.
- `githubUserId`: account namespace required for import.
- `repositories`: last-known public repository metadata and star history.
- `nativeLists`: last-known native GitHub List metadata.
- `nativeMemberships`: public repository memberships keyed by List and repository node IDs.
- `annotations`: local triage state, tags, notes, favorite state, review time, and revisit date.
- `syncState`: non-secret completion, stale, page, skipped-item, and rate-limit metadata.
- `settings`: local preferences and export schema version.

Exports never contain access tokens, refresh tokens, device codes, authorization headers,
or records from another retained account namespace.

## Import Rules

The complete file is validated before preview or application. The active account ID must
match the file. Imports never delete local records.

- Missing records are added.
- Imported repository metadata only fills fields missing locally.
- Newer annotation `localModifiedAt` values replace local annotations.
- Equal annotation timestamps keep local data.
- Older annotation timestamps are reported as skipped conflicts.
- Settings are replaced only when explicitly selected in the preview.
