# EPIC-94: A torch-free default image

Status: complete (2026-11-22, shipped in 0.3.0; proposed 2026-11-21). Source: user request (2026-11-21), after the
first Dependabot uv group (#33) took the image to 5.21 GB, over its 5 GB budget.
Decided 2026-11-21: image captioning moves to ONNX, local image generation
becomes an optional install for the GPU build, and this is its own epic rather
than part of EPIC-92.

## Objective

The published (CPU) image carries no PyTorch. Captioning runs on ONNX Runtime
like search embeddings already do, and local image generation, which needs a
GPU to be useful, is installed only in the GPU build. The image gets about
0.8 GB smaller, and new torch releases stop growing it.

Out of scope: publishing a GPU image; changes to the ComfyUI generator.
Stable Diffusion on ONNX was out of scope until 2026-11-22, when it became
US-94.4: a pipeline of our own, with fast few-step models, so the published
image keeps local image generation on the CPU.

## Where things stand (verified 2026-11-21)

| Area             | What happens today                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Image size       | The 0.2.1-era image's Python packages are 1.8 GB: torch 635 MB, transformers 120 MB, sympy 74 MB, diffusers 59 MB, onnxruntime 37 MB, networkx 18 MB, torchvision 8 MB, accelerate 4 MB. torch is required by `accelerate` (a base dependency that nothing imports directly; diffusers uses it for offload) as well as directly; sympy by torch and by onnxruntime before 1.32, which makes it optional. The image was 4.90 GB against a 5.00 GB budget; Dependabot's uv group (torch 2.13 → 2.15, onnxruntime 1.20 → 1.32 and others) made it 5.21 GB. |
| Torch users      | Exactly two: the local Diffusers image generator (`domains/image_generation/local/`, ADR-0064, US-76.2) and local captioning (`LocalSmolVlm2CaptionProvider` in `domains/knowledge/captioning.py`), which loads `HuggingFaceTB/SmolVLM2-256M-Video-Instruct` at revision `067788b1…` with `transformers` on torch.                                                                                                                                                                                                                                      |
| Search embedding | Already torch-free: `OnnxClipEmbeddingProvider` runs a pinned ONNX CLIP on ONNX Runtime, with only the tokenizer and PIL image processor from `transformers`.                                                                                                                                                                                                                                                                                                                                                                                           |
| ONNX captioning  | The same SmolVLM2 repository publishes ONNX exports at the revision we pin (Apache-2.0): `vision_encoder`, `embed_tokens` and `decoder_model_merged`, each as fp32, fp16, int8/uint8/quantized, q4, q4f16 and bnb4. The int8 set is about 260 MB.                                                                                                                                                                                                                                                                                                       |
| Image generation | Two generators: ComfyUI (an external server, US-76.3) and local Diffusers. Captioning has three modes: disabled, provider (a vision model through a configured provider) and local.                                                                                                                                                                                                                                                                                                                                                                     |
| Builds           | The lockfile installs CPU-only torch on Linux. `TORCH_VARIANT=gpu` reinstalls the same torch versions with CUDA (about 4 GB more); no GPU image is published. Until this epic lands, torch is held at its current minor version so Dependabot's uv group fits the size budget.                                                                                                                                                                                                                                                                          |

## Decisions

- **One story at a time,** each confirmed and merged on its own.
- **Captioning runs on ONNX Runtime in every build.** The pinned SmolVLM2 ONNX
  exports are downloaded and verified like the CLIP bundle (revision plus
  SHA-256 per file). Asterism runs the vision encoder and token embedding, then
  a greedy decode over `decoder_model_merged` with its key/value cache, in
  NumPy. The tokenizer, chat template and image processor still come from
  `transformers`, which needs no torch for them. Captions are bounded as today.
- **Which precision is chosen by measurement,** not assumed: int8 first, fp16 or
  fp32 if int8 captions are noticeably worse on the comparison set (US-94.1).
- **Local image generation is an optional install.** Diffusers, accelerate,
  torch and torchvision move to a `local-image` extra in `pyproject.toml`, and
  the default install has no direct or transitive torch dependency (sympy goes
  too, with onnxruntime 1.32 or later). The GPU build
  installs it (with CUDA torch, as today); the published CPU image doesn't. A
  checkout installs it with `uv sync --extra local-image`.
- **Nothing switches silently.** Where the extra isn't installed, a saved local
  generator stays stored and readable, shows as "not available in this image"
  in Admin Settings, and `generate_image` isn't offered for it, as with a
  disabled model (ADR-0064). Its catalog and downloads are hidden.
- **One ADR** amends ADR-0064 (where local generation runs) and records the ONNX
  captioning decision.

## User stories

Suggested order: US-94.1 → 94.2 → 94.4 → 94.3. US-94.4 comes before US-94.3,
which cuts the release, so no release ships without local image generation.

### US-94.1: Captioning on ONNX

As an administrator, local captioning works without PyTorch and downloads less.

- [x] ADR: ONNX captioning, the files and precision chosen, and how they are
      pinned and verified.
- [x] A pinned ONNX bundle for SmolVLM2 (revision, file list, SHA-256 each),
      through `ModelDownloadService` like the CLIP bundle. An installed safetensors
      bundle is no longer used and is removed on the next download; stored
      captions are untouched.
- [x] An ONNX caption provider: image processing and prompt from `transformers`
      (no torch), vision encoder and embeddings, greedy decoding with the key/value
      cache, the current length and time bounds. It replaces
      `LocalSmolVlm2CaptionProvider`.
- [x] A comparison on a fixed set of test images (photos, diagrams, screenshots,
      text): the torch provider's captions next to each ONNX precision's, with time
      and memory per image. The chosen precision and the results go in the ADR.
- [x] Tests: decoding stops at the end token and at the length bound; a corrupt or
      partial bundle is refused and re-downloaded; captioning stays off until the
      bundle verifies. The upgrade check (US-91.6) seeds a volume with local
      captioning on and checks it still captions after the upgrade.
- [x] Release notes: Behavior (captioning model files change; one new download)
      and Data (the old bundle is removed).

### US-94.2: Local image generation as an optional install

As an administrator, the published image leaves out what only a GPU build can
use well, and a saved local generator never fails silently.

- [x] Move `diffusers`, `accelerate`, `torch` and `torchvision` (and the PyTorch
      CPU index source) to a `local-image` extra, and require onnxruntime 1.32 or
      later so sympy is no longer needed. Keep `uv.lock` resolving both with and
      without it.
- [x] A check (in the quality job) that the default install's dependency graph
      has no torch, torchvision or diffusers, direct or transitive, naming the
      package that pulls one in.
- [x] Dockerfile: the CPU build installs no extra; `TORCH_VARIANT=gpu` installs
      `local-image` with CUDA torch. `pnpm check:image` fails if torch is
      importable in the CPU image.
- [x] The generator registry offers Diffusers only when the extra imports. A
      saved local generator otherwise reads "not available in this image" in Admin
      Settings, its catalog and downloads are hidden, and `generate_image` isn't
      offered for it. The ComfyUI generator is unchanged.
- [x] Tests for both installs: registry, Admin Settings payload, tool
      availability, and a saved local generator surviving an upgrade (upgrade
      check) and reading as unavailable.
- [x] Docs: the deployment guide's GPU build section (local generation is
      GPU-build only; ComfyUI or a hosted provider otherwise), the development
      guide (`uv sync --extra local-image`), and the image generation user guide.

