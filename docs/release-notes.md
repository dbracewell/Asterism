# Release notes

Changes an administrator should know about before upgrading: configuration,
the image and anything that needs action. Read the section for every release
since the one you run. Upgrade steps are in
[Deploying and running Asterism](deployment.md#6-storage-backups-and-upgrades).

## Unreleased

### Image

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

### Data

- Compaction summaries written by **Compact now** named the model by its id.
  Upgrading renames them to the model's name (migration `c3a1f0d2b9e4`).

### Behavior

- A signed-in person who isn't an administrator now gets **403** from admin
  routes, and stays signed in. Missing or invalid tokens still get 401.
