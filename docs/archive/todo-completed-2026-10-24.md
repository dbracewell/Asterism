# Completed checklist — 2026-10-24

The user confirmed completion and requested merging all pending metadata-cleanup
and epic-reassessment work into local `main` on 2026-10-24. The US-33.3 section
below separately archives its already-merged implementation tasks and completion
reconciliation, confirmed by the user on 2026-10-24.

## [EPIC-38: Knowledge pipeline structure](../epics/EPIC-38-KNOWLEDGE-PIPELINE-STRUCTURE.md)

- [x] US-38.6: Remove unused artifact metadata
  - [x] Remove the two unused artifact columns, writes and API fields while retaining policy fingerprint change detection and generation-based artifact reuse.
  - [x] Regenerate the typed client and update backend/frontend fixtures and API contract assertions.
  - [x] Update current architecture/readme descriptions and reconcile the affected pending browser-fixture audit item.
  - [x] Run focused/full backend and frontend quality gates, fresh-schema/API checks and the affected isolated browser spec; record results.

Verification: 531 backend tests, 352 frontend tests, six migration checks,
30 configuration checks, lint, formatting and final typecheck passed. Fresh
SQLite/OpenAPI checks passed. The affected isolated browser run passed 12 tests
with no retries, including its fresh-install prerequisite. Full browser baseline
work remains US-34.3. See the epic for the initial typecheck diagnostic and
verification details.

## US-33.3 — Theme and layout review matrix

Implementation merged into `main` as `70fcad8`; ancestry reverified 2026-10-24.
The user confirmed completion and authorized commit and local merge of the
documentation reconciliation on 2026-10-24. EPIC-33 is confirmed complete.

- [x] US-33.3: Enforce a theme and layout review matrix
  - [x] Add deterministic theme-schema and contrast checks based on unrounded luminance ratios.
  - [x] Create a compact component/state fixture covering controls, focus, errors, typography and adversarial content using existing shadcn components.
  - [x] Integrate rendered accessibility and overflow/reachability cases into CI and document the manual review matrix.

- [x] Reconcile completion records, obtain user confirmation and authorize local merge.

Historical verification: [2026-10-19 record](../reviews/us-33.3-verification-2026-10-19.md),
including 119 isolated browser cases without retries, 24 layout records and
744 rendered contrast checks. Fresh reconciliation: [2026-10-24 record](../reviews/us-33.3-completion-reconciliation-2026-10-24.md),
including 96 passing palette unit cases. Historical browser evidence is not a
current-tree browser result; US-34.3 owns that baseline.

## US-34.3 — Current browser baseline and live contracts

The user confirmed completion and authorized commit and local merge on 2026-10-24.

- [x] US-34.3: Establish the current browser baseline and reconcile live contracts
  - [x] Run and record the current full isolated suite without retries; classify failures against live code and retain existing agent/model contract coverage.
  - [x] Reconcile demonstrated assertion/fixture drift and product defects, including EPIC-38 file-knowledge contracts and valid mocked response shapes, without weakening scope, ownership or accessibility checks.
  - [x] Run affected focused specs and the full isolated suite without retries, plus frontend lint/types/tests; record actual outcomes, skip/flaky counts and update verification docs.
        Verification: 122 full isolated browser cases and 72 focused cases passed without
        retries, skips or flaky results. The full run recorded zero unhandled page errors.
        Frontend lint/types, 352 unit tests, six auth-migration checks and scoped formatting
        passed. See the [verification record](../reviews/us-34.3-verification-2026-10-24.md)
        for the initial 30 failures, repairs, diagnostics and limits.

## US-34.1 — Database-side indexed search and page snippets

The user confirmed completion and authorized commit and local merge on 2026-10-24.

- [x] US-34.1: Keep indexed search filtering and pagination in the database
  - [x] Replace ID-list results in `chat/search_index.py` with composable SQL match relations consumed by `chat/search.py`; keep owner-scoped queries in their domains and `db/queries.py` domain-neutral.
  - [x] Apply owner/project/General filtering before pagination; batch only selected-page snippet enrichment.
  - [x] Add large-match regressions and query/bind-count evidence for all/project/General scopes, plus cross-owner and deterministic-page tests.
  - [x] Run backend lint, full static typing and tests; document query ownership and supported SQLite behavior.
        Verification: 543 backend tests, 352 frontend unit tests, six auth-migration
        checks and 30 configuration tests passed. All 122 isolated browser cases passed
        without retries, skips, flaky results or unhandled page errors. Root lint/types
        and changed-file formatting passed. Seven pre-existing broad backend formatting
        findings remain untouched. See the [verification record](../reviews/us-34.1-verification-2026-10-24.md)
        for query/bind-count evidence, diagnostics and limitations.
