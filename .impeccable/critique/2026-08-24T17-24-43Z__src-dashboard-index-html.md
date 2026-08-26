---
target: src/dashboard/index.html
total_score: 29
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 2
timestamp: 2026-08-24T17-24-43Z
slug: src-dashboard-index-html
---
Method: dual-agent (A: f01f1060 · B: d7a74b56)

# Star List Manager Dashboard Critique

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|---|---:|---|
| 1 | Visibility of System Status | 4 | Stale, partial, selected, queued, retrying, failed, blocked, and authorization states are explicit and labeled. |
| 2 | Match System / Real World | 3 | Local/GitHub boundaries are excellent; “Unlist” and the generic H1 weaken natural collection language. |
| 3 | User Control and Freedom | 3 | Selection is reversible and high-risk work is review-gated, but blocked controls expand too aggressively. |
| 4 | Consistency and Standards | 2 | Expanded desktop Filters collide with the title/search row; global Library is not current while a nested List is. |
| 5 | Error Prevention | 4 | Destructive and remote actions are capability-gated, previewed, confirmed, and independently verified. |
| 6 | Recognition Rather Than Recall | 2 | The active collection and full account identity are not visible where users need them. |
| 7 | Flexibility and Efficiency | 3 | Search, Cards/List modes, filters, keyboard movement, and bulk selection are strong; one core filter state is broken. |
| 8 | Aesthetic and Minimalist Design | 2 | Resting state is calm; selected mobile state becomes a 912.8px administrative wall. |
| 9 | Error Recovery | 3 | Errors remain honest and actionable, but card-level recovery requires opening the record. |
| 10 | Help and Documentation | 3 | Inline safety help is accurate but repetitive in the selected mobile flow. |
| **Total** |  | **29/40** | **Good — strong system, material state-composition defects** |

## Design Specificity Verdict

**LLM assessment:** The dashboard feels authored for Star List Manager, not category-interchangeable. The List rail, repository-card library, local-versus-GitHub language, explicit mutation safety, real operation states, and restrained Geist/slate system form a coherent “calm working library.” Preserve this world; it does not need another redesign.

**Deterministic scan:** The source-shell CLI scan returned `[]` (0 findings) because `src/dashboard/index.html` is intentionally minimal. Browser injection over the rendered representative fixture found 10 visible items: six `hairline border with wide shadow` card overlays, one `line length too long` membership paragraph, two `overused font` banners (Geist Sans/Mono), and one `auto-scrolling marquee` banner for unused skeleton shimmer CSS. The font warnings are intentional role-based typography; the shimmer warning is a false positive in this state because no skeleton row is rendered. The line-length finding corroborates the overloaded membership surface. The card border/shadow combination is real but matches the deliberately restrained single-shadow system, so it is not a priority defect.

**Visual overlays:** Injection succeeded in a dedicated assessment tab and rendered overlays, but that tab and its live server were closed during required cleanup. No persistent user-visible overlay remains.

## Overall Impression

The resting dashboard is calm, trustworthy, and recognizably a private repository library. The strongest moment is the real three-column card grid. The biggest opportunity is to make expanded and selected states obey the same hierarchy: today, opening Filters can physically corrupt the desktop heading row, while selecting one repository can bury mobile results beneath nearly 1,000px of unavailable controls.

## Cognitive Load

**3/8 checklist failures — moderate load.**

- Pass: single primary retrieval focus in resting state.
- Pass: related navigation, retrieval, selection, warning, and record regions are grouped.
- Fail: unavailable remote work is not progressively disclosed after selection.
- Pass: high-stakes operations are sequenced into review and confirmation.
- Fail: several expanded decision sets exceed four visible options.
- Pass: Cards, sort, direction, archive, and star-state defaults are sensible.
- Fail: active List and full account context require inference.
- Pass: language describes effects rather than implementation.

Decision points exceeding four visible options: six repository records; six View options controls; seven language choices; eight advanced-filter controls; five triage choices.

## Emotional Journey

- **Entry:** Calm and credible, though mobile’s first viewport ends before a repository appears.
- **Peak:** The card library makes real repositories feel collected, legible, and operational.
- **Valleys:** Expanded desktop Filters overlap the title; selected mobile state pushes the first repository to document y≈1956.5.
- **High-stakes reassurance:** Excellent substance—selection is inert, remote effects are labeled, actions begin with Review, and unavailable mutations stay disabled.
- **Ending:** Honest but unresolved; failure and unknown states are visible, but list-level next steps remain diffuse.

