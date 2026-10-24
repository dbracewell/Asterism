# EPIC-34: Query bounds and architecture guardrails

Status: EPIC-34 (US-34.1 through US-34.4) confirmed complete on 2026-10-24.
Completed checklist history is [archived](../archive/todo-completed-2026-10-24.md). Source: [2026-10-17 codebase review](../reviews/2026-10-17-codebase-review.md), F7 and architecture assessment.

## Objective

Keep the domain architecture, remove unbounded search candidates, and enforce the supported deployment contract.

Reassessed against `main` at `1e188a7` on 2026-10-24. See the
[current-source assessment](../reviews/2026-10-24-open-epics-reassessment.md).
US-34.1 now closes the indexed-search candidate materialization gap. US-34.2 retains only guardrails
not already delivered by EPIC-38; active-job admission is separated into
US-34.4. US-34.3 establishes the current browser baseline rather than repeating
selector repairs already present in source. Story estimates are provisional;
re-estimate browser repair after the baseline run.

## Ownership and delivery

Implementation stays within the owning domain/component. Preserve existing authorization, shared mutation-cache invalidation and generated API contracts. Use fresh initialization for schema changes; no migrations, compatibility shims or live-database resets. Work on one story at a time, create its feature branch, complete relevant lint/type/format/test gates, synchronize generated clients when contracts change, document behavior and obtain user confirmation before merge.

## US-34.1: Keep indexed search filtering and pagination in the database

Status (2026-10-24): implemented and verified on
`feat/us-34.1-bounded-chat-search`; the user confirmed completion on 2026-10-24
and authorized commit and local merge. See the [verification record](../reviews/us-34.1-verification-2026-10-24.md)
and [query-bound measurements](../reviews/us-34.1-query-bounds-2026-10-24.json).
Matching stays in SQL; page snippets use one owner-filtered window query. Root
lint/types/tests and all 122 isolated browser cases passed. Changed-file
formatting passes; seven pre-existing broad backend formatting findings are
recorded separately and remain untouched.

As a user with many chats, I want search work to remain bounded by the selected scope and page.

Estimate: 2–4 days. Dependencies: None; retain current search semantics and domain ownership.

Acceptance criteria:

Search composes owner/scope/match predicates in SQL without materializing every
candidate ID or building a match-sized IN list. The adapter remains in the chat
domain (`chat/search_index.py`), alongside `chat/search.py` and owner-scoped
`chat/queries.py`; no new generic search domain/framework is needed. Count and
page queries share the same filtered match relation and deterministic mixed
chat/project order. Snippet queries are batched for the selected page, without
one query per chat. Owner isolation, all/project/General behavior, all-keyword
matching and literal-term parsing remain intact.

Tasks:

- [x] Replace ID-list results in `chat/search_index.py` with composable SQL match relations consumed by `chat/search.py`; keep owner-scoped queries in their domains and `db/queries.py` domain-neutral.
- [x] Apply owner/project/General filtering before pagination; batch only selected-page snippet enrichment.
- [x] Add large-match regressions and query/bind-count evidence for all/project/General scopes, plus cross-owner and deterministic-page tests.
- [x] Run backend lint, full static typing and tests; document query ownership and supported SQLite behavior.

## US-34.2: Make module and deployment limits enforceable

Status (2026-10-24): implemented and verified on
`feat/us-34.2-architecture-deployment-guards`; the user confirmed completion on
2026-10-24 and authorized commit and local merge. [ADR-0019](../adr/0019-single-process-runtime-and-storage-seams.md)
records the enforced launcher, named import exceptions and current storage seams.
The [verification record](../reviews/us-34.2-verification-2026-10-24.md) separates
52 focused cases, the clean-export quality run (590 backend / 352 frontend),
122 zero-retry browser cases, ten Linux worker-guard checks and known limits.

As a maintainer, I want architecture drift and unsupported worker/storage assumptions caught before release.

Estimate: 1–2 days. Dependencies: EPIC-38 boundaries are implemented; coordinate neutral-query checks with US-34.1.

Acceptance criteria:

Extend the existing boundary coverage rather than duplicate it.
`test_knowledge_domain_boundaries.py` already protects settings/knowledge and
files/knowledge direction, including deferred imports. New checks cover neutral
query mechanics and injected agent/retrieval/domain readers, with explicit
composition-root exceptions and recursive package coverage.

The documented single-backend-process/SQLite deployment remains the supported
contract. Supported package/container launch paths reject configurable
multi-worker modes and test their default single-worker behavior; documentation
also identifies multiple replicas as unsupported. Local validation does not
claim to detect arbitrary external replicas. FileStore's local `Path` contract,
SQLite FTS/init dependencies, process-local jobs/guards, and knowledge-job queues
are documented in an ADR. PostgreSQL index declarations do not certify a working
PostgreSQL adapter. Global active-job/controller admission belongs to US-34.4.

Tasks:

