# EPIC-11 — LLM Provider Types and Model Capabilities

## Status

**In progress.** US-11.1 through US-11.3 are completed, verified, and user-confirmed; US-11.4 is implemented and verified, awaiting user confirmation.

## Goal

Make LLM provider configuration explicit and less error-prone by allowing an
administrator to choose either **OpenAI** or **Generic OpenAI**. OpenAI always
uses Asterism's canonical OpenAI API base URL, while Generic OpenAI requires an
administrator-supplied OpenAI-compatible base URL.

Discover and persist model capabilities, initially the context-window size and
vision-input support. Asterism should use authoritative metadata when it is
available and let administrators complete or correct metadata when discovery
cannot determine it.

## Current findings (code inspection)

| Area | Current behavior / problem |
| --- | --- |
| Provider contract | `ProviderModel` and `ProviderInfo` contain a name, base URL, and API key, but no provider type. Every provider is treated as a generic OpenAI-compatible endpoint. |
| Provider UI | The admin enters every base URL manually. There is no distinction between first-party OpenAI and compatible servers. |
| Model discovery | A Next.js server action calls `{base_url}/models` directly and retains only each model's `id`. It silently returns an empty list for non-success responses. |
| Model metadata | `LLMModel` records only name and active state. Context-window and vision capabilities cannot be stored or exposed to model consumers. |
| Refresh behavior | Model IDs and active states are merged by model name, but there is no capability provenance with which to preserve administrator corrections. |
| API ownership | Discovery bypasses the generated backend API client, duplicates provider protocol knowledge in the frontend, and provides limited validation, diagnostics, timeout control, and response-shape handling. |
| Schema evolution | Backend initialization uses SQLAlchemy `create_all`, which creates missing tables but does not add columns to existing tables. This epic therefore requires an explicit, tested, data-preserving migration path. |

## Product and data decisions

### Provider types

Introduce the closed provider-type enum below. Persist enum values as stable
lowercase strings so future provider types can be added without renaming the
existing values.

| Value | Display label | Base URL behavior | Discovery behavior |
| --- | --- | --- | --- |
| `openai` | OpenAI | Backend-enforced `https://api.openai.com/v1`; not administrator-editable | OpenAI `/models` plus Asterism's maintained OpenAI capability catalog |
| `generic_openai` | Generic OpenAI | Required administrator-supplied absolute `http` or `https` URL, normalized without a trailing slash | OpenAI-compatible `/models` response with best-effort metadata extraction |

The backend is authoritative: it ignores/rejects a custom base URL for an
`openai` provider and always stores/uses the canonical URL. Runtime client
construction continues to consume the normalized persisted base URL, so this
epic does not require a second LLM client implementation.

Existing providers are migrated without deletion:

- A provider whose normalized URL is exactly the canonical OpenAI URL becomes
  `openai`.
- Every other existing provider becomes `generic_openai`.
- Existing provider/model UUIDs, API keys, active states, and draft/default
  model references are preserved.

### Initial model capability contract

Add typed, nullable fields to each model:

| Field | Type | Meaning |
| --- | --- | --- |
| `context_window` | positive integer or `null` | Maximum total input/output context in tokens as reported by the catalog/provider; `null` means unknown. |
| `supports_vision` | boolean or `null` | `true` accepts image input, `false` is known not to, and `null` means unknown. |
| `context_window_source` | `catalog`, `provider`, `manual`, or `unknown` | Provenance for context-window metadata. |
| `vision_source` | `catalog`, `provider`, `manual`, or `unknown` | Provenance for vision metadata. |

Tri-state vision support is intentional: treating “not reported” as `false`
would turn missing Generic OpenAI metadata into incorrect capability data.
Manual edits set only the edited field's source to `manual`. A later refresh
must not overwrite a manual value unless the administrator explicitly chooses
to replace/reset it.

The OpenAPI schemas and generated frontend client remain the shared contract.
Capability fields must be included anywhere the existing `Llm` model is
returned, including model/provider lookups used by the runtime.

### Capability discovery

Capability discovery belongs behind an admin-only backend endpoint/service,
not in a frontend server action. A request contains the provider type, normalized
base URL where applicable, and credentials needed to inspect an unsaved
provider. The response is a typed list of discovered model records and per-field
provenance; credentials are never echoed or logged.

For OpenAI:

1. Fetch the available model IDs from the canonical OpenAI `/models` endpoint.
2. Enrich recognized model IDs/families from a versioned, tested catalog owned
   by the backend.
3. Leave unrecognized capability fields unknown and editable rather than
   guessing from arbitrary names.

For Generic OpenAI, parse the standard `data[].id` and recognize a deliberately
small set of common metadata shapes, including:

- Context: `context_window`, `context_length`, `max_context_length`, or
  `max_model_len` when it is a valid positive integer.
- Vision: an explicit `supports_vision` boolean, image presence in
  `input_modalities` / `architecture.input_modalities`, or an explicit
  `capabilities.vision` boolean.