### US-94.4: Local image generation on ONNX

As an administrator on the published image, I can generate images on the
server's CPU without a GPU build or PyTorch. (Added 2026-11-22: on a Mac,
Docker can't use Metal, so the CPU is all an in-image generator gets there.)

- [x] ADR-0077: an ONNX generator in every build, its pipelines, schedulers in
      NumPy, how models are pinned and verified, and the catalog chosen.
- [x] A pinned ONNX catalog (revision, file list, SHA-256 each), downloaded
      through `ModelDownloadService` with the existing license step: LCM
      DreamShaper v7 (`SimianLuo/LCM_Dreamshaper_v7`, license confirmed first)
      and SDXL Turbo (`stabilityai/sdxl-turbo`, non-commercial, accepted before
      download); SDXL base 1.0 if its time and memory are usable. SD 3.5 Medium
      is left for later (an unofficial export, 32.5 GB, a different pipeline).
- [x] An ONNX pipeline with no torch: the CLIP tokenizers from `transformers`,
      the text encoders, the UNet with the model's scheduler in NumPy (LCM, and
      Euler for SDXL), and the VAE decoder. Seeded, bounded steps, size and time,
      run in the existing worker process with progress and cancellation.
- [x] A comparison on a fixed prompt set: time and memory per image for each
      model and precision (fp32, and an int8 copy if quality holds), with sample
      images. The chosen precisions and the results go in the ADR.
- [x] An "ONNX" generator component, registered in every build, with its local
      models on the Admin Settings page (hardware, fit, downloads, licenses).
      Diffusers stays the optional GPU-build generator; where it isn't installed,
      a saved Diffusers choice keeps reading "not available in this image" and
      the message points to the ONNX generator. Nothing switches by itself.
- [x] Tests: scheduler steps, the pipeline on tiny fake sessions (seed
      determinism, bounds, cancellation), registry and availability, the license
      step, a corrupt or partial model refused.
- [x] Docs and release notes: Image (local generation on CPU in the published
      image), Behavior (the ONNX generator; Diffusers is GPU-build only).

### US-94.3: Hold the smaller image

As a maintainer, the size gained stays gained.

- [x] Lower the image budget (`DEFAULT_MAX_SIZE_GB` in
      `scripts/check-image.mjs`, which CI and the release workflow use) from 5.25 GB
      (raised from 5 GB on 2026-11-21 so Dependabot's uv group, #46, fits) to the
      measured size plus a margin (expected about 4.5 GB), recorded in the release notes.
      Done 2026-11-22: 4.25 GB, for 3.82 GB measured on amd64 and 3.72 GB on arm64.
- [x] Remove the temporary torch cap, so Dependabot updates torch for the GPU
      build again.
- [x] Release notes: Image (smaller image, no local generation in the published
      image, how to build the GPU image). Cut the release that ships the epic.

## Open questions

1. **Precision.** Answered by US-94.1 (2026-11-22): int8. Its captions were as
   accurate as the torch model's on the comparison set, and it is the fastest
   variant; the fp16 exports do not run on CPU ONNX Runtime 1.32
   ([ADR-0077](../adr/0077-torch-free-default-image.md#comparison)).
2. **Checkouts on a Mac.** US-94.2 keeps them lean like the image: `sync`
   installs no extra, and `sync:local-image` (`uv sync --extra local-image`) adds
   local generation. Revisit if Mac development of local generation is common.
3. **A published GPU image.** Out of scope here; worth revisiting once the CPU
   image no longer carries torch.
