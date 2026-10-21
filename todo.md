# Todo

Completed Projects/Chat Context and provider-settings work remains in the existing archives. This checklist contains the pending findings from the [2026-10-17 review](docs/reviews/2026-10-17-codebase-review.md). See the [sequenced roadmap](docs/plans/post-refactor-quality-roadmap.md).

Archives: [2026-10-14](docs/archive/todo-completed-2026-10-14.md), [2026-10-15](docs/archive/todo-completed-2026-10-15.md), [2026-10-16](docs/archive/todo-completed-2026-10-16.md), [2026-10-17](docs/archive/todo-completed-2026-10-17.md), [2026-10-18](docs/archive/todo-completed-2026-10-18.md), [2026-10-19](docs/archive/todo-completed-2026-10-19.md), and [US-28.3 verification](docs/archive/us-28.3-verification-2026-10-17.md).

EPIC-31 and EPIC-32 are confirmed complete; their checklists are archived above. US-33.1 and US-33.2 are confirmed complete and archived above. US-33.3 is implemented and verified, awaiting completion confirmation on `feat/us-33.3-theme-layout-review-matrix`. US-38.1 is implemented and verified on `feat/us-38.1-knowledge-domain`, awaiting completion confirmation. Execute one story at a time; obtain completion confirmation before merge.

## [EPIC-33: Theme contrast and UI consistency](docs/epics/EPIC-33-THEME-CONTRAST-AND-UI-CONSISTENCY.md)

- [ ] US-33.3: Enforce a theme and layout review matrix
  - [x] Add deterministic theme-schema and contrast checks based on unrounded luminance ratios.
  - [x] Create a compact component/state fixture covering controls, focus, errors, typography and adversarial content using existing shadcn components.
  - [x] Integrate rendered accessibility and overflow/reachability cases into CI and document the manual review matrix.

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

## [EPIC-36: Knowledge generation lifecycle](docs/epics/EPIC-36-KNOWLEDGE-GENERATION-LIFECYCLE.md)

- [x] US-36.1: Bound, port, and align knowledge generations
  - [x] Add `KNOWLEDGE_GENERATION_RETENTION` (0–10, default 1) with runtime validation.
  - [x] Add `extraction/retention.py` with a pure retention rule and the pruning routine; delete vectors before the rows that describe them, and keep a row when its vectors cannot be removed so the deletion retries.
  - [x] Prune after a generation settles (promoted to ready, or terminally failed) in the ingestion path.
  - [x] Declare the one-current-generation partial unique index for SQLite and PostgreSQL.
  - [x] Report the current generation (falling back to the newest when no generation is current yet) from file metadata and the knowledge-status endpoint.
  - [x] Cover the retention rule, pruning, dialect declaration and reporting with tests; run backend lint, type checks and the full test suite.
  - [x] Document the retention window and the reported-artifact rule in the file-knowledge, retrieval and data-storage architecture guides.

## [EPIC-37: Files domain correctness](docs/epics/EPIC-37-FILES-DOMAIN-CORRECTNESS.md)

- [x] US-37.1: Correct content-cache invalidation, empty-file reporting, delete robustness, and schema cleanup
  - [x] Verify the stored source's digest on every read and invalidate the cached conversion when it no longer matches.
  - [x] Distinguish "no cached text" from "cached empty text" in the runtime read result, and treat an empty attachment as attached in the chat orchestrator.
  - [x] Guard the stored-source removal that runs after the delete commit, and log the previously silent swallowed failures.
  - [x] Drop the redundant `user_files` index and document why the composite unique constraint must stay.
  - [x] Add regression tests for each fix, verify they fail against the pre-fix implementation, and run the backend and frontend gates.

## [EPIC-38: Knowledge pipeline structure](docs/epics/EPIC-38-KNOWLEDGE-PIPELINE-STRUCTURE.md)

- [ ] US-38.1: Name the knowledge domain for what it holds
  - [x] Rename `domains/extraction` to `domains/knowledge`, the artifact model to `FileKnowledgeArtifactModel` and the table to `file_knowledge_artifacts`.
  - [x] Update all backend, test and documentation references, including the frontend's generated client types.
  - [x] Re-check the vocabulary: no "extraction" may remain as a domain, package, table or model name.
  - [x] Record ADR-0018 covering the domain boundary, the vocabulary decision and the rejected alternatives.
  - [x] Run backend lint, type checks and the full test suite; verify a fresh database initialization creates the renamed table.
- [ ] US-38.2: Give the processing policy one owner
  - [ ] Move the processing-policy schemas, persistence and transitions from `files` and `settings` into the knowledge domain.
  - [ ] Move the knowledge admin endpoints to a knowledge router, preserving their URLs, operation ids and response shapes.
  - [ ] Remove the deferred cross-domain imports that exist only to break the settings/files cycle.
  - [ ] Verify the OpenAPI contract is unchanged for the moved endpoints and regenerate the client if the operation grouping changed.
  - [ ] Run backend lint, type checks and the full test suite.
- [ ] US-38.3: Model derived facets as first-class rows
  - [ ] Add the extraction-kind enum and the linking table with a unique `(artifact_id, kind)` constraint.
  - [ ] Replace the parallel artifact and caption status vocabularies with one status vocabulary for every kind.
  - [ ] Move the caption's flat columns, the text content and the embedding readiness flags into per-kind rows; keep a denormalized searchable aggregate on the artifact row for the retrieval path.
  - [ ] Model payloads as a discriminated union keyed by kind, validated at the application boundary.
  - [ ] Replace the flat API fields with a map of extractions; regenerate the typed client and update the file manager and file view to render the per-kind statuses.
  - [ ] Add retrieval, file-library and file-view regressions for the new shape.
- [ ] US-38.4: Make the dependency direction explicit
  - [ ] Publish a narrow artifact reader/service in the knowledge domain and route the files domain's knowledge operations through it.
  - [ ] Replace the files domain's deferred imports of the artifact model, artifact queries and ingestion runtime.
  - [ ] Inject the source reader into ingestion, mirroring the existing injected embedding provider, vector store and caption request hook.
  - [ ] Add an import-boundary test that fails when a knowledge module imports the files domain at module level.
- [ ] US-38.5: Retire the dead caption review contract and reconcile the docs
  - [ ] Decide and record the disposition of the caption review lifecycle: implement it as per-extraction states, or remove it from the product and the documentation.
  - [ ] Remove the never-written caption review fields and make the generation timestamp describe the extraction rather than the artifact.
  - [ ] Correct the caption state names in the file-knowledge, retrieval and data-storage architecture guides.
  - [ ] Run the full backend and frontend gates and the documentation checks.
