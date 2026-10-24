# Todo

Completed Projects/Chat Context and provider-settings work remains in the existing archives. This checklist contains the pending findings from the [2026-10-17 review](docs/reviews/2026-10-17-codebase-review.md). See the [sequenced roadmap](docs/plans/post-refactor-quality-roadmap.md).

Archives: [2026-10-14](docs/archive/todo-completed-2026-10-14.md), [2026-10-15](docs/archive/todo-completed-2026-10-15.md), [2026-10-16](docs/archive/todo-completed-2026-10-16.md), [2026-10-17](docs/archive/todo-completed-2026-10-17.md), [2026-10-18](docs/archive/todo-completed-2026-10-18.md), [2026-10-19](docs/archive/todo-completed-2026-10-19.md), [2026-10-23](docs/archive/todo-completed-2026-10-23.md), [2026-10-24](docs/archive/todo-completed-2026-10-24.md), and [US-28.3 verification](docs/archive/us-28.3-verification-2026-10-17.md).

EPIC-31 and EPIC-32 are confirmed complete and archived above. US-38.1 through US-38.6 are confirmed complete and archived above. EPIC-33 (US-33.1 through US-33.3) is confirmed complete and archived above. US-36.1 and US-37.1 are already implemented and merged; their older completion/archive metadata needs reconciliation, not repeated implementation. See the [2026-10-24 reassessment](docs/reviews/2026-10-24-open-epics-reassessment.md). US-34.1 and US-34.3 are confirmed complete and archived above, including the current browser baseline; the old agent-selector repairs are already present. Execute one story at a time; obtain completion confirmation before merge.

## [EPIC-34: Query bounds and architecture guardrails](docs/epics/EPIC-34-QUERY-BOUNDS-AND-ARCHITECTURE-GUARDRAILS.md)

- [ ] US-34.2: Make module and deployment limits enforceable
  - [ ] Extend existing boundary tests for neutral query mechanics, domain readers and injected agent/retrieval paths; scan subpackages and allow named composition roots without duplicating EPIC-38 checks.
  - [ ] Enforce and test single-worker configuration in supported launch paths; document unsupported replicas and process-local jobs, guards, queues and caches.
  - [ ] Record a small ADR for storage portability seams, including FileStore local Path and database initialization/search, without speculative adapters or migrations.
  - [ ] Run gates in a clean CI-equivalent environment and keep architectural checks deterministic.
- [ ] US-34.4: Bound admission of active chat jobs and controllers
  - [ ] Record capacity units, global/per-owner limits, admission points and overload semantics; distinguish active chat work/controllers from existing knowledge/model gates and idle retirement.
  - [ ] Implement validated admission and bounded overload handling with capacity release on every terminal path; preserve reconnect and approval behavior.
  - [ ] Add saturation, concurrent admission, cancellation/disconnect/reconnect and release regressions; run backend gates and relevant browser/frontend checks and document limits.

## [EPIC-35: Product surface and persona foundations](docs/epics/EPIC-35-PRODUCT-SURFACE-AND-PERSONA-FOUNDATIONS.md)

- [ ] US-35.1: Finish planned-settings coverage and capability documentation
  - [x] Retain the implemented Planned badges, future-release panes and corrected labels delivered with US-33.2; no new placeholder navigation design is required.
  - [ ] Audit all five planned panes, correct remaining capability copy (including existing authorization versus planned Users administration), and cover badges/keyboard/accessibility without inventing APIs.
  - [ ] Add a current-versus-planned capability inventory to READMEs and product planning.
- [ ] US-35.2: Implement distinct user persona/default-profile foundations
  - [ ] Write an ADR for persona ownership, user-default versus chat selection, USER.md limits, edit/delete/default races and new-turn/resume/regeneration/delegation binding; distinguish it from `agent_profiles` and typed future memory namespaces.
  - [ ] Implement fresh-initialized schema/service invariants, atomic provisioning and owner-scoped persona lifecycle with race/authorization tests; no migrations or compatibility paths.
  - [ ] Expose typed APIs, regenerate Hey clients and implement profile selection/settings through TanStack Query and existing UI components.
  - [ ] Test immutable execution/prompt/provenance binding, edit/default/delete races, cross-owner denial, delegation ceilings and unavailable/error states; document memory as future work and run all relevant gates.

## [EPIC-36: Knowledge generation lifecycle](docs/epics/EPIC-36-KNOWLEDGE-GENERATION-LIFECYCLE.md)

- [x] US-36.1 (implemented and merged; completion metadata to reconcile): Bound, port, and align knowledge generations
  - [x] Add `KNOWLEDGE_GENERATION_RETENTION` (0–10, default 1) with runtime validation.
  - [x] Add `knowledge/retention.py` with a pure retention rule and the pruning routine; delete vectors before the rows that describe them, and keep a row when its vectors cannot be removed so the deletion retries.
  - [x] Prune after a generation settles (promoted to ready, or terminally failed) in the ingestion path.
  - [x] Declare the one-current-generation partial unique index for SQLite and PostgreSQL.
  - [x] Report the current generation (falling back to the newest when no generation is current yet) from file metadata and the knowledge-status endpoint.
  - [x] Cover the retention rule, pruning, dialect declaration and reporting with tests; run backend lint, type checks and the full test suite.
  - [x] Document the retention window and the reported-artifact rule in the file-knowledge, retrieval and data-storage architecture guides.

## [EPIC-37: Files domain correctness](docs/epics/EPIC-37-FILES-DOMAIN-CORRECTNESS.md)

- [x] US-37.1 (implemented and merged; completion metadata to reconcile): Correct content-cache invalidation, empty-file reporting, delete robustness, and schema cleanup
  - [x] Verify the stored source's digest on every read and invalidate the cached conversion when it no longer matches.
  - [x] Distinguish "no cached text" from "cached empty text" in the runtime read result, and treat an empty attachment as attached in the chat orchestrator.
  - [x] Guard the stored-source removal that runs after the delete commit, and log the previously silent swallowed failures.
  - [x] Drop the redundant `user_files` index and document why the composite unique constraint must stay.
  - [x] Add regression tests for each fix, verify they fail against the pre-fix implementation, and run the backend and frontend gates.
