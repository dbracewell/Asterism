# EPIC-76: Image generation

Status: in progress (US-76.1 done, US-76.2; [ADR-0064](../adr/0064-image-generation.md)). Source: user request (2026-11-09).

## Objective

Let users create images in chat the way ChatGPT and Gemini do: either say so
explicitly ("Create image" in the composer) or just ask the agent ("Create an
image of a lighthouse at dusk"). Generated images are saved to the user's
files and shown in the chat, where they can be viewed full size and downloaded.

Two generation backends, chosen by an administrator:

1. **ComfyUI**: connect to an existing ComfyUI server and run a workflow.
2. **Local diffusers**: a generator that runs inside the Asterism backend
   using Hugging Face `diffusers`. Asterism detects the hardware (CUDA, Apple
   MPS or CPU, and available memory) and suggests a model that fits from a
   predefined catalog. The catalog favors open models with light built-in
   filtering, such as Qwen-Image-2.1.

This replaces the "Planned" Image Generation page in Admin Settings and uses
the existing `ImageGenerator` component type.

## Ownership and delivery

- **One interface, two providers.** An `ImageGenerator` provider takes a
  request (prompt, negative prompt, size, steps, seed, count, optional source
  image for later editing) and returns image bytes plus provenance (provider,
  model, revision, seed, settings). ComfyUI and local diffusers both implement
  it; tests use a fake provider. Only one provider is active at a time.
- **Opt-in at two levels, like canvas.** Admin policy `image_generation`
  (default off) plus the active provider being configured and ready. Admins can
  also limit it by user group (ADR-0058). (A class-level switch was dropped in
  ADR-0064: class policies govern learning modes, and group limits cover
  students.) Users don't need a separate switch; generating needs the policy
  and a ready provider.
- **Agent tool.** `generate_image` is an internal, context-managed tool for the
  main agent (sub-agents don't get it; ADR-0064), offered only when image
  generation is available and the chat model supports tools. The agent writes
  the prompt from the conversation. Prompt text grants nothing else.
- **Explicit mode.** "Create image" in the composer marks the next message as
  an image request: the agent must call `generate_image` (forced tool choice).
  If the chat's model has no tool support, the message's text is sent to the
  generator directly, so explicit mode works with any model.
- **Jobs, not blocking calls.** Generation runs as a queued job (one at a time
  per local GPU by default, configurable for ComfyUI) with progress (queued,
  step n of m) streamed to the chat over the existing WebSocket, cancellation,
  and a timeout. The chat turn waits for its job; other chats keep working.
- **Storage.** Each image becomes a library file (PNG, via the files domain's
  `new_library_file`), with provenance recorded alongside it, and the tool
  result carries file ids, not image data. Messages render the images inline
  with view-full-size and download, reusing chat file access checks.
- **Safety baseline.** Lightly filtered models are a deliberate choice, so the
  platform's own guards matter more:
  - The admin policy and group limits above (student groups can stay off).
  - A non-configurable refusal of sexual content involving minors, checked on
    the prompt before generation, and logged.
  - An audit log of every generation: user, chat, prompt, provider, model,
    seed, outcome.
  - Model licenses are shown in the catalog. Some (Qwen-Image-2.1's Qwen
    Research License) are non-commercial; the admin must acknowledge the
    license before downloading.

## Local diffusers backend

- **Hardware detection.** At startup and on demand: CUDA (device name, total
  and free VRAM via `torch.cuda.mem_get_info`), Apple MPS (unified memory from
  system RAM), else CPU (RAM, cores). Reported to admins, never to users.
- **Model catalog.** A pinned list (Hugging Face id, revision, license, pipeline
  class, default steps and size, memory needed per precision, devices it runs
  on). Recommendation: the highest-quality entry whose memory fits the device
  with headroom, preferring lightly filtered models. Candidates, to be verified
  (ids, revisions, licenses and measured memory) at implementation:

  | Tier                                 | Candidate                                        | Notes                                                                                                                                                   |
  | ------------------------------------ | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | High (CUDA ~24 GB+, or Apple 64 GB+) | Qwen-Image-2.1 (7B), `QwenImage21Pipeline`       | Best quality and text; lightly filtered; diffusers ≥ 0.41; **Qwen Research License, non-commercial**. A Turbo (8-step) variant needs a newer diffusers. |
  | Mid (CUDA ~16 GB, Apple 32 GB+)      | Z-Image-Turbo (6B), `ZImagePipeline`             | Apache 2.0, 8 steps, FP8 variants for less memory.                                                                                                      |
  | Low (CUDA ~8–12 GB, Apple 16 GB)     | FLUX.2 [klein] 4B, or a quantized mid-tier model | Apache 2.0 (klein 4B).                                                                                                                                  |
  | CPU only                             | Smallest catalog entry with offload              | Works but takes minutes per image; the UI says so.                                                                                                      |

- **Downloads** reuse the pinned-model download flow used for captioning
  (`knowledge/model_download.py`): progress, verification, cancel, stored under
  `STORAGE_ROOT/models/`, kept by the development reset.
- **Runtime.** The pipeline runs in a separate worker process started by the
  backend, so generation never blocks the event loop and a crash or
  out-of-memory error doesn't take the API down. It loads lazily, picks dtype
  and memory options per device (bf16/fp16 on CUDA, fp16/fp32 on MPS, CPU
  offload and attention slicing when memory is tight), and unloads after an
  idle period. Out-of-memory errors come back as a clear error with a
  suggestion to choose a smaller model.
- **Packaging.** `diffusers` (and `accelerate`) become backend dependencies.
  The default Docker image stays CPU; CUDA needs the NVIDIA container runtime
  and a CUDA build of torch. Document both, and Apple MPS for local
  development.

## ComfyUI backend

- Admin settings: server URL, optional auth header, and a workflow: a ComfyUI
  API-format JSON with placeholders for prompt, negative prompt, width, height,
  seed and steps. Ship one default text-to-image workflow.
- Submit via `POST /prompt`, follow progress over ComfyUI's WebSocket, fetch
  results from `/history` and `/view`. Test-connection and a sample
  generation from the admin page.
- The URL is admin-set only; requests go nowhere else (no URLs from prompts or
  workflows outside the configured server).

## US-76.1: Image generation domain and agent tool

As a user, I want the agent to make an image when I ask, and find it in my files.

Estimate: 3 days. Dependencies: none.

Acceptance: an ADR covers the provider interface, jobs, storage, provenance,
policy, explicit mode and the safety baseline. The domain runs jobs through a
provider (a fake one in tests), saves PNGs to the user's files with
provenance, streams progress and supports cancellation. `generate_image` is
offered only when the policy is on, the provider is ready and the model
supports tools; explicit mode forces it, or calls the generator directly
without tool support. Group and class policies apply; the minors-content
refusal and audit log are in place.

- [x] ADR; domain, job queue, storage, provenance, policy and tool.
- [x] Tests: gating, explicit mode with and without tools, storage, ownership, cancellation, refusal and audit.

## US-76.2: Local diffusers generator

As an administrator, I want to run image generation on this server's hardware
with a model that fits it.

Estimate: 4 days. Dependencies: US-76.1.

Acceptance: hardware detection reports device and memory; the catalog is
pinned and verified; the API recommends a model for the detected hardware;
downloads reuse the pinned-model flow; generation runs in a worker process
with per-device settings, idle unload and clear out-of-memory errors.

- [x] Detection, catalog, recommendation, download and worker runtime.
- [x] Tests with a stub pipeline (device choice, recommendation, OOM, worker crash); a manual run on CUDA, MPS and CPU recorded in the story.

Manual run (2026-11-09, Apple M-series, 128 GB): the real worker loaded
`tiny-random/z-image` with `ZImagePipeline` and made two 256² images with
seeds 3 and 4 and step progress: MPS in 2.1 s, CPU in 31.5 s. This machine
recommends Qwen-Image-2.1 Turbo; a full-size run needs its 32 GB download.
CUDA has not been run: no NVIDIA machine was available.

Small models (2026-11-10, same machine, real downloads, `a red fox sitting in
a snowy forest`, seed 42, one image after a warm-up):

| Model | Device, precision | Size | Time |
| --- | --- | --- | --- |
| DreamShaper 8 LCM | MPS, bf16 / fp16 | 512² | 2.7 s / 2.5 s |
| DreamShaper 8 LCM | CPU, float32 | 512² | 12.8 s |
| DreamShaper 8 LCM | CPU, bf16 | 512² | stopped after 10 min (2 cores busy) |
| DreamShaper XL Lightning | MPS, bf16 / fp16 | 1024² | 2.8 s / 3.5 s |
| DreamShaper XL Lightning | CPU, float32 | 1024² | 49.4 s |

The bf16 CPU result led to per-OS, per-processor precision (ADR-0064). fp16
images were checked for the SDXL black-image problem: none.

## US-76.3: ComfyUI generator

As an administrator, I want to use our existing ComfyUI server.

Estimate: 2 days. Dependencies: US-76.1.

Acceptance: URL, auth and workflow settings; the default workflow; prompt
submission, progress, result download and errors (unreachable, bad workflow,
timeout); test connection.

- [ ] Client, workflow templating and settings.
- [ ] Tests against a fake ComfyUI server.

## US-76.4: Admin settings

As an administrator, I want to choose and set up image generation in one place.

Estimate: 2 days. Dependencies: US-76.2, US-76.3.

Acceptance: Admin Settings → Image Generation replaces the planned page:
policy and group limits, provider choice, hardware report with the
recommended model and its license, download with progress, ComfyUI
connection, and a test generation. Settings export includes the policy and
provider settings (not secrets).

- [ ] Admin page with generated client hooks.
- [ ] Unit tests and an E2E for each provider path.

## US-76.5: Images in chat

As a user, I want to ask for images in chat and view and download them there.

Estimate: 3 days. Dependencies: US-76.1 (US-76.4 to try it for real).

Acceptance: "Create image" in the composer's menu adds an Image chip so the
next message is an image request; asking in plain words works too. The turn
shows progress and can be cancelled; finished images appear inline with
full-size view, download and a link to the file; regenerate and "more like
this" (new seed) work. Help and glossary cover image generation.

- [ ] Composer mode, inline images, progress, viewer, help.
- [ ] Unit tests and an E2E with a fake provider from prompt to saved image.

## Later (not in this epic)

- Editing an existing image ("make the sky darker") with models that support
  it (Qwen-Image-2.1 does), using the source-image field of the request.
- Per-user quotas, and image generation for sub-agents.
