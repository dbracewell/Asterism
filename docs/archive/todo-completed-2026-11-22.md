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

## Torch-free default image

[EPIC-94](../epics/EPIC-94-TORCH-FREE-DEFAULT-IMAGE.md) is complete: US-94.1, US-94.2, US-94.4 and US-94.3 were each confirmed and merged through pull requests on 2026-11-22 (#59, #60, #61, #62), and shipped in 0.3.0. Captioning runs on ONNX Runtime, local image generation runs on ONNX in every build, Diffusers is an optional install for the GPU build, and the image budget is lowered to 4.25 GB.

- [x] US-94.1: Captioning on ONNX
  - [x] ADR: ONNX captioning, the files and precision chosen, and how they are pinned and verified.
  - [x] A pinned ONNX bundle for SmolVLM2 (revision, file list, SHA-256 each), through `ModelDownloadService` like the CLIP bundle. An installed safetensors bundle is no longer used and is removed on the next download; stored captions are untouched.
  - [x] An ONNX caption provider: image processing and prompt from `transformers` (no torch), vision encoder and embeddings, greedy decoding with the key/value cache, the current length and time bounds. It replaces `LocalSmolVlm2CaptionProvider`.
  - [x] A comparison on a fixed set of test images: the torch provider's captions next to each ONNX precision's, with time and memory per image. The chosen precision and the results go in the ADR.
  - [x] Tests: decoding stops at the end token and at the length bound; a corrupt or partial bundle is refused and re-downloaded; captioning stays off until the bundle verifies. The upgrade check seeds a volume with local captioning on and checks it still captions after the upgrade.
  - [x] Release notes: Behavior (captioning model files change; one new download) and Data (the old bundle is removed).
- [x] US-94.2: Local image generation as an optional install
  - [x] Move `diffusers`, `accelerate`, `torch` and `torchvision` (and the PyTorch CPU index source) to a `local-image` extra, and require onnxruntime 1.32 or later so sympy is no longer needed. Keep `uv.lock` resolving both with and without it.
  - [x] A check (in the quality job) that the default install's dependency graph has no torch, torchvision or diffusers, direct or transitive, naming the package that pulls one in.
  - [x] Dockerfile: the CPU build installs no extra; `TORCH_VARIANT=gpu` installs `local-image` with CUDA torch. `pnpm check:image` fails if torch is importable in the CPU image.
  - [x] The generator registry offers Diffusers only when the extra imports. A saved local generator otherwise reads "not available in this image" in Admin Settings, its catalog and downloads are hidden, and `generate_image` isn't offered for it. The ComfyUI generator is unchanged.
  - [x] Tests for both installs: registry, Admin Settings payload, tool availability, and a saved local generator surviving an upgrade (upgrade check) and reading as unavailable.
  - [x] Docs: the deployment guide's GPU build section, the development guide (`uv sync --extra local-image`), and the image generation user guide.
- [x] US-94.4: Local image generation on ONNX
  - [x] ADR-0077: an ONNX generator in every build, its pipelines, schedulers in NumPy, how models are pinned and verified, and the catalog chosen.
  - [x] A pinned ONNX catalog (revision, file list, SHA-256 each) through `ModelDownloadService` with the license step: LCM DreamShaper v7 (license confirmed first) and SDXL Turbo (non-commercial, accepted before download); SDXL base 1.0 if usable. SD 3.5 Medium later.
  - [x] An ONNX pipeline with no torch: CLIP tokenizers from `transformers`, text encoders, UNet with the scheduler in NumPy (LCM; Euler for SDXL), VAE decoder; seeded, bounded, in the worker process with progress and cancellation.
  - [x] A comparison on a fixed prompt set: time and memory per image for each model and precision (fp32, and int8 if quality holds), with samples; results in the ADR.
  - [x] An "ONNX" generator component in every build, with its local models on the Admin Settings page; a saved Diffusers choice without the extra reads "not available in this image" and points to it. Nothing switches by itself.
  - [x] Tests: scheduler steps, the pipeline on fake sessions (seed determinism, bounds, cancellation), registry and availability, license step, a corrupt or partial model refused.
  - [x] Docs and release notes: Image (local generation on CPU in the published image), Behavior (the ONNX generator; Diffusers is GPU-build only).
- [x] US-94.3: Hold the smaller image
  - [x] Lower the image budget (`DEFAULT_MAX_SIZE_GB` in `scripts/check-image.mjs`, which CI and the release workflow use) from 5.25 GB (raised from 5 GB on 2026-11-21 for Dependabot's uv group) to the measured size plus a margin (expected about 4.5 GB), recorded in the release notes.
  - [x] Remove the temporary torch cap, so Dependabot updates torch for the GPU build again.
  - [x] Release notes: Image (smaller image, no local generation in the published image, how to build the GPU image). Cut the release that ships the epic.
