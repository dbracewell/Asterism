# EPIC-114: CI and image supply chain

Status: proposed (2026-11-26). Source: repository review (2026-11-26),
verified against the code at `40101ac7`.

## Objective

CI installs dependencies with the same build-script allowlist as the image,
workflow tokens stay out of later steps, and the image's vulnerability scans
and SBOM cover every runtime component.

## Stories

### US-114.1: Dependency build scripts follow the allowlist

As a maintainer, I want only approved packages to run install scripts in CI.

- [x] CI and `ci:local:*` drop `approve-builds --all` and the flags that turn
      the allowlist off; `strictDepBuilds` is on.
- [x] `minimumReleaseAge` is set to the week Dependabot already assumes.
- [ ] CI passes (better-sqlite3 and Playwright still build); release note.

### US-114.2: Workflow tokens and timeouts

As a maintainer, I want workflow credentials scoped to the steps that need them.

- [ ] Every checkout sets `persist-credentials: false` unless a later step
      pushes.
- [ ] Every release job has a timeout; fork pull requests get their own
      concurrency group.
- [ ] The Node version comes from one place; `vuln-issue.mjs` survives a bad
      marker.

### US-114.3: Scans see every runtime component

As a maintainer, I want CVEs in the image's extracted libraries and binaries
found.

- [ ] `check:image` records and checks the extracted `libgbm1`, Node and
      Chromium versions.
- [ ] `uv` comes from a digest-pinned image.
- [ ] `install-trivy.mjs` uses a private temporary directory; `check-pins.mjs`
      compares paths reliably.
- [ ] Tests for the scripts; release note (Image).
