# Todo

Completed Projects/Chat Context and provider-settings work remains in the existing archives. This checklist contains the pending findings from the [2026-10-17 review](docs/reviews/2026-10-17-codebase-review.md). See the [sequenced roadmap](docs/plans/post-refactor-quality-roadmap.md).

Archives: [2026-10-14](docs/archive/todo-completed-2026-10-14.md), [2026-10-15](docs/archive/todo-completed-2026-10-15.md), [2026-10-16](docs/archive/todo-completed-2026-10-16.md), [2026-10-17](docs/archive/todo-completed-2026-10-17.md), [2026-10-18](docs/archive/todo-completed-2026-10-18.md), and [US-28.3 verification](docs/archive/us-28.3-verification-2026-10-17.md).

EPIC-31 and US-32.1 are confirmed complete; their checklists are archived above. **US-32.2 is recommended next**; no story is currently active. Execute one story at a time; obtain completion confirmation before merge.

## [EPIC-32: Responsive layout and reachability](docs/epics/EPIC-32-RESPONSIVE-LAYOUT-AND-REACHABILITY.md)

- [ ] US-32.2: Make settings, dialogs and file panes fit their containers
  - [ ] Audit actual flex/grid minimums, SettingsCard, Theme Editor and file grid; use shrinkable content and container-based adaptation where appropriate.
  - [ ] Define dialog height/scroll ownership and inspect every production dialog caller with long validation content.
  - [ ] Preserve unrelated settings URL parameters through the shared search-param helper.
  - [ ] Add browser tests at 320/390/768/1440px, 640px nested panes and short heights; verify hidden overflow and focused actions, not just scrollWidth.
- [ ] US-32.3: Bound rich chat content and composer overlap
  - [ ] Define renderer-level wrapping and local scroll policies for tables, code, math, images and long tokens.
  - [ ] Measure composer height or use flow layout so message clearance follows actual content instead of a fixed 150px reserve.
  - [ ] Test long tool arguments, citations, attachments and sidebar/panel combinations using synthetic stress content.
  - [ ] Add reachability assertions, screenshots and keyboard checks at mobile and nested desktop widths.

## [EPIC-33: Theme contrast and UI consistency](docs/epics/EPIC-33-THEME-CONTRAST-AND-UI-CONSISTENCY.md)

- [ ] US-33.1: Repair bundled palette mappings and contrast
  - [ ] Create a source/role mapping for Dracula, One Dark and Catppuccin; establish whether Black & Gold intends official branding and identify local-only palettes.
  - [ ] Adjust all 12 measured failing text pairs in public/themes; use canonical surfaces where appropriate and document deviations needed for readability.
  - [ ] Check input identification, focus rings, selected/hover states, destructive tints, sidebar and muted labels with composited colors.
  - [ ] Retain machine-readable contrast evidence and verify screenshots for every bundled theme.
- [ ] US-33.2: Unify semantic states, labels and typography
  - [ ] Replace feature-specific red/green/white states with documented semantic variants; avoid blindly rewriting library overlays.
  - [ ] Audit Theme Editor add/duplicate names and General settings control labels; preserve the setup passkey association repaired in US-32.1 and inspect related icon actions.
  - [ ] Fix undefined prose variables and global font overrides; map syntax highlighting deliberately to theme families.
  - [ ] Add reduced-motion behavior and verify focus, effective pointer target sizes and keyboard navigation across representative flows.
- [ ] US-33.3: Enforce a theme and layout review matrix
  - [ ] Add deterministic theme-schema and contrast checks based on unrounded luminance ratios.
  - [ ] Create a compact component/state fixture covering controls, focus, errors, typography and adversarial content using existing shadcn components.
  - [ ] Integrate rendered accessibility and overflow/reachability cases into CI and document the manual review matrix.

## [EPIC-34: Query bounds and architecture guardrails](docs/epics/EPIC-34-QUERY-BOUNDS-AND-ARCHITECTURE-GUARDRAILS.md)

- [ ] US-34.1: Keep indexed search filtering and pagination in the database
  - [ ] Replace ID-list search results with a small composable SQL adapter contract owned by the search domain; keep common query helpers domain-neutral.
  - [ ] Apply owner/project/General filtering before pagination; batch only selected-page snippet enrichment.
  - [ ] Add large-match regressions and query/bind-count evidence for all/project/General scopes, plus cross-owner and deterministic-page tests.
  - [ ] Run backend lint, full static typing and tests; document query ownership and supported SQLite behavior.
- [ ] US-34.2: Make module and deployment limits enforceable
  - [ ] Add focused import-boundary checks for neutral query mechanics, domain readers and injected agent/retrieval paths; allow explicit composition roots.
  - [ ] Validate supported single-process deployment configuration and describe process-local jobs/gates/cache ownership.
  - [ ] Assess concurrent active-job/controller admission limits separately from idle retirement; record capacity assumptions and add bounded admission where needed before multi-user load hardening.
  - [ ] Record a small ADR for storage portability seams, including FileStore local Path and database initialization/search, without speculative adapters or migrations.
  - [ ] Run gates in a clean CI-equivalent environment and keep architectural checks deterministic.

- [ ] US-34.3: Reconcile full browser contracts after agent-settings changes
  - [ ] Reconcile the Main configuration heading assertion with the current Main Agent heading and named region; preserve end-to-end ownership/provenance checks.
  - [ ] Update unavailable-model status and obsolete Fixed model/option selectors against the controlled picker; preserve explicit selection and disabled-save assertions.
  - [ ] Run both focused specs and the full isolated suite without retries, plus frontend lint/types/tests; record actual outcomes and update current verification docs.

## [EPIC-35: Product surface and persona foundations](docs/epics/EPIC-35-PRODUCT-SURFACE-AND-PERSONA-FOUNDATIONS.md)

- [ ] US-35.1: Make unfinished settings surfaces explicit
  - [ ] Inventory placeholder panes and choose hidden or explicit unavailable presentation; document their separate future feature ownership.
  - [ ] Update navigation/labels and keyboard/accessibility tests without inventing administration APIs.
  - [ ] Add a current-versus-planned capability inventory to READMEs and product planning.
- [ ] US-35.2: Implement distinct user persona/default-profile foundations
  - [ ] Write an ADR for persona ownership, default selection, USER.md limits and execution binding; distinguish it from agent_profiles and typed future memory namespaces.
  - [ ] Implement fresh-initialized schema/service invariants, atomic provisioning and owner-scoped persona lifecycle with race/authorization tests; no migrations or compatibility paths.
  - [ ] Expose typed APIs, regenerate Hey clients and implement profile selection/settings through TanStack Query and existing UI components.
  - [ ] Test prompt/provenance integration, default/delete races, cross-owner denial and unavailable/error states; document memory as future work and run all relevant gates.
