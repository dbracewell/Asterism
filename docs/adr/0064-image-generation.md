# ADR-0064 — Image generation runs through one provider interface and produces chat files

Status: accepted; domain, tool and Create image in US-76.1 on 2026-11-09
([EPIC-76](../epics/EPIC-76-IMAGE-GENERATION.md)).

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

## Consequences

- ComfyUI and diffusers only implement `status` and `generate`.
- Generated images appear in the user's files and in the chat with existing
  file access rules, and the audit trail records every attempt.
- The prompt check can refuse harmless prompts; that is accepted for this
  category.
