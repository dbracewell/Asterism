# EPIC-92: Supply-chain hardening

Status: proposed (2026-11-20). Source: user request (2026-11-20), following
EPIC-91.

## Objective

An administrator can check that an Asterism image is the one this repository
built, see what is inside it, and trust that known vulnerabilities and moving
dependencies are caught before a release rather than after.

Out of scope: a GPU image (EPIC-91 builds it from source only), reproducible
builds, and hosting a private registry or mirror.

## Where things stand (verified 2026-11-20)

| Area             | What happens today                                                                                                                                                                                                                                                                                     |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Base images      | The Dockerfile pulls `node:22-bookworm-slim`, `python:3.13-slim-bookworm` and `python:3.13-slim-trixie` by tag. A rebuild of the same commit can get different bases.                                                                                                                                  |
| Actions          | Workflows use actions by major tag (`actions/checkout@v4`, `docker/build-push-action@v6`, `pnpm/action-setup@v4`, `astral-sh/setup-uv@v6`, …). A moved tag changes what runs with `packages: write` in the release workflow.                                                                              |
| Dependencies     | `pnpm-lock.yaml` and `uv.lock` pin every package, and pnpm holds new releases back with `minimumReleaseAge` and allows install scripts only for four packages. No tool proposes updates; nothing scans for known vulnerabilities. Model bundles are already pinned by revision and SHA-256.                |
| Release image    | `release.yml` builds with `provenance: false` and no SBOM, and publishes the index with `imagetools create`. Nothing signs or attests it, so nothing ties `ghcr.io/dbracewell/asterism:0.2.0` to this repository's workflow.                                                                           |
| Repository rules | Pull requests can be merged before their checks finish (PR #15 merged while GitHub was still computing mergeability). Nothing protects `v*` tags. There is no `SECURITY.md`.                                                                                                                             |

## Decisions

- **One story at a time,** each confirmed and merged on its own.
- **Pin by digest, update by bot.** Base images and actions are pinned to
  immutable digests and commit SHAs, with the tag in a comment. Dependabot keeps
  them, the npm and uv lockfiles, and the actions current through grouped weekly
  pull requests. Each pull request passes the same CI, the upgrade check (US-91.6)
  included.
- **Trivy scans,** pinned to a version, because it reads the image, `pnpm-lock.yaml`
  and `uv.lock` in one tool. A **fixable critical** fails CI. Highs are reported.
  Exceptions live in `.trivyignore.yaml`, and each one needs a reason and an
  expiry date.
- **GitHub artifact attestations for provenance and the SBOM,** and a **cosign
  keyless signature** on the published index, both through the workflow's OIDC
  identity. No long-lived signing key exists to leak. `gh attestation verify` and
  `cosign verify` both check an image against this repository's release workflow.
- **The release workflow checks its own signature and attestations** after
  publishing, so a release can't succeed with an image nobody can verify.

## User stories

Suggested order: US-92.1 → 92.2 → 92.3 → 92.4 → 92.5.

### US-92.1: Pin what the build pulls

As an administrator, a rebuild of a release uses the same bases and the same
workflow code.

- [ ] Pin each `FROM` in `Dockerfile` to `image:tag@sha256:…` (the GPU build
      uses the same stages, so it is pinned too), and the `uv` the build installs
      with pip is already pinned.
- [ ] Pin every `uses:` in `.github/workflows/` to a full commit SHA with
      `# vX.Y.Z` after it.
- [ ] A check (`pnpm check:pins`, run in the quality job) fails on an unpinned
      `FROM` or `uses:`, naming the file and line.
- [ ] Add `.github/dependabot.yml` for `github-actions`, `docker`, `npm` (pnpm) and
      `uv`: weekly, grouped by ecosystem, minor and patch together, majors on their
      own. Document how to review one in `docs/development.md`.

### US-92.2: Scan for known vulnerabilities

As an administrator, a release never ships a known critical vulnerability that has
a fix.

- [ ] The image-checks job runs Trivy on the built image and on the lockfiles.
      It fails on fixable criticals and prints a table of highs.
- [ ] `.trivyignore.yaml` holds accepted findings, each with a reason and an
      expiry date. A check fails on an expired entry, or one without both.
- [ ] A weekly scheduled workflow scans `ghcr.io/dbracewell/asterism:latest`, and
      opens or updates one issue when it finds a new fixable critical.
- [ ] The release workflow scans each architecture's pulled-back image before
      tagging (with the US-91.2 checks).

### US-92.3: Provenance and an SBOM for every release

As an administrator, I can see how an image was built and what it contains.

- [ ] Build each architecture with an SPDX SBOM and `provenance: mode=max`. Keep
      the push-by-digest, pull-back and check flow working with the attestation
      manifests in the index, and keep `pnpm check:image`'s size reading correct.
- [ ] Attest the published index with `actions/attest-build-provenance` and
      `actions/attest-sbom`. Grant `id-token: write` and `attestations: write` to
      the publish job only.
- [ ] After publishing, the workflow runs `gh attestation verify` against the
      repository and fails the run if it doesn't verify.

### US-92.4: Sign the published image

As an administrator, my deployment tooling can refuse an image this repository
didn't sign.

- [ ] Sign the index digest with cosign, keyless, in the publish job. The cosign
      installer is pinned like every action.
- [ ] After signing, the workflow runs `cosign verify` with the expected identity
      (`https://github.com/dbracewell/Asterism/.github/workflows/release.yml@refs/tags/v*`)
      and OIDC issuer.
- [ ] A rehearsal run (Run workflow) signs nothing, as it tags nothing (US-91.5).

### US-92.5: Verifying a release, and the security policy

As an administrator, I know how to check an image before running it, and where to
report a vulnerability.

- [ ] A "Verify the image" section in `docs/deployment.md` gives the
      `gh attestation verify` and `cosign verify` commands, and says how to read the SBOM.
- [ ] `SECURITY.md`: which versions get fixes (the latest minor in 0.x), how to
      report privately (GitHub private vulnerability reporting), and what happens next.
- [ ] `docs/development.md` lists the repository settings this epic relies on, for
      the owner to turn on:
      - a ruleset on `main` requiring the three CI checks and an up-to-date branch;
      - a ruleset that lets only maintainers create or move `v*` tags;
      - private vulnerability reporting;
      - Dependabot alerts.
- [ ] Release notes: an Image entry for signed and attested images.

## Open questions

1. Should a fixable **high** also fail CI once the backlog is clear, or stay a
   report? This epic starts with criticals only.
2. Is a weekly Dependabot cadence right, or would monthly suit a small team
   better? pnpm's `minimumReleaseAge` already holds new npm releases back.
