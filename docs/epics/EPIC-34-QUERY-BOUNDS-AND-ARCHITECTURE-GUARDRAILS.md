# EPIC-34: Query bounds and architecture guardrails

Status: proposed / pending. Source: [2026-10-17 codebase review](../reviews/2026-10-17-codebase-review.md), F7 and architecture assessment.

## Objective

Keep the domain architecture, remove unbounded search candidates, and enforce the supported deployment contract.

Total estimate: 5–9 engineer-days including the newly observed E2E contract drift.
US-34.3 can be pulled forward before feature implementation to restore the full
browser gate; its repair is separate from this documentation review.

## Ownership and delivery

Implementation stays within the owning domain/component. Preserve existing authorization, shared mutation-cache invalidation and generated API contracts. Use fresh initialization for schema changes; no migrations, compatibility shims or live-database resets. Work on one story at a time, create its feature branch, complete relevant lint/type/format/test gates, synchronize generated clients when contracts change, document behavior and obtain user confirmation before merge.

## US-34.1: Keep indexed search filtering and pagination in the database

As a user with many chats, I want search work to remain bounded by the selected scope and page.

Estimate: 2–4 days. Dependencies: None.

Acceptance criteria:

Search composes owner/scope/match predicates in SQL without materializing every candidate ID or building a match-sized IN list. Count/order/page semantics remain deterministic. Page snippets are batched; owner isolation and literal-term parsing remain intact.

Tasks:

- [ ] Replace ID-list search results with a small composable SQL adapter contract owned by the search domain; keep common query helpers domain-neutral.
- [ ] Apply owner/project/General filtering before pagination; batch only selected-page snippet enrichment.
- [ ] Add large-match regressions and query/bind-count evidence for all/project/General scopes, plus cross-owner and deterministic-page tests.
- [ ] Run backend lint, full static typing and tests; document query ownership and supported SQLite behavior.

## US-34.2: Make module and deployment limits enforceable

As a maintainer, I want architecture drift and unsupported worker/storage assumptions caught before release.

Estimate: 2–3 days. Dependencies: None.

Acceptance criteria:

Tests enforce the existing execution-reader/retrieval dependency direction. Documentation and deployment validation state one coordinated backend process and SQLite support. FileStore Path and SQLite FTS/init limitations are explicit; future adapter contracts do not pretend PostgreSQL/object storage are implemented.

Tasks:

- [ ] Add focused import-boundary checks for neutral query mechanics, domain readers and injected agent/retrieval paths; allow explicit composition roots.
- [ ] Validate supported single-process deployment configuration and describe process-local jobs/gates/cache ownership.
- [ ] Assess concurrent active-job/controller admission limits separately from idle retirement; record capacity assumptions and add bounded admission where needed before multi-user load hardening.
- [ ] Record a small ADR for storage portability seams, including FileStore local Path and database initialization/search, without speculative adapters or migrations.
- [ ] Run gates in a clean CI-equivalent environment and keep architectural checks deterministic.

## US-34.3: Reconcile full browser contracts after agent-settings changes

Current evidence: [US-32.2 verification](../reviews/us-32.2-verification-2026-10-18.md) reconciled the remaining stale unavailable-model/controlled-picker selectors and recorded 72 passing isolated browser tests without retries. This story remains pending explicit contract audit/closure; the original failures below are historical.

As a maintainer, I want the full browser suite to protect current accessible UI
behavior without obsolete selectors masking functional regressions.

Estimate: 1–2 days. Dependencies: none; recommended early gate repair.

Acceptance criteria:

The two 2026-10-17 failures in `authenticated-workspace.spec.ts` and
`new-chat-agent.spec.ts` are triaged against intended UI behavior. Assertions target
the current Main Agent heading / Main configuration region, unavailable-model
status, and controlled model picker while retaining all model binding and scope
checks. The entire isolated suite passes without retries; any additional failures
revealed after the first stale assertion are repaired and recorded separately.

Tasks:

- [ ] Reconcile the Main configuration heading assertion with the current Main Agent heading and named region; preserve end-to-end ownership/provenance checks.
- [ ] Update unavailable-model status and obsolete Fixed model/option selectors against the controlled picker; preserve explicit selection and disabled-save assertions.
- [ ] Run both focused specs and the full isolated suite without retries, plus frontend lint/types/tests; record actual outcomes and update current verification docs.
