# EPIC-95: No fixable high vulnerabilities

Status: in progress (US-95.1 merged 2026-11-22, PR #64; US-95.2 merged
2026-11-23, PR #66; proposed 2026-11-22). Source:
user request (2026-11-22), after EPIC-92 left fixable highs reported but not
failing. Starts after EPIC-94, which changes the Python dependency tree.

## Objective

The published image and both lockfiles have no high-severity vulnerability that
has a fix, and CI keeps it that way: from the end of this epic a fixable high
fails CI and stops a release, as a fixable critical already does (US-92.2).

Out of scope: highs with no fix (still reported); medium and low findings;
replacing a dependency only to lower its finding count.

## Where things stand (verified 2026-11-22)

Trivy 0.76.2 on the published 0.2.2 image (amd64), with Dependabot's open alerts
on `main`. No fixable critical is open.

| Where                        | Fixable highs                                                                                                                                                                                                                                                                                                                     |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Test tooling in the image    | `vitest` is an optional peer dependency of better-auth 1.7.26. pnpm resolves it into the production install, so `vitest`, `vite` 8.0.16, `jsdom` and `undici` 7.27.1 (8 advisories, fixed in 7.30.1) are in the image's `node_modules`, though nothing at run time uses them. `source-map-js` 1.2.1 comes in through `jsdom` too. |
| Other Node packages          | `fast-uri` 3.1.2 (5 advisories, fixed in 3.1.7), through `ajv` from `@hookform/resolvers`; `browserslist` 4.28.2 (fixed in 4.28.7), through `@babel/core`.                                                                                                                                                                        |
| Python packages (`uv.lock`)  | `cryptography` 49.0.0 → 50.0.0 (via PyJWT's crypto extra and pdfminer.six); `filelock` 3.32.0 → 4.2.1 (via huggingface-hub; it stays after EPIC-94); `soupsieve` 2.9.1 → 3.0.2 or 4.0.0 (via beautifulsoup4); `urllib3` 2.7.0 → 2.8.0 (via requests and lance). Three of these are major versions.                                |
| The base image's own pip     | `/usr/local/lib/python3.13/site-packages/pip` in the runtime stage vendors `msgpack` 1.1.2, `setuptools` 70.3.0 and a second `urllib3` 2.7.0. Nothing in the running image uses pip: the app runs from `/app/apps/backend/.venv`.                                                                                                 |
| OS packages                  | `zlib1g` 1.3.1-1+b1, fixed in 1.3.1-1+deb13u1, from the pinned `python:3.13-slim-trixie` base.                                                                                                                                                                                                                                    |
| Lockfile only (not in image) | Dependabot also lists `brace-expansion` and `js-yaml` in `pnpm-lock.yaml`, from development tooling. In all: 35 open high alerts in 12 packages.                                                                                                                                                                                  |

The image findings are 31 advisories in 12 packages. EPIC-94 removes torch and
diffusers but none of these packages, so the list above is expected to hold;
US-95.1 checks it again first.

**Rescanned after EPIC-94 (2026-11-22, US-95.1).** Trivy 0.76.2 on an image
built from `main` at 0.3.0 (arm64): still 31 fixable highs in the same 12
packages, but the advisory counts moved. `undici` 7.27.1 now has 10 (fixed in
7.30.1), `fast-uri` 3.1.2 has 7 (fixed in 3.1.7), and pip's vendored `msgpack`
1.1.2 and `setuptools` 70.3.0 have 2 and 1. One attribution was wrong:
`source-map-js` 1.2.1 comes through `next` → `postcss`, a runtime dependency,
not through `jsdom`, so it moves to US-95.2. After US-95.1 the image has 17
fixable highs in 8 packages: `browserslist`, `fast-uri` and `source-map-js`
(US-95.2); `cryptography`, `filelock`, `soupsieve` and `urllib3` (US-95.3, with
`urllib3` now only in the backend's venv); and `zlib1g` (US-95.4).

## Decisions

- **One story at a time,** each confirmed and merged on its own, after EPIC-94.
- **Remove before upgrading.** A package the running image never uses is taken
  out of the image rather than upgraded: test tooling from `node_modules`, and
  pip from the runtime stage. That fixes its findings for good and makes the
  image smaller.
- **Upgrade through the lockfiles,** within pnpm's `minimumReleaseAge` or with a
  dated exclusion, as in US-92.0. Where a parent package pins an old version, an
  `overrides` entry in `pnpm-workspace.yaml` or a `constraint-dependencies`
  entry in `apps/backend/pyproject.toml` raises it, each
  with a comment naming the advisory, and comes out once the parent catches up.
- **A major version is checked, not assumed:** its changelog is read and the
  features that reach it are tested (listed in each story).
- **OS packages come from the base image.** A fixed Debian package arrives by
  updating the pinned base digest (Dependabot's docker updates, US-92.1). Only
  if the base lags the fix by more than a week does the runtime stage upgrade
  that named package itself.
- **Then fixable highs fail CI.** This answers EPIC-92's open question 1. An
  accepted finding goes in `.trivyignore.yaml` with a reason and an expiry, as
  for criticals.

## User stories

Suggested order: US-95.1 → 95.2 → 95.3 → 95.4 → 95.5.

### US-95.1: Keep development packages out of the image

As an administrator, the image holds only what Asterism runs.

- [x] Scan the image built after EPIC-94 and record its fixable highs in this
      epic, updating "Where things stand" when they differ.
- [x] Stop `vitest` (better-auth's optional peer) and what it brings (`vite`,
      `jsdom`, `undici`) from reaching the production install,
      without changing the frontend's own test setup. `pnpm why <package> --prod`
      in `apps/frontend` finds none of them.
- [x] Remove pip, and the packages it vendors, from the runtime stage. The build
      stages keep it to install uv.
- [x] `pnpm check:image` fails if `vitest`, `vite` or `jsdom` is in the image's
      `node_modules`, or `pip` is importable by the image's system Python. Tests
      cover both.
- [x] Release notes: Image (what was removed, and the new size).

### US-95.2: Node packages

As an administrator, the frontend's packages have no fixable high.

- [x] Upgrade what is still flagged after US-95.1 (`fast-uri` through `ajv`,
      `browserslist`, and `source-map-js` through `next` → `postcss`) and the lockfile-only `brace-expansion` and
      `js-yaml`, through `pnpm-lock.yaml`, with overrides only where a parent pins
      an old version. Done: Dependabot also flagged `vite` and `undici` (dev-only
      after US-95.1, through `vitest` and `jsdom`), so they were upgraded too.
      Only `js-yaml` needed an override (`@hey-api/json-schema-ref-parser` 1.4.4,
      the latest, pins 4.2.0). The stale package-manager document in
      `pnpm-lock.yaml`, which pinned pnpm 11.5.0, was removed.
- [x] Tests: form validation through `@hookform/resolvers` and `ajv`; the
      frontend build and E2E.
- [x] Dependabot shows no open high alert for `pnpm-lock.yaml`. On
      2026-11-23 it lists 1 low and 3 medium alerts there, and no high.

### US-95.3: Python packages

As an administrator, the backend's packages have no fixable high.

- [x] Upgrade `cryptography` (49 → 50), `filelock` (3 → 4), `soupsieve` (2 → 3 or 4) and `urllib3` (2.8) through `uv.lock`, with a constraint only where a
      parent caps one.
      Done without a constraint: cryptography 50.0.2, filelock 4.2.10, soupsieve
      4.1.1 (4.0.0 is the first to fix GHSA-mmhr-3c5m-f64f, so 3.x was not
      enough) and urllib3 2.8.0. filelock and soupsieve are the newest releases
      at least a week old.
- [x] Check each major in its changelog and with tests: - cryptography 50: JWT verification (PyJWT's crypto backend) and PDF text
      extraction (pdfminer.six); - filelock 4: model downloads and the Hugging Face cache, including two
      downloads at once; - soupsieve: HTML to Markdown conversion (markdownify, markitdown) and the
      web fetch tool's extraction.
- [ ] Record in the pull request, for each, whether Asterism's use reaches the
      advisory. Every one is fixed either way.
- [ ] The upgrade check (US-91.6) passes. Dependabot shows no open high alert for
      `uv.lock`.

### US-95.4: OS packages

As an administrator, the image's Debian packages have no fixable high.

- [ ] Take the base image update that carries `zlib1g` 1.3.1-1+deb13u1 (and any
      other fixed OS package by then), as a pinned digest.
- [ ] If the base lags a fix by more than a week, the runtime stage upgrades
      that named package with a comment and the date, and a check fails once the
      base has caught up so the line comes out.
- [ ] The image checks and the theme storage and fetch browser checks pass.

### US-95.5: Fail on fixable highs

As an administrator, a release never ships a known high vulnerability that has a
fix.

- [ ] `pnpm check:vulns` fails on a fixable high as well as a fixable critical,
      in CI, the release workflow and the weekly scan, and still prints the
      table. Tests cover the new threshold and `.trivyignore.yaml` entries for
      highs.
- [ ] The weekly scan's issue lists new fixable highs as well as criticals.
- [ ] Update the vulnerability scan section of `docs/development.md`, and close
      EPIC-92's open question 1.
- [ ] Release notes: Image (the fixed packages, and that a fixable high now stops
      a release). Cut the release that ships the epic.

## Open questions

1. Should Grype join Trivy in CI? On the 0.2.2 SBOM it lists 118 fixable
   findings of every severity. This epic keeps Trivy alone as the gate.