The extractor must be isolated and fixture-tested. It must not infer vision or
context from a model name. Unknown or conflicting metadata remains unknown and
is called out in the response/UI. Provider-specific response shapes can be
added later without changing the persisted model contract.

Discovery should have bounded connect/read timeouts, a bounded response size,
no credential-bearing logs, and actionable errors for authentication,
connectivity, timeout, and malformed responses. Generic endpoints may
intentionally be private/local because self-hosted models are a supported use
case; access remains admin-only. Redirects must not silently forward the API key
to another origin.

### Refresh and manual override semantics

Models continue to be matched by provider and model name. Refreshing:

- preserves the existing model UUID and active state for a matching name;
- fills an unknown capability when discovery returns a value;
- updates a previously discovered value when fresh authoritative metadata is
  returned;
- preserves a field whose source is `manual`;
- reports unknown fields so the administrator can fill them in; and
- never changes the draft model selection merely because metadata changed.

The save path validates positive context windows and valid tri-state vision
values at both API and UI boundaries.

## Scope / non-goals

**In scope:**

- OpenAI / Generic OpenAI provider-type enum and admin dropdown
- Canonical, non-editable OpenAI base URL and required Generic OpenAI base URL
- Data-preserving provider/model schema migration
- Typed context-window and vision metadata with per-field provenance
- Admin-only backend model/capability discovery
- OpenAI capability catalog and best-effort Generic OpenAI metadata extraction
- Manual capability entry/correction and refresh-preservation rules
- OpenAPI/client regeneration, backend/frontend tests, and documentation

**Not in scope:**

- Anthropic, Google, Ollama-native, or other non-OpenAI protocols
- Automatically probing models with paid chat/image requests
- Token counting, automatic truncation, or changing agent context-window logic
- Blocking model selection or chat attachments based on capabilities
- Pricing, rate limits, embeddings, audio, tool-use, reasoning, or structured
  output capabilities
- A general provider plugin marketplace
- Broad API-key storage/redaction redesign (credentials must still not be added
  to discovery logs or error responses)

## User stories

### US-11.1 — Persist provider types and model capability metadata

**As an administrator**, I want provider type and model capabilities represented
in the backend contract so that configuration is explicit, durable, and usable
by all application layers.

**Dependencies:** None.

- [x] US-11.1-T1: Add the `openai` / `generic_openai` provider enum, canonical OpenAI URL policy, and backend validation/normalization rules.
- [x] US-11.1-T2: Extend provider and model persistence plus Pydantic/OpenAPI schemas with provider type, context window, tri-state vision support, and per-field provenance.
- [x] US-11.1-T3: Implement a repeatable, data-preserving migration for supported relational databases; classify existing providers by normalized URL and preserve all identifiers, credentials, active states, relationships, and settings references.
- [x] US-11.1-T4: Update bulk upsert/merge and read services so typed metadata round-trips and manual provenance is not discarded.
- [x] US-11.1-T5: Add backend validation and migration tests covering fresh databases, existing OpenAI/generic rows, repeated migration, invalid values, and model/default-reference preservation.
- [x] US-11.1-T6: Regenerate the Hey API client and verify generated types expose the new contract without handwritten duplicates.

**Acceptance criteria**

- Every provider has exactly one supported provider type.
- OpenAI always resolves to `https://api.openai.com/v1`; Generic OpenAI requires a valid administrator-provided HTTP(S) URL.
- Unknown capability values are represented as unknown, not guessed defaults.
- Existing provider/model data and references survive migration.
- Provider/model metadata round-trips through persistence and OpenAPI.

---

### US-11.2 — Discover models and capabilities through the backend

**As an administrator**, I want Asterism to retrieve available models and any
published capabilities so that setup requires less manual research and entry.

**Dependencies:** US-11.1.

- [x] US-11.2-T1: Define an admin-only discovery request/response and backend provider-discovery interface, with typed results and safe error details.
- [x] US-11.2-T2: Implement OpenAI discovery using the canonical endpoint and a versioned backend capability catalog; leave uncatalogued fields unknown.
- [x] US-11.2-T3: Implement Generic OpenAI `/models` discovery and a conservative extractor for the documented context/vision metadata shapes.
- [x] US-11.2-T4: Add bounded timeouts/response handling, prevent cross-origin credential forwarding, and add structured redacted diagnostics.
- [x] US-11.2-T5: Implement merge semantics that preserve UUIDs, active state, draft selection, and manual per-field overrides while refreshing discovered values.
- [x] US-11.2-T6: Add unit/integration fixtures for OpenAI catalog matches, unknown OpenAI IDs, common generic response shapes, missing/conflicting metadata, auth/connectivity/timeout/malformed failures, and refresh preservation.

**Acceptance criteria**

- Only an authenticated admin can invoke discovery.
- OpenAI discovery cannot be redirected to a user-supplied base URL.
- Generic discovery records recognized metadata and returns unknown for absent or ambiguous fields.
- Discovery failures are visible and actionable; they are not represented as a successful empty model list.
- API keys do not appear in logs, responses, or exception text.

---

