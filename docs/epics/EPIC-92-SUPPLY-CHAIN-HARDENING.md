# EPIC-92: Supply-chain hardening

Status: complete (2026-11-22; US-92.0 through US-92.5 merged, checklist archived
in the [2026-11-22 checklist](../archive/todo-completed-2026-11-22.md)). Proposed
2026-11-20. Source: user request (2026-11-20), following EPIC-91.

## Objective

An administrator can check that an Asterism image is the one this repository
built, see what is inside it, and trust that known vulnerabilities and moving
dependencies are caught before a release rather than after.

Out of scope: a GPU image (EPIC-91 builds it from source only), reproducible
builds, and hosting a private registry or mirror.

## Where things stand (verified 2026-11-20)

| Area             | What happens today                                                                                                                                                                                                                                                                                                                                                                        |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Base images      | The Dockerfile pulls `node:22-bookworm-slim`, `python:3.13-slim-bookworm` and `python:3.13-slim-trixie` by tag. A rebuild of the same commit can get different bases.                                                                                                                                                                                                                     |
| Actions          | Workflows use actions by major tag (`actions/checkout@v4`, `docker/build-push-action@v6`, `pnpm/action-setup@v4`, `astral-sh/setup-uv@v6`, …). A moved tag changes what runs with `packages: write` in the release workflow.                                                                                                                                                              |
| Dependencies     | `pnpm-lock.yaml` and `uv.lock` pin every package, and pnpm holds new releases back with `minimumReleaseAge` and allows install scripts only for four packages. No tool proposes updates; nothing scans for known vulnerabilities. Dependabot alerts, turned on 2026-11-20, list 296 open alerts, 22 of them critical (US-92.0). Model bundles are already pinned by revision and SHA-256. |
| Release image    | `release.yml` builds with `provenance: false` and no SBOM, and publishes the index with `imagetools create`. Nothing signs or attests it, so nothing ties `ghcr.io/dbracewell/asterism:0.2.0` to this repository's workflow.                                                                                                                                                              |
| Repository rules | Pull requests can be merged before their checks finish (PR #15 merged while GitHub was still computing mergeability). Nothing protects `v*` tags. There is no `SECURITY.md`.                                                                                                                                                                                                              |

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

Suggested order: US-92.0 → 92.1 → 92.2 → 92.3 → 92.4 → 92.5. US-92.0 comes
first because it fixes vulnerabilities in the published image.

### US-92.0: Fix the critical vulnerabilities and release 0.2.1

As an administrator running 0.2.0, I can upgrade to a release without the known
critical vulnerabilities.

Found 2026-11-20 when Dependabot alerts were turned on: 296 open alerts, 22
critical in six packages, all in the published 0.2.0 image:

- next 16.2.7, fixed in 16.4.1: unauthenticated remote code execution, including
  in the image optimization API and `use cache`;
- Pillow 12.3.0, fixed in 13.0.0: heap overflows when decoding images;
- better-auth 1.6.11, fixed in 1.7.7: OAuth state usable as a magic link;
- PyJWT 2.13.0, fixed in 2.14.0: the key-confusion guard bypassed;
- proxy-addr 2.0.7, fixed in 2.0.8: client IP spoofing;
- certifi 2026.6.17, fixed in 2026.10.18: compromised CA roots.

Tasks:

- [ ] Upgrade the six packages to their fixed versions or later, through the
      lockfiles (`pnpm-lock.yaml`, `uv.lock`), within pnpm's `minimumReleaseAge`
      or with a dated exclusion.
- [ ] Check the jumps for breaking changes: - Pillow 12 → 13: image decoding, captioning and image generation output; - better-auth 1.6 → 1.7: its own table migrations, the JWT plugin and admin
      actions; - Next 16.2 → 16.4: read `node_modules/next/dist/docs/` for deprecations.
- [ ] Record, for each critical, whether Asterism's use reaches it, in the pull
      request. Every one is fixed either way.
- [ ] All checks pass, including the image checks and the upgrade check from
      0.2.0 (US-91.6). Dependabot shows no open critical alerts.
- [ ] Release notes: an Image entry naming the fixes and telling administrators
      to upgrade. Cut and publish 0.2.1 (`pnpm release 0.2.1`).

### US-92.1: Pin what the build pulls

As an administrator, a rebuild of a release uses the same bases and the same
workflow code.

- [ ] Pin each `FROM` that pulls an external image in `Dockerfile` to
      `image:tag@sha256:…`. A `FROM` naming a stage declared earlier in the file
      (`FROM frontend-base AS …`) is left as it is. The GPU build uses the same
      stages, so it is pinned too. The `uv` the build installs with pip is already
      pinned.
- [ ] Pin every `uses:` in `.github/workflows/` to a full commit SHA with
      `# vX.Y.Z` after it.
- [ ] A check (`pnpm check:pins`, run in the quality job) fails on an external
      image in a `FROM` without a digest, or a `uses:` without a commit SHA, naming
      the file and line. It allows `FROM` lines naming a stage declared earlier in
      the same Dockerfile, and local actions (`uses: ./…`). Tests cover both.
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
      the owner to turn on: - a ruleset on `main` requiring the three CI checks and an up-to-date branch; - a ruleset that lets only maintainers create or move `v*` tags; - private vulnerability reporting; - Dependabot alerts.
- [ ] Release notes: an Image entry for signed and attested images.

## Open questions

1. ~~Should a fixable **high** also fail CI once the backlog is clear, or stay a
   report?~~ Closed 2026-11-23: yes. [EPIC-95](EPIC-95-FIXABLE-HIGH-VULNERABILITIES.md)
   cleared the backlog, and since US-95.5 a fixable high fails CI, the release
   workflow and the weekly scan's issue, as a critical does.
2. Is a weekly Dependabot cadence right, or would monthly suit a small team
   better? pnpm's `minimumReleaseAge` already holds new npm releases back.
