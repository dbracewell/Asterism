# EPIC-106: Screenshot baselines that stay current

Status: complete (2026-11-25). Source: user request (2026-11-25), from the
follow-ups after [EPIC-105](EPIC-105-DIAGRAMS-IN-CANVAS-EXPORTS.md): "The
`delegation-summary` screenshot tests fail on every local run."

## Objective

A full local E2E run on macOS passes without known screenshot failures, and the
next browser update that changes a baseline is caught when it lands rather than
weeks later.

Out of scope: running screenshot comparisons in CI (it would need a macOS runner
or Linux baselines rendered like GitHub's runners); tolerances on the existing
comparisons.

## Where things stand (verified 2026-11-25)

- Five specs use `toHaveScreenshot`: `agent-constellation`, `delegation-summary`,
  `shape-tokens`, `theme-shape` and `typography`. The baselines are macOS renders
  (`*-chromium-darwin.png`), and `playwright.config.ts` sets
  `ignoreSnapshots: process.platform !== "darwin"`, so CI on Linux skips the
  comparisons and still runs every other assertion.
- All six `delegation-summary` comparisons fail locally by **4 pixels each**: the
  anti-aliasing of the git-branch icon beside "Fork from here" (the old render
  left a stray dark pixel on each small circle; the new one is symmetric). No
  layout, colour or text changed.
- **Cause:** the baselines date from 2026-11-02 (US-56.6). Dependabot's npm group
  update of 2026-11-21 (91b5563d) moved Playwright from 1.60.0 to 1.65.1, with a
  newer Chromium. CI skips screenshots, so that update passed and nobody refreshed
  the baselines. The other four specs happen to have nothing the new rasterizer
  draws differently.

## Decisions

- **Refresh, don't loosen.** The six baselines are regenerated after checking the
  difference is only rasterization. No tolerance is added: the strict comparison
  caught a real rendering change, and a tolerance would also hide small layout
  shifts.
- **Make the refresh a step.** A `test:e2e:screenshots` script runs exactly the
  screenshot specs (and `--update-snapshots` refreshes them). The Dependabot
  review steps in `docs/development.md` say to run it on macOS for any update
  that moves Playwright, and to review every refreshed image before committing.

## User stories

### US-106.1: Refresh the baselines and add the review step

- [x] Regenerated the six `delegation-summary` baselines on macOS. Before and
      after, each differs from the old baseline in 16–21 pixels inside the two
      "Fork from here" icons and nowhere else; the image sizes are unchanged.
- [x] `pnpm test:e2e:screenshots` (`scripts/e2e-screenshots.mjs`) finds every
      spec that calls `toHaveScreenshot` (five today) and runs them through the
      isolated runner; extra arguments, such as `--update-snapshots`, go to
      Playwright. It refuses to run off macOS. Unit-tested.
- [x] The Dependabot review list in `docs/development.md` has the step for
      Playwright updates; the frontend testing docs and `scripts/README.md`
      describe the script.
- [x] A full isolated E2E run on macOS passes with no screenshot failures.