- [x] Extend existing boundary tests for neutral query mechanics, domain readers and injected agent/retrieval paths; scan subpackages and allow named composition roots without duplicating EPIC-38 checks.
- [x] Enforce and test single-worker configuration in supported launch paths; document unsupported replicas and process-local jobs, guards, queues and caches.
- [x] Record a small ADR for storage portability seams, including FileStore local Path and database initialization/search, without speculative adapters or migrations.
- [x] Run gates in a clean CI-equivalent environment and keep architectural checks deterministic.

## US-34.3: Establish the current browser baseline and reconcile live contracts

Status (2026-10-24): implemented and verified on
`feat/us-34.3-browser-baseline`; the user confirmed completion on 2026-10-24
and authorized commit and local merge. The [verification record](../reviews/us-34.3-verification-2026-10-24.md)
classifies the 89-pass/30-failure initial baseline and records the final
122-pass, zero-retry full isolated gate, 72 focused cases and frontend checks.
The repair includes modal model-popup pointer/focus/Escape behavior, current
selectors and complete knowledge-artifact mocks. Scope, ownership, revocation,
provenance and contrast thresholds remain asserted.

Source audit (2026-10-24): `authenticated-workspace.spec.ts` already scopes the
Main Agent heading to the Main configuration region. `new-chat-agent.spec.ts`
already checks the unavailable fixed-model status, controlled picker, explicit
replacement selection and disabled save. The original two 2026-10-17 selector
repairs are implemented. Historical full passes (72 cases for US-32.2, 119 for
US-33.3) do not establish the current EPIC-38 tree's browser status. The later
handoff reported ten failures on both compared branches; that comparison is
historical and does not establish a clean gate or a current failure count.

As a maintainer, I want the full browser suite to verify the current auth,
agent/model, file-knowledge and settings contracts without weakening ownership,
provenance or accessibility assertions.

Estimate: 0.5–2 days, revised after the first current-tree run. Dependencies:
EPIC-38 is merged; run before new feature work to obtain an actionable baseline.

Acceptance criteria:

Record one full isolated, disposable-storage run with `CI=1` and `--retries=0`
on the current commit, including failures and skip/flaky counts. Classify each
failure against live implementation and generated contracts before editing it;
separate product defects, stale assertions/fixtures and runner/startup failures.
Retain the existing Main Agent/unavailable-binding tests instead of scheduling
those fixes again. Audit EPIC-38's `extractions` map, shared statuses, regeneration,
and absence of caption edit/clear/review actions in fixtures and assertions.
Mocks must honor the current required IDs and response fields. US-38.6 removes
the unused artifact fingerprint and contract-version fields, including the
invalid placeholder fingerprint identified in the source audit. Do not restore
those retired fields or treat their removal as evidence that unrelated browser
failures were reproduced or fixed.

After any necessary repairs, both affected focused specs and the entire isolated
suite pass without retries or unexplained skips, with no unhandled browser
errors. Preserve real-auth owner denial, project/General scope, live revocation,
fixed model bindings, explicit replacement selection and disabled-save behavior.
An unchanged failure set between branches is not a passing gate.

Tasks:

- [x] Run and record the current full isolated suite without retries; classify failures against live code and retain existing agent/model contract coverage.
- [x] Reconcile demonstrated assertion/fixture drift and product defects, including EPIC-38 file-knowledge contracts and valid mocked response shapes, without weakening scope, ownership or accessibility checks.
- [x] Run affected focused specs and the full isolated suite without retries, plus frontend lint/types/tests; record actual outcomes, skip/flaky counts and update verification docs.

## US-34.4: Bound admission of active chat jobs and controllers

This is the active-capacity task previously embedded in US-34.2, separated so
architecture/deployment guardrails have a bounded scope.

As an operator, I want active work and attached connections to have explicit
admission limits so resource use cannot grow solely with concurrent clients.

Estimate: 1–3 days after capacity-policy decisions. Dependencies: US-34.2's
single-process contract; restore the current browser baseline before UI error work.

Acceptance criteria:

`ChatJobManager` already retires idle detached jobs and prevents two generations
in one chat. That is retained; it is not a global active-job or controller cap.
Define validated finite limits for active generation and attached controllers
with an explicit global/per-owner policy and overload response. Admission checks
must happen before creating unbounded work, avoid an unbounded waiting queue,
and release capacity on normal completion, provider failure, cancellation,
disconnect and shutdown. Reconnects retain the existing connection-independent
generation semantics and do not duplicate active work. Document which knowledge
job/model gates already exist and which resources this story limits; do not
claim general multi-user load certification or distributed coordination.

Tasks:

- [x] Record capacity units, global/per-owner limits, admission points and overload semantics; distinguish active chat work/controllers from existing knowledge/model gates and idle retirement.
- [x] Implement validated admission and bounded overload handling with capacity release on every terminal path; preserve reconnect and approval behavior.
- [x] Add saturation, concurrent admission, cancellation/disconnect/reconnect and release regressions; run backend gates and relevant browser/frontend checks and document limits.

Implemented policy: [ADR-0020](../adr/0020-chat-capacity-admission.md).
Evidence and current gate status:
[US-34.4 verification](../reviews/us-34.4-verification-2026-10-24.md).
