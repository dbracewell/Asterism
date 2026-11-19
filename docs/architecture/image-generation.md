# Image generation

This guide explains how users create images in chat: who may, how a request
travels from a chat message to a saved PNG, the two generators Asterism supports,
the prompt check that every request passes, and what is recorded. Read it before
changing the `image_generation` domain, a generator or the `generate_image` tool.

## Concepts

- **A generator** is the backend that makes images. Asterism ships two: **ComfyUI**,
  a separate server the admin points at, and **Diffusers**, a local model run by
  Asterism itself. Generators are components, the same pluggable layer as the
  search providers ([tool authorization](tool-authorization.md#components-behind-the-tools)).
- **Availability** means image generation is switched on, the user's group is
  allowed, and the chosen generator reports itself ready. All three are read live.
- **The prompt check** is a fixed rule that refuses prompts pairing a minor with
  sexual content. It can't be configured or turned off.
- **Generated images are files.** Each image is saved to the user's library as a
  generated file and shown in the chat through the normal file rules.

## How it works

### Two ways to ask

- **In plain words.** When generation is available and the model supports tools,
  the main agent is offered `generate_image`, and its runtime instructions tell it to
  use the tool when asked for an image.
- **Create image.** The composer's + menu offers Create image when
  `GET /image-generation/availability` says the user can generate. The next message
  is sent with `create_image: true`, and the turn's first step must make an image:
  - if the model supports tools, the agent forces a `generate_image` call;
  - if it doesn't, the agent skips the model and generates directly from the
    message's text, writing no tool messages into the history;
  - if the tool is no longer offered (generation was switched off after sending),
    the turn ends with that error.

Create image is refused in a comparison and in a special-purpose chat.

`generate_image(prompt, negative_prompt?, size?, count?, seed?)` takes named sizes
(`square`, `portrait`, `landscape`, `wide`) rather than pixels. Its result lists the
saved images, with file ID, name, size, seed, model and an embed for the reply, but
never the pixels. Failures come back as error results rather than exceptions, so the
tool registry never retries an expensive generation.

### From request to saved image

`generate_images` in
[`image_generation/service.py`](../../apps/backend/asterism/domains/image_generation/service.py)
runs every request, from chat or from the admin's test:

1. **The prompt check**
   ([`safety.py`](../../apps/backend/asterism/domains/image_generation/safety.py))
   reads the prompt and negative prompt together. It is a word-level rule that errs
   toward refusing. It runs first, so every refusal is recorded.
2. **Availability** is checked again, and the user's budget
   ([usage and budgets](usage-and-budgets.md)).
3. **The job waits its turn.** One job runs at a time per generator, because a local
   GPU runs one pipeline. Each job has a 10-minute timeout and can be cancelled.
4. **Progress** (`queued`, then `running` step n of m, then `saving`) is sent to the
   chat as `tool_progress` packets, which the chat shows as a progress bar.
5. **Each image is re-encoded** as a plain PNG with Pillow. This proves it is an
   image and strips embedded metadata, such as the workflow ComfyUI writes into its
   files.
6. **The images are saved.** In a chat, each becomes a generated library file
   linked to the chat, the run and the tool, in scope only on that run's branch
   ([data and storage](data-and-storage.md#the-library)). The reply shows them with
   `asterism-file:` embeds, and every view rechecks access.

No database session is held open while an image is being generated.

**Every attempt is recorded** in `image_generations`: the user, chat, prompt and
negative prompt, generator, model and revision, size, count and steps, the status
(`completed`, `failed`, `refused` or `cancelled`), any error, the saved files with
their seeds, and the duration. A row stays when its chat is deleted and goes with the
user.

### The ComfyUI generator

The admin gives the server address, optional sign-in (bearer token or username and
password), the checkpoint for the built-in workflow or a custom workflow, default
steps and guidance, a timeout and TLS verification. The token is a component secret:
encrypted at rest and never returned.

Workflows are in ComfyUI's API format. They use placeholders such as `{{prompt}}`
(required), `{{negative_prompt}}`, `{{seed}}` and `{{checkpoint}}`. User text is only
ever placed into values, never read as a placeholder. Saving a workflow in ComfyUI's
interface format, or one with an unknown placeholder, is refused with the reason.

Each image is its own ComfyUI job, with seeds seed, seed + 1 and so on. Progress
comes over a WebSocket and completion from polling `/history`, so a proxy that blocks
WebSockets only loses the progress bar. A timeout or cancellation removes Asterism's
job from ComfyUI's queue without touching other users' jobs on a shared server.
**Test connection** reports the server's version and devices and suggests its
checkpoints.

### The local Diffusers generator

Asterism can run an image model itself, in a separate worker process
([`image_generation/local/`](../../apps/backend/asterism/domains/image_generation/local/)):

- **Hardware.** It detects an NVIDIA GPU, an Apple GPU or the CPU, with its memory,
  and chooses a precision per device and model.
- **A pinned catalog.** Each model is pinned to a repository and commit, with its
  license, recommended steps and memory estimates. The admin page shows which models
  fit the detected hardware and recommends one. A model with a non-commercial license
  must be accepted first; acceptance is recorded.
- **Downloads** use the same verified download service as the embedding model, into
  `STORAGE_ROOT/models/image-generation`.
- **The worker** loads the model from local files only, makes images one at a time
  with a seed per image (the same seed gives the same image on any device), and
  reports each step. It stops after 10 idle minutes, a model or device change, a
  cancel or an out-of-memory error, and a fresh worker starts with the next job.

Stable Diffusion's own image safety checker is not loaded; the platform's prompt
check governs instead. [ADR-0064](../adr/0064-image-generation.md) lists the catalog
and the precision and memory rules.

## Settings

Admin Settings → Image Generation has four parts, in the order an admin works:

| Part         | Does                                                                                                 |
| ------------ | ---------------------------------------------------------------------------------------------------- |
| Generator    | Chooses ComfyUI or Diffusers and their settings, with the generator's status and a test              |
| Local models | For Diffusers: hardware, the catalog with fit and licenses, downloads                                |
| Try it       | Generates one image for the admin, saved to their files (`POST /settings/app/image-generation/test`) |
| Availability | The on/off switch and which groups may generate (`GET`/`PUT /settings/app/image-generation`)         |

"Try it" works while generation is switched off, so a generator can be tested first,
but it is not a bypass: the prompt check, readiness, queue and record all apply.

Generation is off by default. With no group list, every group may generate. The
settings export carries the switch and the generator, secrets included in the
encrypted file, but not the group limits, because group IDs differ between instances.

## Rules

- Every request passes the fixed prompt check first, and every attempt is recorded.
- Generation needs the switch, the user's group and a ready generator, all read live.
- Only the main agent generates, in ordinary chats, and only through
  `generate_image` or Create image.
- Images are plain PNGs, re-encoded and stripped of metadata.
- Generated images are ordinary files under the normal access rules.
- A new backend is a new component; the policy, check, jobs and storage stay in the
  domain.

## Where the code lives

1. [`image_generation/service.py`](../../apps/backend/asterism/domains/image_generation/service.py):
   the request pipeline.
2. [`image_generation/safety.py`](../../apps/backend/asterism/domains/image_generation/safety.py):
   the prompt check.
3. [`image_generation/policy.py`](../../apps/backend/asterism/domains/image_generation/policy.py):
   availability.
4. [`image_generation/providers.py`](../../apps/backend/asterism/domains/image_generation/providers.py),
   [`comfyui/`](../../apps/backend/asterism/domains/image_generation/comfyui/) and
   [`local/`](../../apps/backend/asterism/domains/image_generation/local/): the
   generator interface and the two generators.
5. [`tools/builtin/image_generation.py`](../../apps/backend/asterism/domains/tools/builtin/image_generation.py):
   the agent tool.

## Related

- [ADR-0064](../adr/0064-image-generation.md): image generation
- [ADR-0039](../adr/0039-inline-file-references-in-markdown.md): generated files and
  inline embeds
- [Tool authorization](tool-authorization.md)
