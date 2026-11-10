# ADR-0064 — Image generation runs through one provider interface and produces chat files

Status: accepted; domain, tool and Create image in US-76.1, local diffusers
generator in US-76.2 on 2026-11-09, ComfyUI generator in US-76.3 on
2026-11-10 ([EPIC-76](../epics/EPIC-76-IMAGE-GENERATION.md)).

## Context

Users want to create images in chat, either by saying so explicitly or by
asking the agent. Two backends are planned: a ComfyUI server (US-76.3) and a
local diffusers generator inside the backend (US-76.2). Lightly filtered
models are a deliberate choice, and Asterism has student groups, so the
platform's own guards decide who may generate and what is refused.

## Decision

### Provider interface

`image_generation/providers.py` defines `ImageProvider`: a `name`, `status()`
(ready or not, with a reason) and `generate(request, progress)`, which returns
PNG bytes with seed and size per image, plus the model and revision. Providers
register a factory by name (`comfyui`, `diffusers`); tests register a fake.
The admin policy names the one active provider; `none` is never ready. A
provider raises `ImageGenerationError` for failures the user may see; any
other exception is logged and shown as a generic failure.

### Policy

One application setting, `image_generation`
(`{enabled, provider, group_ids}`), default off, with admin endpoints
`GET/PUT /settings/app/image-generation` and
`GET /settings/app/image-generation/status`. `group_ids` null means every
group; a list limits generation to those groups (ADR-0058), checked live.
**Available** means: enabled, the user's group allowed, and the provider
ready. `GET /image-generation/availability` tells the user whether they can
generate and why not.

The epic suggested a class mode policy switch too. Class policies govern
learning modes, not tools, so this is left out; group limits cover students.

The settings file exports the switch and provider, not group limits (group ids
differ between installations); importing keeps the local limits.

### Jobs

`service.generate_images` checks, queues, generates, saves and records:

1. The **prompt check** (`safety.py`) refuses a prompt that pairs a minor with
   sexual content, prompt and negative prompt together. It is fixed, not
   configurable, a word-level baseline that errs toward refusing, and runs
   before availability so every refusal is recorded.
2. Availability is rechecked.
3. One job at a time per provider (an in-process semaphore; a local GPU runs
   one pipeline), with a timeout (10 minutes) and cancellation.
4. Progress (`queued`, `running` step n of m, `saving`) goes to a callback.
5. Each image is re-encoded with Pillow as a plain PNG. That verifies it is an
   image and drops embedded metadata (ComfyUI embeds its workflow).
6. Database sessions are short: none is held while generating.

Every attempt writes an `image_generations` row: user, chat, prompt,
negative prompt, provider, model, revision, size, count, steps, status
(`completed`, `failed`, `refused`, `cancelled`), error, saved file ids with
seeds, and duration. Rows survive chat deletion (chat set null) and are
deleted with the user.

### Storage: produced chat files

Inside a chat run, images are registered with `register_produced_file`
(ADR-0039): ordinary library files with `origin = agent`, provenance (chat,
run, agent, tool `generate_image`), per-run limits, and chat membership
scoped to the run's branch. The chat can therefore show them inline from
`![name](asterism-file:<id>)` embeds, serve them through the scoped chat file
routes, and recheck access on every read. Outside a run (for example a test
generation from admin settings, later) images go straight to the library.

### The agent tool

`generate_image(prompt, negative_prompt?, size?, count?, seed?)` is an
internal, policy-gated tool for the **main agent** in ordinary chats, offered
when generation is available and the model supports tools; every call
rechecks this live. Sizes are named (`square`, `portrait`, `landscape`,
`wide`) rather than free pixels. The result carries the saved images (file
id, name, size, seed, model, prompt, embed) and tells the agent to include
the embeds in its reply; it never carries pixels. Failures come back as error
results rather than exceptions, so the tool registry never retries an
expensive generation. Runtime guidance tells the agent to call the tool when
asked for an image.

### Progress events

Tools get an optional `progress_sink`. The agent puts `ToolProgress`
(`tool_call_id`, `name`, `stage`, `step`, `total`) on the queue it already
uses for sub-agent events and yields `TOOL_PROGRESS` events, which the
orchestrator sends as `{"type": "tool_progress", …}`. Any long-running tool
can use it.

### Create image (explicit mode)

`create_image: true` on a send marks the user message (`image_request`). It
is refused unless the chat is an ordinary conversation, the send is not a
comparison, and generation is available now. On that turn's first step:

- if `generate_image` is offered, the agent sends a forced `tool_choice` for
  it;
- if the model has no tool support, the agent skips the model and generates
  directly from the message's typed text, replying with the embeds;
- if the model supports tools but the tool isn't offered (generation was
  turned off after sending), the turn ends with that error.

The direct path does not write tool-call messages, so a model without tool
support never sees tool messages in its history.

### Local diffusers generator (US-76.2)

- **Hardware.** `local/hardware.py` detects CUDA (name, total and free
  memory), Apple MPS (unified memory) or CPU (RAM), and whether the chosen
  device has fast native bf16; an admin may force a present device. Status
  checks use a cached report; the admin page detects fresh.
