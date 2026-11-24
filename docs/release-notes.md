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

### Behavior

- User Settings no longer shows settings for a feature the admin has turned off
  for that person: the Skills and ChatGPT sections, Use memory and Canvas.
  Someone who already has skills, a ChatGPT connection or memories saved still
  sees them, to review or delete. Admin Settings no longer lists the planned
  Code execution section. In chats, the composer's menu leaves out Skills and
  typing "/" offers only templates while skills are off.
- Turning a feature on or off in Admin Settings (for example memory or canvas)
  now shows in User Settings and chats without reloading the page. Other people's
  open tabs catch up within about 30 seconds, when the tab is next focused.
- A list that was still loading when you changed something (for example
  "Your classes" when joining a class from a link) now shows the change instead
  of the answer from before it.

## 0.4.0 (2026-11-23)

### Configuration

- A new admin setting, `memory` (Admin Settings → Memory), is off by default and
  can be limited to groups. Settings export carries its
  on/off switch; group limits stay with each installation, as for image
  generation.

### Data

- Classes have a `memory_enabled` switch, on for every existing class, for an
  educator to turn memory off in a course. Each person also gets a "Use memory"
  setting, on unless they turn it off.
- New `memory_proposals` and `memory_proposal_events` tables hold the memories
  the assistant offers in a chat until the person saves or dismisses them, and
  an audit record of each offer and decision (ids and times only). Proposals
  are deleted with their chat; the audit record is kept until the account is
  deleted. Upgrading adds both empty.
- A new `message_memories` table pins the memories each accepted turn used, so
  a resumed reply uses the same ones. Its rows are deleted with the memory, the
  message or the account. Turns accepted before upgrading use no memories.
- A new `memories` table holds what Asterism remembers about each person (user
  memory) and about their work in each project (project memory), with a memory
  vector table, `memory_vectors`, next to the knowledge vectors (ADR-0078).
  Upgrading adds both empty; nothing existing changes. Only the owner can read
  their memories. Deleting an account or a project deletes its memories.

### Behavior

- Memory (ADR-0078): when an administrator turns it on, Asterism keeps in mind
  what each person saves about themselves (Settings → Your Asterism → Memory)
  and about their work in a project (the project's Settings tab), and adds the
  most relevant ones to each message as information, never instructions. Only
  the person can see their memories. Each person can turn memory off for
  themselves, and an educator for a course. A reply's Context lists the
  memories it used. The assistant can offer to remember something the person
  said (the internal `propose_memory` tool); a card under the reply offers
  Save, Edit or Dismiss, and nothing is saved without the person's click.
- Memories leave with a person's data and survive backups and upgrades: Download
  my data adds `memories.json` (sensitive memories marked) and the memory
  offers, their audit records and each turn's memories under `records/`.
  Backups already include the memory vectors. Each start rebuilds, in the
  background, any memory vector that is missing or out of date, such as after
  a restore or a save while the embedding model was down, and removes vectors
  whose memory is gone.

## 0.3.1 (2026-11-23)

### Image

- Test tooling and pip are no longer in the image. `vitest`, `vite`, `jsdom`
  and `undici` reached the production install as better-auth's optional
  `vitest` peer, though nothing at run time used them; a pnpm hook now drops
  that peer. The base image's pip, and the `msgpack`, `setuptools` and
  `urllib3` it vendors, are removed from the runtime stage (the app runs from
  the backend's own environment). This fixes 14 high-severity findings, in
  `vite`, `undici`, `msgpack` and `setuptools`. The image is 3.59 GB on arm64
  (was 3.72 GB). `pnpm check:image` now fails if `vitest`, `vite` or `jsdom` is
  in the image's `node_modules`, or the system Python can import pip.
- The frontend's Node packages have no fixable high-severity finding. In the
  image, `fast-uri` is 3.1.9 (was 3.1.2), `browserslist` 4.29.6 (was 4.28.2)
  and `source-map-js` 1.2.4 (was 1.2.1). Development tooling outside the image
  is upgraded too (`brace-expansion`, `js-yaml`, `vite`, `vitest`, `undici`);
  `js-yaml` needs a pnpm override because `@hey-api/json-schema-ref-parser`
  pins an old version. The lockfile no longer pins a pnpm binary (11.5.0, left
  from the first commit); the image and CI install pnpm 11.17.0 from
  `packageManager`.
- The backend's Python packages have no fixable high-severity finding:
  `cryptography` 50.0.2 (was 49.0.0), `filelock` 4.2.10 (was 3.32.0),
  `soupsieve` 4.1.1 (was 2.9.1) and `urllib3` 2.8.0 (was 2.7.0). Nothing needs
  changing before upgrading. `filelock` 4 changes only the on-disk format of
  `SoftReadWriteLock`, which neither Asterism nor huggingface-hub uses, so
  model downloads and the Hugging Face cache keep working across the upgrade.
- `zlib1g` is 1.3.1-1+deb13u1, which fixes CVE-2026-85091 (high). The pinned
  `python:3.13-slim-trixie` base still has 1.3.1-1+b1 three weeks after Debian's
  fix, so the runtime stage upgrades it (`BASE_LAG_UPGRADES` in the Dockerfile).
  `pnpm check:image` fails once the base carries the fix, so the upgrade comes
  out with the base update.
- A high-severity vulnerability with a fix now fails CI and stops a release,
  as a critical with a fix already did. The weekly scan of the published image
  opens its issue for one too. With this release the image and both lockfiles
  have none. To accept a finding instead, add it to `.trivyignore.yaml` with a
  statement and an expiry date, as for criticals.

## 0.3.0 (2026-11-22)

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
  about 1 GB smaller: about 3.8 GB unpacked, down from about 4.8 GB in 0.2.2. Embeddings, captioning and the new **ONNX** image generator run on
  ONNX Runtime and need no GPU. The **Diffusers** generator is in the
  [GPU build](deployment.md#gpu-build) only, built with
  `--build-arg TORCH_VARIANT=gpu` as before, which now also installs it. ComfyUI
  is unchanged.
- The image size budget checked in CI and the release workflow is lowered from
  5.25 GB to 4.25 GB, so the size gained stays gained.
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
