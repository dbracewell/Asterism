# Completed checklist: 2026-11-23

## Fixable high vulnerabilities

[EPIC-95](../epics/EPIC-95-FIXABLE-HIGH-VULNERABILITIES.md) is complete: US-95.1 to US-95.5 were each confirmed and merged through pull requests (#64, #66, #67, #69, #70), the last on 2026-11-23, and 0.3.1 (2026-11-23) shipped them. The image and both lockfiles have no fixable critical or high vulnerability, and since US-95.5 a fixable high fails CI, stops a release and opens the weekly scan's issue. One task moved to the maintenance follow-ups: taking the base image update that carries the fixed `zlib1g`, which `pnpm check:image` flags when it arrives.

- [x] US-95.1: Keep development packages out of the image (merged 2026-11-22, PR #64)
  - [x] Scan the image built after EPIC-94 and record its fixable highs in the epic, updating "Where things stand" when they differ.
  - [x] Stop `vitest` (better-auth's optional peer) and what it brings (`vite`, `jsdom`, `undici`) from reaching the production install, without changing the frontend's own test setup.
  - [x] Remove pip, and the packages it vendors, from the runtime stage. The build stages keep it to install uv.
  - [x] `pnpm check:image` fails if `vitest`, `vite` or `jsdom` is in the image's `node_modules`, or `pip` is importable by the image's system Python. Tests cover both.
  - [x] Release notes: Image (what was removed, and the new size).
- [x] US-95.2: Node packages (merged 2026-11-23, PR #66)
  - [x] Upgrade what is still flagged after US-95.1 (`fast-uri` through `ajv`, `browserslist`, and `source-map-js` through `next` → `postcss`) and the lockfile-only `brace-expansion` and `js-yaml`, with overrides only where a parent pins an old version.
  - [x] Tests: form validation through `@hookform/resolvers` and `ajv`; the frontend build and E2E.
  - [x] Dependabot shows no open high alert for `pnpm-lock.yaml`.
- [x] US-95.3: Python packages (merged 2026-11-23, PR #67)
  - [x] Upgrade `cryptography` (49 → 50), `filelock` (3 → 4), `soupsieve` (2 → 3 or 4) and `urllib3` (2.8) through `uv.lock`, with a constraint only where a parent caps one.
  - [x] Check each major in its changelog and with tests: JWT verification and PDF text extraction (cryptography); model downloads and the Hugging Face cache, including two at once (filelock); HTML to Markdown and the web fetch tool's extraction (soupsieve).
  - [x] Record in the pull request, for each, whether Asterism's use reaches the advisory.
  - [x] The upgrade check passes. Dependabot shows no open high alert for `uv.lock`.
- [x] US-95.4: OS packages (merged 2026-11-23, PR #69)
  - [ ] Take the base image update that carries `zlib1g` 1.3.1-1+deb13u1 (and any other fixed OS package by then), as a pinned digest. No newer base yet: the latest `python:3.13-slim-trixie` (2026-11-05) is the pinned digest and still has 1-1+b1, so the fallback below applies.
  - [x] If the base lags a fix by more than a week, the runtime stage upgrades that named package with a comment and the date, and a check fails once the base has caught up.
  - [x] The image checks and the theme storage and fetch browser checks pass.
- [x] US-95.5: Fail on fixable highs (merged 2026-11-23, PR #70; released in 0.3.1)
  - [x] `pnpm check:vulns` fails on a fixable high as well as a fixable critical, in CI, the release workflow and the weekly scan, and still prints the table. Tests cover the new threshold and `.trivyignore.yaml` entries for highs.
  - [x] The weekly scan's issue lists new fixable highs as well as criticals.
  - [x] Update the vulnerability scan section of `docs/development.md` and close EPIC-92's open question 1.
  - [x] Release notes: Image (the fixed packages, and that a fixable high now stops a release). Cut the release that ships the epic.
