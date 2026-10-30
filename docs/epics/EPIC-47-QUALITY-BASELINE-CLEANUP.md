# EPIC-47: Quality baseline cleanup

Status: in progress. Source: the EPIC-46 close-out (2026-10-30), which found
`main` failing gates that each story had to work around.

## Objective

Make every quality gate on `main` green and trustworthy, so later stories can
treat any failure as their own. Today `pnpm format` rewrites files that were
never formatted, one frontend unit test and several browser specs fail on a
clean checkout, and local multi-worker browser runs fail different specs on
each run.

## Ownership and delivery

Tests, tooling and CI only. Product behavior changes only where a failing test
exposes a real defect; stale tests are updated to the current, intended UI.
Stories are stacked branches, merged in order after confirmation.

## US-47.1: Format gate

As a contributor, I want formatting enforced so `pnpm format` only touches my
own changes.

Estimate: 0.5 day. Dependencies: none.

Acceptance: the repository is formatted; a non-writing `format:check` runs for
both workspaces from the root and in the `quality-gates` CI job.

- [x] Format the existing drift; add backend and frontend `format:check` scripts and a root script; run it in CI.

## US-47.2: Unit test baseline

As a contributor, I want the unit suites green on a clean checkout.

Estimate: 0.5 day. Dependencies: US-47.1.

Acceptance: `pnpm test` passes. Each failing test is either updated to the
current intended UI or the defect it exposes is fixed.

- [x] Triage and fix the failing frontend unit test(s); confirm the backend suite stays green.

## US-47.3: Browser test baseline

As a contributor, I want the CI browser suite green on a clean checkout.

Estimate: 1 day. Dependencies: US-47.2.

Acceptance: `node scripts/run-isolated-e2e.mjs --retries=0` passes in CI mode
(one worker). Each failing spec is updated to the current intended UI or the
defect it exposes is fixed.

- [ ] Run the full isolated suite; triage and fix each failing spec.

## US-47.4: Deterministic local browser runs

As a contributor, I want local multi-worker browser runs to give the same
result as CI.

Estimate: 1 day. Dependencies: US-47.3.

Acceptance: repeated local runs with default workers pass without changes to
test timeouts or retries, because the development server has compiled the
tested routes before specs start.

- [ ] Find the source of the cold-start failures; warm or otherwise stabilize the server before specs; verify with repeated runs.
