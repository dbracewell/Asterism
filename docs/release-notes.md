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
