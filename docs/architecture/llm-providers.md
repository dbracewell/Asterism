# LLM providers

This guide explains how Asterism talks to language models: the kinds of provider
an admin can configure, how a model's capabilities are discovered and recorded,
how prices are set, and how a user's own ChatGPT plan fits in. Read it before
adding a provider type or changing how capabilities gate tools and images.

Asterism supports two admin-configured provider types that share the OpenAI
protocol and SDK but differ in URL ownership and capability discovery, plus
personal ChatGPT plan connections. Image generation uses its own providers, chosen
in Admin Settings → Image generation
([tool authorization](tool-authorization.md#components-behind-the-tools)).

## Provider types

| Type                                  | Base URL                                                                                   | Discovery                                                                     |
| ------------------------------------- | ------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------- |
| **OpenAI** (`openai`)                 | Always `https://api.openai.com/v1`; administrator input is ignored and the UI is read-only | `/models` IDs enriched by Asterism's versioned OpenAI capability catalog      |
| **Generic OpenAI** (`generic_openai`) | Required administrator-supplied absolute HTTP(S) URL, normalized without a trailing slash  | OpenAI-compatible `/models` with conservative best-effort metadata extraction |

Both runtime chat and discovery use the OpenAI Python SDK. Generic OpenAI is a
protocol compatibility mode; provider-specific APIs such as native Ollama or
Anthropic endpoints are not supported.

A Generic OpenAI provider records the service it was set up from
(`providers.service`; `null` is Custom), chosen from the catalog in
[`settings/provider_services.py`](../../apps/backend/asterism/domains/settings/provider_services.py):
hosted APIs (Gemini, Mistral, xAI, DeepSeek, Anthropic), aggregators (OpenRouter,
Groq, Together AI, Fireworks AI, DeepInfra, Cerebras) and local servers (Ollama,
LM Studio, llama.cpp, vLLM, LocalAI, Jan). The service supplies the default base
URL; requests are the same for all of them
([ADR-0086](../adr/0086-provider-services.md)). A local server or Custom
provider may have no API key; it then sends no `Authorization` header. A service that
refuses a parameter has it removed from its requests (Gemini: `seed`).

## Configuration workflow

On a new instance, the first-run setup card (`/setup`, step 2) connects one
provider, runs discovery, enables the chosen models and saves the administrator's
default model and the draft model (which follows the default until changed, and
is saved last because it must reference an active model), then shows step 3 ("You're ready to start your exploration.")
before opening the new-chat page. Each enabled model shows Vision and Tools boxes,
checked where discovery reported support and marked "(Unknown)" where it
reported nothing. A changed box is saved as a `manual` value; an untouched box
keeps its discovered value and source, so an unknown capability left unchecked
stays unknown. It uses the same provider schema and APIs as Admin Settings, is
shown only to an administrator while no model is active, and can be skipped.
Everything else follows the workflow below.

1. Open **Settings → Admin Settings → Providers** and add a provider.
2. Choose the service: OpenAI, a catalog service (which fills in its name and
   base URL), or Custom. Changing the service replaces only a name or URL that
   is empty or still the previous choice's default. Enter the API key.
3. Select **Load models**. Discovery is performed by the admin-only FastAPI
   endpoint; the browser never contacts the provider directly.
4. Review unknown capabilities, complete or correct them manually, activate the
   desired models, and select a draft model.
5. Save. Provider/model UUIDs, active state, the draft selection, and manual
   per-field overrides are retained on later refreshes.

Discovery credentials are write-only API input and are not returned by the
endpoint. Requests have bounded timeouts and response size, do not follow
redirects, and emit categorized diagnostics without credential values.

## Capability contract and provenance

The initial capability fields are:

- `context_window`: a positive token count, or `null` when unknown.
- `supports_vision`: `true`, `false`, or `null` when unknown.
- `supports_tools`: `true`, `false`, or `null` when unknown. Only explicit `true`
  permits runtime tool schemas and internal tools; model names never imply support.

Each field independently records one source:

- `catalog`: Asterism's versioned OpenAI catalog.
- `provider`: explicit metadata returned by a compatible provider.
- `manual`: an administrator-entered value.
- `unknown`: no trustworthy value is available.

Manual values win during refresh. A discovered value can fill an unknown field
or update an older discovered value, but it cannot replace a manual value.
Unknown is intentionally distinct from `false`.

## Generic OpenAI limitations

OpenAI-compatible `/models` metadata is not standardized. Asterism recognizes a
small set of explicit fields:

- Context: `context_window`, `context_length`, `max_context_length`, or
  `max_model_len`.
- Vision: `supports_vision`, `capabilities.vision`, or image presence in
  `input_modalities` / `architecture.input_modalities`.
- Tools: an explicit Boolean `supports_tools`. Missing metadata remains unknown.

Asterism does not infer capabilities from model names. Missing, invalid, or
conflicting metadata remains unknown and requires administrator review. A
successful empty list is distinct from authentication, connectivity, timeout,
redirect, oversized-response, and malformed-response failures.

## Runtime lookup

Models are stored by provider and name. Matching models retain their UUID during
refresh, preserving sub-agent, chat-selection, and draft references. Chat execution lookup accepts only
active models. Draft lookup also requires the selected model to remain active.
The runtime client receives the normalized persisted URL, so OpenAI always
uses the canonical origin and Generic OpenAI uses the administrator's normalized
compatible endpoint.

## Request capabilities and wire APIs

`create_llm_client` (`domains/llm/factory.py`) chooses the client from the
provider type's `RequestCapabilities` (`domains/llm/capabilities.py`): the wire
API, the generation parameters forwarded, and the tool kinds accepted.
Parameters and tool schemas outside the capabilities are omitted instead of
being sent and rejected. OpenAI and Generic OpenAI use Chat Completions
(`LLMClient`) with every parameter, unchanged.

`ResponsesLLMClient` (`domains/llm/responses.py`) implements the same
`LLMClientProtocol` over `POST /v1/responses` and emits the same `LLMEvent`
stream. Every request is stateless (`store: false`, `stream: true`): system
messages are joined into `instructions`, and the full history is resent as
`input` items, with tool calls and results as linked `function_call` /
`function_call_output` items. Only `response.completed` produces a normal
`COMPLETE`; `response.incomplete` completes with `length`/`content_filter` and
drops possibly truncated tool calls. `response.failed`, `error` events, HTTP
errors and streams that end early produce one `ERROR` event whose exception is
an `LLMProviderError` keeping the provider code, status, param and request ID.
SDK retries are disabled for this client, so usage-limit (429) errors surface
once. The ChatGPT plan capabilities send no `temperature`, `top_p`,
`max_tokens` or `seed` and only function tools.

## ChatGPT plan providers

`ProviderType.CHATGPT` providers are owned by one user (`owner_user_id`) and
created by that user's ChatGPT connection, never by admins. Their models sync
from the user's account and appear only in that user's pickers; admin provider
settings, the draft model and captioning see global providers only (see
`settings/queries.py`). A plan model runs only for its owner, on the owner's
current access token through `ChatGPTPlanClient`, which pauses the plan on a
usage limit, retries temporary unavailability with bounded backoff, refreshes
once on a rejected session, and reports `chatgpt_plan_<reason>` codes for the
recovery UI. Without a usable draft model, chat titles run on the chat owner's
own available plan model (`chat/title_model.py`); prompt-coach reviews use the
same resolution. See
[ADR-0025](../adr/0025-chatgpt-plan-connection.md).

Main-agent settings have no model binding. Chat selection and per-execution model
provenance are independent; unavailable selections remain visible without silent
replacement. Sub-agent definitions each bind one model; restrictive references
require explicit rebinding/removal before provider/model deletion. See
[agent runtime](agent-runtime.md) for replay and revocation.

## Model pricing

An admin may set a price per model: US dollars per million input tokens and per
million output tokens, both or neither (`ModelPricing`). Prices are edited only
through `PUT /app/providers/{provider_id}/models/{model_id}`, and provider saves and
catalog refreshes keep them.

A price is copied onto each run that uses the model, and onto each entry in the
usage ledger, at the time of the call. Changing a price therefore affects only
later calls; past runs and usage reports keep the cost they had
([agent runtime](agent-runtime.md#run-usage-and-cost),
[ADR-0073](../adr/0073-usage-ledger-and-budgets.md)). A model without a price shows
tokens only.

## File-input capability gating

Chat treats `supports_vision` conservatively. Only `true` lets an uploaded PNG,
JPEG, WebP, GIF or BMP become an `image_url` part. For `false` and unknown, the
image bytes are left out and the model gets a short note instead, so an unknown
capability is safe by default. Images also respect the configured vision byte limit
(`MAX_VISION_IMAGE_BYTES`). Text and converted documents are bounded text parts, and
unsupported or failed files are named, with the reason, rather than silently
assumed readable.

## Verification

Backend tests cover catalog and generic extraction, failures and redaction,
manual refresh preservation, persistence/reload, URL normalization, active
runtime lookup, and draft retention. The test-only `/e2e/providers` browser
harness mocks backend discovery deterministically and covers OpenAI, Generic
OpenAI manual fallback, save/reload, and discovery failure without external
credentials. Live-provider behavior still depends on provider availability,
credentials, and compatibility with the OpenAI protocol.
