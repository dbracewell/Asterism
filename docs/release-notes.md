# Release notes

Changes an administrator should know about before upgrading: configuration,
the image and anything that needs action. Read the section for every release
since the one you run. Upgrade steps are in
[Deploying and running Asterism](deployment.md#6-storage-backups-and-upgrades).

Each release lists its changes under these headings, in this order, and leaves
out the empty ones:

- **Configuration:** settings that are new, renamed or removed, or whose default
  changed, and what to set before upgrading.
- **Data:** migrations and changes to stored data or files. Upgrading migrates
  them; going back means restoring the backup taken before the upgrade.
- **Image:** what is in the container image and how to build or run it: its
  size, packages, build arguments and platforms.
- **Behavior:** documented behavior that now works differently, for people or
  for administrators.

Changes are added under **Unreleased** as they are made. A release turns
Unreleased into its version and date.

## Unreleased

### Configuration

- `LOCAL_CAPTION_MODEL_BUNDLE_SHA256` is removed. It was validated but never
  checked against the bundle; the code now pins the SHA-256 of every caption
  model file. A value still set is ignored, so you can unset it at any time.

### Data

- The local captioning model folder, `models/captioning-smolvlm2`, is replaced by
  the new model's files on its first download; the old PyTorch weights (about
  1 GB) are deleted then. Stored captions are not changed.

### Image

- The published image no longer includes PyTorch, diffusers or sympy, so it is
  smaller. Embeddings, captioning and the new **ONNX** image generator run on
  ONNX Runtime and need no GPU. The **Diffusers** generator is in the
  [GPU build](deployment.md#gpu-build) only, built with
  `--build-arg TORCH_VARIANT=gpu` as before, which now also installs it. ComfyUI
  is unchanged.
- [Verify the image](deployment.md#verify-the-image) gives the commands to check
  an image's signature, provenance and SBOM before running it, for every image
  from 0.2.2, and how to read the SBOM. Add the check to your upgrade: the
  upgrade steps now include it. [`SECURITY.md`](../SECURITY.md) says which
  versions get security fixes (the latest minor, 0.2) and how to report a
  vulnerability privately.

### Behavior

- A new image generator, **ONNX**, runs small Stable Diffusion models on the
  server's CPU in every build: LCM DreamShaper v7 (1.6 GB download, about 5 GB of
  memory, a few seconds per 512 px image on a fast CPU) and SDXL Turbo (6.2 GB,
  about 8 GB, Stability AI Community License, accepted before download). Choose it
  in Admin Settings → Image generation and download a model from **ONNX models**.
  The models are int8 conversions published under `huggingface.co/davidb727`
  ([ADR-0077](adr/0077-torch-free-default-image.md)).
- If you use the Diffusers generator with the published image, it stops
  generating after the upgrade: Admin Settings → Image generation keeps it saved
  but shows "Diffusers is not available in this image. Choose ONNX to generate
  images on this server's CPU", and people aren't offered image creation. Choose
  ONNX or a ComfyUI server, or build and run the GPU image. Nothing switches
  generator by itself. Downloaded Diffusers models stay in
  `models/image-generation` until you remove them (from the GPU build's Local
  models page, or by deleting their folders).
- Local image captioning runs SmolVLM2 on ONNX Runtime instead of PyTorch
  ([ADR-0077](adr/0077-torch-free-default-image.md)). Its model files change, so
  an instance with local captioning on downloads them once (about 265 MB) on its
  first start after the upgrade; images uploaded meanwhile are captioned once the
  download is verified. It needs about 2 GiB of memory headroom, down from 4 GiB,
  and is about a quarter faster. New captions are worded a little differently and
  are often shorter; regenerating a file captions it again with the new model.

## 0.2.2 (2026-11-22)

### Image

- The image size budget checked in CI and the release workflow is raised from
  5 GB to 5.25 GB, for this release's dependency updates (onnxruntime 1.32 alone
  adds about 45 MB). EPIC-94 takes PyTorch out of the image and lowers it again.
- The image is built from base images pinned by digest, with GitHub Actions
  pinned by commit, so rebuilding a release pulls the same bases. Dependabot
  proposes updates weekly.
- Every image is scanned with Trivy before it is released: a critical
  vulnerability with a fix stops the release. A weekly scan of the published
  image opens an issue when a new one is found.
- Published images carry an SPDX SBOM and build provenance for each
  architecture. They are attached to the image index (each architecture's entry
  has an attestation manifest beside it, listed as `unknown/unknown`) and
  published as GitHub artifact attestations for this repository's release
  workflow, which `gh attestation verify` checks.
- Published images are signed with cosign, keyless, by this repository's
  release workflow; `cosign verify` checks the signature against that workflow's
  identity.

## 0.2.1 (2026-11-21)

### Image

- **Upgrade from 0.2.0:** this release fixes critical vulnerabilities in the
  0.2.0 image, including unauthenticated remote code execution in Next.js and
  heap overflows when Pillow decodes uploaded images. Pull the new image and
  restart; both databases migrate on start.
  - Next.js 16.2.7 → 16.4.6
  - Pillow 12.3.0 → 13.0.0
  - better-auth 1.6.11 → 1.7.26 (its tables migrate on start)
  - PyJWT 2.13.0 → 2.15.1
  - certifi 2026.6.17 → 2026.10.23 (drops the compromised emSign roots)

### Behavior

- A database from a development build before 0.2.0 is still refused at start,
  and the message now says how to start fresh with Docker (remove the storage
  volume) as well as in a checkout.

## 0.2.0 (2026-11-20)

### Data

- Compaction summaries written by **Compact now** named the model by its id.
  Upgrading renames them to the model's name (migration `c3a1f0d2b9e4`).

### Image

- **Install by pulling:** each release is published as
  [`ghcr.io/dbracewell/asterism`](https://github.com/dbracewell/Asterism/pkgs/container/asterism)
  for amd64 and arm64, tagged with its version and `latest`.
  `docker-compose.yml` now runs that image: set `ASTERISM_VERSION` in `.env`
  to the release (Compose refuses to start without it), then
  `docker compose pull && docker compose up -d`. If you built from source
  before, keep doing so with `docker-compose.build.yml`; see
  [Building from source](deployment.md#building-from-source). The GPU build is
  not published: build it from source with `TORCH_VARIANT=gpu`.
- **One version:** Asterism is now version 0.2.0 everywhere. Admin Settings →
  Status and backup manifests used to say 0.1.0. Status and backups also name
  the commit the image was built from, when it is built with
  `ASTERISM_COMMIT=$(git rev-parse HEAD)`; see
  [Start](deployment.md#3-start). The image carries the standard OCI labels for
  its version, commit and source.
- **The image is smaller:** about 4.4 GB on disk instead of 10.8 GB, and under
  1 GB to download instead of 3.6 GB. PyTorch is now the CPU-only build, and
  only the frontend's runtime packages are installed. Embeddings, captioning
  and local image generation work as before.
- **GPU build:** to run local image generation on an NVIDIA GPU, build with
  `--build-arg TORCH_VARIANT=gpu` (about 8 GB on disk, estimated). See
  [GPU build](deployment.md#gpu-build). If you relied on the image's CUDA
  libraries before, rebuild with this argument.
- **Headless Chromium is included,** so the web fetch tool can read short and
  JavaScript-heavy pages in the container. Fetching them used to fail with an
  error. The browser has no network of its own; every request goes through the
  tool's checked connection.

### Behavior

- A signed-in person who isn't an administrator now gets **403** from admin
  routes, and stays signed in. Missing or invalid tokens still get 401.
