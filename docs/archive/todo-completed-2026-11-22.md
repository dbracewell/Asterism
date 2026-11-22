# Completed checklist: 2026-11-22

## Supply-chain hardening

[EPIC-92](../epics/EPIC-92-SUPPLY-CHAIN-HARDENING.md) is complete: US-92.0 to US-92.5 were each confirmed and merged through pull requests, the last on 2026-11-22 (#55). 0.2.1 (2026-11-21) fixed the critical vulnerabilities found when Dependabot alerts were turned on. 0.2.2 (2026-11-22) is the first release published with provenance and SBOM attestations and a cosign signature, all verified by the release workflow and again from outside it. Fixable highs are reported but not yet failing; [EPIC-95](../epics/EPIC-95-FIXABLE-HIGH-VULNERABILITIES.md) takes them on after EPIC-94.

- [x] US-92.0: Fix the critical vulnerabilities and release 0.2.1 (released and published 2026-11-21)
  - [x] Upgrade next (≥16.4.1), Pillow (≥13.0.0), better-auth (≥1.7.7), PyJWT (≥2.14.0), proxy-addr (≥2.0.8) and certifi (≥2026.10.18) through the lockfiles, within pnpm's `minimumReleaseAge` or with a dated exclusion.
  - [x] Check the jumps for breaking changes: Pillow 12 → 13 (decoding, captioning, image generation output), better-auth 1.6 → 1.7 (its table migrations, the JWT plugin, admin actions), Next 16.2 → 16.4 (its docs in `node_modules/next/dist/docs/`).
  - [x] Record, for each critical, whether Asterism's use reaches it, in the pull request. Every one is fixed either way.
  - [x] All checks pass, including the image checks and the upgrade check from 0.2.0. Dependabot shows no open critical alerts.
  - [x] Release notes: an Image entry naming the fixes and telling administrators to upgrade. Cut and publish 0.2.1.
- [x] US-92.1: Pin what the build pulls (merged 2026-11-21, PR #23)
  - [x] Pin each `FROM` that pulls an external image in `Dockerfile` to `image:tag@sha256:…`. A `FROM` naming a stage declared earlier in the file (`FROM frontend-base AS …`) is left as it is. The GPU build uses the same stages, so it is pinned too. The `uv` the build installs with pip is already pinned.
  - [x] Pin every `uses:` in `.github/workflows/` to a full commit SHA with `# vX.Y.Z` after it.
  - [x] A check (`pnpm check:pins`, run in the quality job) fails on an external image in a `FROM` without a digest, or a `uses:` without a commit SHA, naming the file and line. It allows `FROM` lines naming a stage declared earlier in the same Dockerfile, and local actions (`uses: ./…`). Tests cover both.
  - [x] Add `.github/dependabot.yml` for `github-actions`, `docker`, `npm` (pnpm) and `uv`: weekly, grouped by ecosystem, minor and patch together, majors on their own. Document how to review one in `docs/development.md`.
- [x] US-92.2: Scan for known vulnerabilities (merged 2026-11-22, PR #50)
  - [x] The image-checks job runs Trivy on the built image and on the lockfiles. It fails on fixable criticals and prints a table of highs.
  - [x] `.trivyignore.yaml` holds accepted findings, each with a reason and an expiry date. A check fails on an expired entry, or one without both.
  - [x] A weekly scheduled workflow scans `ghcr.io/dbracewell/asterism:latest`, and opens or updates one issue when it finds a new fixable critical.
  - [x] The release workflow scans each architecture's pulled-back image before tagging (with the US-91.2 checks).
- [x] US-92.3: Provenance and an SBOM for every release (merged 2026-11-22, PR #52; verified in the 0.2.2 release)
  - [x] Build each architecture with an SPDX SBOM and `provenance: mode=max`. Keep the push-by-digest, pull-back and check flow working with the attestation manifests in the index, and keep `pnpm check:image`'s size reading correct. (Rehearsal 44973491208: both architectures pass; SBOMs 5.9 MB, 1108 packages.)
  - [x] Attest the published index with `actions/attest-build-provenance` and `actions/attest-sbom`. Grant `id-token: write` and `attestations: write` to the publish job only. (Both are now deprecated wrappers of `actions/attest` v4, which the workflow uses directly.)
  - [x] After publishing, the workflow runs `gh attestation verify` against the repository and fails the run if it doesn't verify. (Release run 45021061473: provenance and both SBOMs verified for the 0.2.2 index.)
- [x] US-92.4: Sign the published image (merged 2026-11-22, PR #53; verified in the 0.2.2 release)
  - [x] Sign the index digest with cosign, keyless, in the publish job. The cosign installer is pinned like every action.
  - [x] After signing, the workflow runs `cosign verify` with the expected identity (`https://github.com/dbracewell/Asterism/.github/workflows/release.yml@refs/tags/v*`) and OIDC issuer.
  - [x] A rehearsal run (Run workflow) signs nothing, as it tags nothing (US-91.5). (Rehearsal 45013906928: publish skipped.)
- [x] US-92.5: Verifying a release, and the security policy (merged 2026-11-22, PR #55)
  - [x] A "Verify the image" section in `docs/deployment.md` gives the `gh attestation verify` and `cosign verify` commands, and says how to read the SBOM.
  - [x] `SECURITY.md`: which versions get fixes (the latest minor in 0.x), how to report privately (GitHub private vulnerability reporting), and what happens next.
  - [x] `docs/development.md` lists the repository settings this epic relies on, for the owner to turn on: a ruleset on `main` requiring the three CI checks and an up-to-date branch; a ruleset that lets only maintainers create or move `v*` tags; private vulnerability reporting; Dependabot alerts.
  - [x] Release notes: an Image entry for signed and attested images.
