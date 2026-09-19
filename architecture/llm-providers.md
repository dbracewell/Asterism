# LLM Providers and Model Capabilities

Asterism supports two provider configurations that share the OpenAI protocol and
runtime SDK but differ in URL ownership and capability discovery.

## Provider types

| Type | Base URL | Discovery |
| --- | --- | --- |
| **OpenAI** (`openai`) | Always `https://api.openai.com/v1`; administrator input is ignored and the UI is read-only | `/models` IDs enriched by Asterism's versioned OpenAI capability catalog |
| **Generic OpenAI** (`generic_openai`) | Required administrator-supplied absolute HTTP(S) URL, normalized without a trailing slash | OpenAI-compatible `/models` with conservative best-effort metadata extraction |

Both runtime chat and discovery use the OpenAI Python SDK. Generic OpenAI is a
protocol compatibility mode; provider-specific APIs such as native Ollama or
Anthropic endpoints are not supported.

## Configuration workflow

1. Open **Settings → Admin Settings → Providers** and add a provider.
2. Select the provider type, enter its name and API key, and supply a base URL
   for Generic OpenAI.
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

Asterism does not infer capabilities from model names. Missing, invalid, or
conflicting metadata remains unknown and requires administrator review. A
successful empty list is distinct from authentication, connectivity, timeout,
redirect, oversized-response, and malformed-response failures.

## Runtime lookup

Models are stored by provider and name. Matching models retain their UUID during
refresh, preserving agent and draft references. Chat model lookup accepts only
active models. Draft lookup also requires the selected model to remain active.
The runtime `LLMClient` receives the normalized persisted URL, so OpenAI always
uses the canonical origin and Generic OpenAI uses the administrator's normalized
compatible endpoint.

## Verification

Backend tests cover catalog and generic extraction, failures and redaction,
manual refresh preservation, persistence/reload, URL normalization, active
runtime lookup, and draft retention. The test-only `/e2e/providers` browser
harness mocks backend discovery deterministically and covers OpenAI, Generic
OpenAI manual fallback, save/reload, and discovery failure without external
credentials. Live-provider behavior still depends on provider availability,
credentials, and compatibility with the OpenAI protocol.