### US-11.3 — Configure provider type and capabilities in the admin UI

**As an administrator**, I want a clear provider-type selector and editable model
capabilities so that I can configure both OpenAI and self-hosted/compatible
providers accurately.

**Dependencies:** US-11.1, US-11.2.

- [x] US-11.3-T1: Add an accessible provider-type dropdown with OpenAI and Generic OpenAI options to each provider editor.
- [x] US-11.3-T2: For OpenAI, show the canonical URL as fixed/read-only; for Generic OpenAI, show and validate the editable required base URL. Clear stale type-specific validation when switching types.
- [x] US-11.3-T3: Replace the direct Next.js `/models` fetch action with the generated admin discovery client and display actionable loading/success/error states.
- [x] US-11.3-T4: Render context-window and tri-state vision fields for each model, identify discovered versus manual values, highlight unknown metadata, and allow administrators to enter/correct/reset values.
- [x] US-11.3-T5: Preserve active-state, default-model, and manual-capability choices during model refresh and provider-type form updates.
- [x] US-11.3-T6: Add frontend tests for type switching, base URL behavior, discovery success/failure, unknown metadata, manual edits, refresh merging, validation, and accessible keyboard/label behavior.

**Acceptance criteria**

- The provider type is selected from a dropdown rather than inferred from the name or URL.
- An OpenAI provider cannot be saved with a custom base URL.
- A Generic OpenAI provider cannot be saved without a valid base URL.
- Unknown capabilities are obvious and editable; `false` vision support is distinguishable from unknown.
- Refreshing models does not erase administrator capability overrides or change the selected draft model.

---

### US-11.4 — Verify the provider workflow end to end

**As a user and maintainer**, I want provider metadata changes verified across
configuration and runtime lookup so that the new schema does not break chat or
default-model behavior.

**Dependencies:** US-11.1 through US-11.3.

- [x] US-11.4-T1: Add an integration scenario covering provider creation, discovery, manual completion of unknown capabilities, save/reload, model activation, and draft/default model retention.
- [x] US-11.4-T2: Verify `LLMClient` construction uses the canonical OpenAI URL or normalized Generic OpenAI URL and that existing chat/draft paths still resolve active models.
- [x] US-11.4-T3: Add a browser E2E scenario with deterministic mocked discovery for both provider types, including Generic OpenAI metadata fallback and a discovery error.
- [x] US-11.4-T4: Update provider/setup and architecture documentation with type semantics, capability provenance, discovery limitations, and manual fallback behavior.
- [x] US-11.4-T5: Run backend/frontend lint, typecheck, tests, build, generated-client consistency checks, migration tests, and relevant Playwright coverage; record any live-provider limitations.

**Acceptance criteria**

- Provider and model capability values survive save/reload and are available to runtime model lookups.
- Existing model IDs, active selections, and draft/default references remain valid after upgrade and refresh.
- Deterministic automated coverage proves both provider workflows without requiring external credentials.
- Documentation explains that Generic OpenAI metadata is best-effort and can require manual completion.

**Verification record:** root lint, typecheck, test, and build passed; backend
reported 89 passing tests, frontend reported 30 unit tests plus 6 migration
tests, configuration reported 28 passing tests, and isolated Playwright reported
6 passing scenarios. The backend OpenAPI contract did not change in US-11.4, so
the generated client remains synchronized. Browser/provider tests use deterministic
mocks; no live external provider was invoked because availability, credentials,
and compatible metadata vary by installation.

## Execution plan and definition of done

Recommended sequence: **US-11.1 → US-11.2 → US-11.3 → US-11.4**.

Create a feature branch when each story starts and update `todo.md` as work
proceeds. Work on one story at a time. For every story: complete all tasks, pass
relevant lint/typecheck/tests, keep OpenAPI and the generated client synchronized,
document changed behavior, and request user completion confirmation before
merging into `main`.

The epic is complete only after all stories meet their acceptance criteria and
the user confirms completion.

## Risks to resolve, not hide

- **Metadata is not standardized.** OpenAI's model-list response does not expose
  context and vision consistently, and compatible providers add different
  extensions. Keep extraction conservative, fixture-based, and nullable.
- **OpenAI catalog drift.** First-party model capabilities evolve. Keep the
  catalog isolated, versioned, tested, and easy to update; never invent values
  for an unknown model.
- **Manual values could be overwritten.** Per-field provenance and explicit
  merge tests are required before enabling refresh.
- **Schema upgrades can strand installations.** `create_all` cannot alter
  existing tables. The migration must be repeatable and preserve foreign-key
  references on both SQLite and the project's supported relational path.
- **Generic endpoints can be internal.** Admin-configured local endpoints are a
  valid use case, so generic SSRF blocking cannot simply reject private ranges.
  Compensate with admin-only authorization, strict URL parsing, bounded I/O,
  redirect controls, response limits, and redacted logs.
- **Provider type switching can invalidate configuration.** UI and backend must
  agree on canonicalization and must not retain a hidden custom URL when OpenAI
  is selected.
