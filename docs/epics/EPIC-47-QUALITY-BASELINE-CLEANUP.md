# EPIC-47: Quality baseline cleanup

Status: complete (US-47.1 through US-47.4). Source: the EPIC-46 close-out (2026-10-30), which found
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

- [x] Run the full isolated suite; triage and fix each failing spec.

Implementation notes: the clean-checkout baseline failed 17 of 209 specs.
Fixes, by cause:

- Real defects: on short viewports the Files page shrank its file manager
  below its content, so the toolbar overlapped the list and the list could not
  scroll; the page now keeps a minimum height and scrolls instead. Replies again
  show their recorded model, now in the message meta row (provider and
  configuration revision in its title), restoring per-message provenance that
  the pre-redesign label used to show.
- Stale harness and assertions: the new-chat agent harness lacked a
  `UserProvider`; the chat model session spec still expected the removed
  context-window text and General-scope notice, and its capability assertion
  is now scoped to the selected-model group.
- Visual baselines: shape-tokens and theme-shape snapshots predated the theme
  gallery and sticky save bar; the theme-shape preview is scrolled clear of the
  save bar, and typography now waits for its settled image states, since its
  old baseline captured loading spinners. Snapshots are macOS renders, so other
  platforms set `ignoreSnapshots` and skip only the screenshot comparisons.

## US-47.4: Deterministic local browser runs

As a contributor, I want local multi-worker browser runs to give the same
result as CI.

Estimate: 1 day. Dependencies: US-47.3.

Acceptance: repeated local runs with default workers pass without changes to
test timeouts or retries.

- [x] Find the source of the cold-start failures; warm or otherwise stabilize the server before specs; verify with repeated runs.

Implementation notes: with 9 local workers the suite failed 34 specs, varying
by run. Traces showed Fast Refresh rebuilds and full reloads mid-spec: `next
dev` compiles routes and chunks on demand and refreshes every open page.
Warming routes first (34 → 12) and keeping compiled pages resident did not stop
the rebuilds, so Playwright now serves a production build (`next build`, then
`next start`); `E2E_DEV_SERVER=1` keeps `next dev` for iteration. Production
mode enables Better Auth's rate limiter, which rejected parallel sign-ups, so the
`test` profile disables it. One sub-pixel visibility check in the model-popup
spec now tolerates half a pixel. Result: 209/209 in about 50 seconds with 9
workers on repeated runs (one earlier run hit the sub-pixel case), and 209/209
in CI mode.