- **Precision depends on OS, processor and model.** Native bf16 means:
  NVIDIA Ampere or later (not emulated); Apple GPUs from M2 on with macOS 14;
  CPUs with AVX-512 BF16 or AMX (Intel Cooper Lake / Sapphire Rapids and
  later, AMD Zen 4 and later) or ARM SVE BF16 on Linux (Graviton 3 and later).
  macOS CPUs never count: an M5 Max reports ARM bf16, yet PyTorch ran a
  Stable Diffusion model over 50 times slower in bf16 than float32. Without
  native bf16, models trained in fp16 (the Stable Diffusion entries) run in
  fp16 on a GPU; bf16-trained models, which can overflow in fp16, and every
  CPU run use float32, and fit planning doubles their memory.
- **Catalog.** `local/catalog.py` pins each model's repository and commit
  (checked against Hugging Face on 2026-11-09), pipeline class, license,
  recommended steps and guidance, disk size and memory estimates with
  everything on the device and with model CPU offload. In preference order:
  Qwen-Image-2.1 Turbo (8 steps, non-commercial), Qwen-Image-2.1 (40 steps,
  non-commercial), Z-Image-Turbo (Apache 2.0), FLUX.2 [klein] 4B (Apache
  2.0), then two unfiltered Stable Diffusion community fine-tunes for small
  hardware: DreamShaper XL Lightning (SDXL, 4 steps, Open RAIL++-M; 8 GB GPUs,
  16 GB Macs) and DreamShaper 8 LCM (SD 1.5 at 512 px, 8 steps, Open RAIL-M;
  3–6 GB GPUs, 8 GB Macs, CPU). An entry may name a scheduler from its model
  card and a native resolution: larger requests are scaled down to its area,
  keeping the aspect ratio. Only the diffusers folders download: no
  single-file checkpoints, fp32 copies when fp16 weights exist (loaded as the
  `fp16` variant), or Stable Diffusion's separate image safety checker, which
  is not loaded; the platform's prompt check governs.
- **Fit and recommendation.** Headroom is a tenth of the estimate, at least
  1 GB. CUDA: fully on the GPU when memory covers the estimate plus headroom,
  else with CPU offload when the GPU covers the offload peak and system RAM
  holds the model. MPS: when 70% of unified memory covers it (no offload;
  memory is shared). CPU: 80% of RAM. The recommendation is the first catalog
  model that fits; on the CPU it is the smallest that fits, since speed
  matters more there.
- **Downloads** reuse `ModelDownloadService` (pinned revision, manifest
  verification, cancel) under `STORAGE_ROOT/models/image-generation`, kept by
  the development reset. A non-commercial license must be accepted first;
  acceptance is recorded in the `image_generation_local` setting and logged.
- **Worker process.** `local/runtime.py` spawns one worker per model, device,
  mode and dtype, and keeps it for the next job. The worker loads the
  pipeline from local files only, generates images one at a time with a CPU
  generator per seed (same seed, same image on every device), reports each
  step, and returns PNGs. Changing the model or device, cancelling a job, an
  out-of-memory error, or 10 idle minutes stops it. A crash is reported and
  the next job starts a fresh worker.
- **Settings.** `image_generation_local` holds the model, device override and
  accepted licenses. The settings file carries the model and device, not
  downloads or license acceptance.

### ComfyUI generator (US-76.3)

- **Settings.** `image_generation_comfyui` holds the server address (http or
  https, optional path prefix for a reverse proxy), auth (none, bearer token,
  or basic username and password), an optional custom workflow, the checkpoint
  for the built-in workflow, default steps and guidance, a per-request timeout
  (10–600 s) and TLS verification. The token is Fernet-encrypted at rest and
  never returned (`has_token` instead; an update without a token keeps it).
  The key is deliberately outside the generic application settings aggregate,
  so only `GET/PUT /settings/app/image-generation/comfyui` read or write it.
  The settings file carries it, token included, inside the encrypted bundle
  like provider API keys; a file without a ComfyUI server keeps the local one.
- **Workflows** are ComfyUI's API format ("Save (API)"). The built-in one is a
  plain checkpoint pipeline (checkpoint loader, two text encoders, empty
  latent, KSampler, VAE decode, Save Image). Placeholders: `{{prompt}}`
  (required), `{{negative_prompt}}`, `{{width}}`, `{{height}}`, `{{seed}}`,
  `{{steps}}`, `{{guidance}}`, `{{checkpoint}}`. A value that is exactly one
  placeholder takes the typed value; placeholders inside longer strings are
  replaced as text. User text only lands in values and is never re-read as a
  placeholder. Saving rejects the UI format, unknown placeholders and a
  missing `{{prompt}}`.
- **Jobs.** Each image is its own prompt with seed, seed + 1, …, matching the
  local generator. A WebSocket on a fresh client id reports sampler steps;
  completion and errors come from `/history`, polled every 0.5 s, so a proxy
  that blocks WebSockets only loses progress. Saved (`output`) images are
  downloaded from `/view` (64 MB cap; temp previews only when nothing was
  saved) and sized from the file. Rejected workflows, node errors, missing
  outputs, unreachable servers, bad credentials and timeouts each give their
  own message. On timeout or cancellation the job is deleted from the queue
  and interrupted by prompt id, so other users' jobs on a shared server keep
  running.
- **Status** checks configuration first, then reachability (`/system_stats`,
  cached 30 s per settings). **Test connection** tries unsaved settings and
  returns the version, devices and checkpoints, flagging a missing checkpoint.

## Consequences

- ComfyUI and diffusers only implement `status` and `generate`.
- Generated images appear in the user's files and in the chat with existing
  file access rules, and the audit trail records every attempt.
- The prompt check can refuse harmless prompts; that is accepted for this
  category.