## What's Working

1. **Product-specific trust language:** Local tags, remote Lists, selection, authorization, confirmation, and verification are never conflated.
2. **A coherent library expression:** Geist hierarchy, quiet slate material, real cards, and mono metadata deliver a distinct working-library world.
3. **Responsive resilience:** At 390px, document width equals viewport width, cards remain complete, long repository names wrap, and narrow-screen controls reach 44px.

## Priority Issues

### P1 — Expanded Filters corrupt the desktop heading row

- **Why it matters:** A core retrieval control cannot be opened without damaging the primary page identity and search affordance.
- **Evidence:** At 1440×1000, the expanded Filters state produced a measured **190×66.2px** intersection between the H1 and Search boxes.
- **Fix:** Keep H1, Search, Refresh, View options, and Filters trigger in a stable first row. Render `.filter-panel` as a full-width second row spanning the library header grid.
- **Suggested command:** `/impeccable layout`

### P1 — Blocked membership controls overwhelm mobile retrieval

- **Why it matters:** Selecting one repository creates a **912.8px** selection region; the first card begins around document y=1956.5 even though write authorization is unavailable.
- **Evidence:** The membership builder renders before readiness is available, then `WriteReadinessNotice` repeats the prerequisite.
- **Fix:** In blocked readiness, show a compact selection summary, Clear selection, disabled destructive review, and one account-specific authorization CTA. Reveal native List configuration only after readiness or behind `Manage GitHub Lists`.
- **Suggested command:** `/impeccable distill`

### P2 — Active collection and global destination are not named together

- **Why it matters:** Users must infer that generic `Starred repositories` is scoped to `Current List`, while global Library reports inactive.
- **Fix:** Use the active List name as H1 with a result-count subline; treat every List/Unlist subview as globally within Library while retaining exact rail currentness.
- **Suggested command:** `/impeccable clarify`

### P2 — Account-matched actions do not visibly name the account

- **Why it matters:** A lone `R` and generic `GitHub account` chip undercut reassurance at the precise point where remote effects matter.
- **Fix:** Show `GitHub account · review-librarian` in write-readiness, membership-review, and confirmation surfaces; keep the compact global initial.
- **Suggested command:** `/impeccable clarify`

### P3 — “Status” mislabels mobile View options and Filters

- **Why it matters:** The label describes neither disclosure accurately and adds unnecessary hierarchy.
- **Fix:** Rename it `View and filters` or visually hide the region heading at all widths because both disclosures are already labeled.
- **Suggested command:** `/impeccable clarify`

## Persona Red Flags

**Alex (Power User):** The active List is absent from the H1, expanded Filters break desktop layout, and selected mobile state places the next repository nearly 2,000px down the document. Keyboard result movement and bulk selection are strong, but the fast retrieval path collapses in exactly the advanced states Alex will use.

**Sam (Accessibility-Dependent):** Semantic labels, focus treatment, status text, and 44px mobile targets are strong. Red flags are the misleading global Library current state, the generic `Status` region label, and a long selected-state tab sequence dominated by disabled/unavailable controls.

**Developer Research Librarian:** Cards expose owner, description, language, date, triage, favorite, and mutation state, but not why a search matched local notes or List membership. A valid result can therefore feel unexplained, reducing confidence in retrieval.

## Minor Observations

- Decorative colored List dots can look semantic despite being unlabeled.
- Two full-width freshness warnings could share one compact “Library freshness” surface while preserving both messages.
- Card-level Failed/Blocked Unknown states could expose a compact recovery cue without requiring inspection.
- The account indicator’s full login exists accessibly but is not visually available at high-stakes decision points.
- The browser detector’s six card shadow findings reflect the intentional one-shadow vocabulary; do not remove depth mechanically.

## Questions to Consider

1. Why should users configure GitHub List membership before the required account authorization exists?
2. Is the workspace currently about `Current List` or all `Starred repositories`? The shell answers both.
3. Would a “Why this matched” line serve repository retrieval better than another metadata chip?
4. Can stale and partial state remain unmistakable in one compact freshness region instead of two full-width warning bands?
