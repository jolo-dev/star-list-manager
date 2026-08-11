## 1. Model the derived Unlist view

- [ ] 1.1 Add `unlist` to the built-in library-view model and make it the initial dashboard view.
- [ ] 1.2 Derive an Unlist count from every repository with zero currently stored native-List memberships, without filtering out unstarred records.
- [ ] 1.3 Extend repository query matching, view title, and view identity to represent Unlist as a local derived view.

## 2. Simplify sidebar navigation

- [ ] 2.1 Render GitHub Lists as the only sidebar group and keep it present when no native Lists exist.
- [ ] 2.2 Render Unlist first, then render imported native Lists in the existing alphabetical order with their existing counts.
- [ ] 2.3 Remove Triage, Local tags, and Utilities sections and their sidebar navigation entries without changing their backing data or service behavior.

## 3. Verify behavior

- [ ] 3.1 Add unit tests for Unlist count and query semantics, including current stars, unstarred History records, existing native memberships, and absent native-List data.
- [ ] 3.2 Add DOM tests for the GitHub Lists-only sidebar, Unlist ordering and active state, and absence of removed navigation sections.
- [ ] 3.3 Run `env -u NODE_OPTIONS bun run check` and address any regressions.
