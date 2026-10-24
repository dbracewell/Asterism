# Todo

Completed Projects/Chat Context and provider-settings work remains in the existing archives. This checklist contains the pending findings from the [2026-10-17 review](docs/reviews/2026-10-17-codebase-review.md). See the [sequenced roadmap](docs/plans/post-refactor-quality-roadmap.md).

Archives: [2026-10-14](docs/archive/todo-completed-2026-10-14.md), [2026-10-15](docs/archive/todo-completed-2026-10-15.md), [2026-10-16](docs/archive/todo-completed-2026-10-16.md), [2026-10-17](docs/archive/todo-completed-2026-10-17.md), [2026-10-18](docs/archive/todo-completed-2026-10-18.md), [2026-10-19](docs/archive/todo-completed-2026-10-19.md), [2026-10-23](docs/archive/todo-completed-2026-10-23.md), [2026-10-24](docs/archive/todo-completed-2026-10-24.md), and [US-28.3 verification](docs/archive/us-28.3-verification-2026-10-17.md).

EPIC-31 and EPIC-32 are confirmed complete and archived above. US-38.1 through US-38.6 are confirmed complete and archived above. EPIC-33 (US-33.1 through US-33.3) is confirmed complete and archived above. US-36.1 and US-37.1 are already implemented and merged; their older completion/archive metadata needs reconciliation, not repeated implementation. See the [2026-10-24 reassessment](docs/reviews/2026-10-24-open-epics-reassessment.md). EPIC-34 (US-34.1 through US-34.4) is confirmed complete and archived above, including finite chat admission and the current browser baseline; the old agent-selector repairs are already present. EPIC-35 (US-35.1 and US-35.2) is confirmed complete and archived above. Execute one story at a time; obtain completion confirmation before merge.

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
