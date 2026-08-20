---
version: 1
slug: "src-dashboard-index-html"
primary_target: "src/dashboard/index.html"
related_targets: []
---

## Scope and mode

- Scope: `src/dashboard/index.html` dashboard surface.
- Mode: replacement redesign direction; this task documents the direction without changing application behavior.

## Audience, job, and task

- Audience: people organizing real GitHub stars into local collections.
- Job: identify the active collection, find a repository, understand local and remote state, and act safely.
- Task: redesign the library-first dashboard around fast repository discovery and clear mutation context.

## Real content and safety constraints

Use real repository names, owners, descriptions, topics, timestamps, list membership, and sync states. Preserve mutation context, accessible semantics, and confirmation/recovery cues; never imply that a local or remote mutation succeeded before confirmation.

## Chosen reference direction

Reference-pinned minimal Git star manager, replacement direction, seed `82166ef0`: cool white and slate, locally bundled Geist Sans, softened rectangles, quiet borders, restrained shadow, dark ink actions, and semantic status color. Reject the generic developer-tool table and Archive.Stars brutalism.

## Memorable card-library moment

A spacious three-column grid of real repository cards sits beside the My Lists rail, making each repository feel collected, legible, and ready for a safe next action.

## Unresolved decisions

None.
