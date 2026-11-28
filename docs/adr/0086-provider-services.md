# ADR-0086 — Provider services

Status: accepted (2026-11-28). Implemented in US-125.1
([EPIC-125](../epics/EPIC-125-PROVIDER-SERVICES.md)); the dropdown is US-125.2
and keyless local servers US-125.3.

## Context

An administrator adds an LLM provider as OpenAI (`openai`, base URL pinned) or
as an OpenAI-compatible endpoint (`generic_openai`, any base URL). Every hosted
API, aggregator and local server that speaks Chat Completions already works
through `generic_openai`, but the administrator has to know and type its base
URL, and nothing records which service a provider is. Local servers usually
ignore the API key, yet Asterism requires one.

## Decision

**A provider records its service.** `providers.service` is a nullable text
column holding a `ProviderService` id such as `openrouter` or `ollama`. `NULL`
is Custom: any other URL. A check constraint (`ck_providers_service_generic`)
and the provider schema allow a service only on `generic_openai` providers;
OpenAI and ChatGPT plan providers have none. Existing providers read as Custom.
The column is text rather than an enum constraint, so adding a service needs no
migration. An id, once released, is never removed or renamed, since stored rows
and settings files name it.

**The backend owns the catalog.**
[`settings/provider_services.py`](../../apps/backend/asterism/domains/settings/provider_services.py)
lists each service once, in display order, with its label, group (`hosted`,
`aggregator`, `local`), default base URL, whether it needs a key and the
documentation the URL came from. `GET /settings/app/providers/services` (admins)
serves it to the form. The service only fills in the form: the administrator can
change the URL, and the stored base URL is what requests use.

**The first catalog**, each URL checked against the service's own documentation
on 2026-11-28 (`CATALOG_CHECKED`):

| Group      | Service          | Base URL                                                  |
| ---------- | ---------------- | --------------------------------------------------------- |
| Hosted     | Google Gemini    | `https://generativelanguage.googleapis.com/v1beta/openai` |
| Hosted     | Mistral          | `https://api.mistral.ai/openai/v1`                        |
| Hosted     | xAI              | `https://api.x.ai/v1`                                     |
| Hosted     | DeepSeek         | `https://api.deepseek.com`                                |
| Hosted     | Anthropic        | `https://api.anthropic.com/v1`                            |
| Aggregator | OpenRouter       | `https://openrouter.ai/api/v1`                            |
| Aggregator | Groq             | `https://api.groq.com/openai/v1`                          |
| Aggregator | Together AI      | `https://api.together.ai/v1`                              |
| Aggregator | Fireworks AI     | `https://api.fireworks.ai/inference/v1`                   |
| Aggregator | DeepInfra        | `https://api.deepinfra.com/v1/openai`                     |
| Aggregator | Cerebras         | `https://api.cerebras.ai/v1`                              |
| Local      | Ollama           | `http://localhost:11434/v1`                               |
| Local      | LM Studio        | `http://localhost:1234/v1`                                |
| Local      | llama.cpp server | `http://localhost:9931/v1`                                |
| Local      | vLLM             | `http://localhost:8000/v1`                                |
| Local      | LocalAI          | `http://localhost:8080/v1`                                |
| Local      | Jan              | `http://127.0.0.1:1337/v1`                                |

**Keys (US-125.3).** OpenAI, hosted services and aggregators need an API key;
local servers and Custom don't (`needs_key`), so an empty key is allowed for them
and refused for the others when a provider is saved or imported. An empty key is
stored as empty and reads back empty; a saved key reads back redacted, and
sending the redaction back keeps it, so clearing a key differs from keeping it.
A provider without a key sends no `Authorization` header: the OpenAI SDK needs a
key to build a client, so it gets a placeholder, and an `httpx` request hook
(`drop_placeholder_auth`) removes that header before chats, discovery and
captioning requests leave.

**Settings files** carry the service from format version 3 (see
[ADR-0052](0052-settings-export-format.md#addendum-format-version-3-us-1251)).

**Requests barely change.** Every service is called through the same Chat
Completions client and `/models` discovery as any `generic_openai` provider. The
one difference is a parameter a service refuses: `UNSUPPORTED_PARAMETERS` in
[`llm/capabilities.py`](../../apps/backend/asterism/domains/llm/capabilities.py),
keyed on the recorded service, removes it from that service's request
capabilities. Gemini refuses `seed` ("Unknown name "seed": Cannot find field"),
which Asterism otherwise sends with every request, so Gemini providers never
send one (2026-11-28). Other per-service behavior, such as OpenRouter's
attribution headers, is still out of scope.

## Consequences

- Choosing a service saves typing and mistakes, and lists can show which service
  a provider is.
- The catalog's URLs can go stale. They are checked against each service's
  documentation when the catalog changes, with the date in `CATALOG_CHECKED`, and
  a stored provider keeps its own URL either way.
- What the services' documentation said on 2026-11-28, for whoever adds
  per-service behavior:
  - Gemini calls its OpenAI compatibility beta. Mistral's OpenAI-compatible
    endpoint is in public preview; its native API at `https://api.mistral.ai/v1`
    is a different format.
  - xAI deprecates Chat Completions in favor of `/v1/responses`, with no removal
    date.
  - Anthropic describes its compatibility layer as mainly for testing and
    comparing models, not a long-term solution, and lists ignored or refused
    fields. Its model list is the native `/v1/models`, paged differently from
    OpenAI's.
  - Groq and Cerebras refuse `n` other than 1, and Groq refuses `logprobs` and
    `logit_bias`.
  - OpenRouter's optional attribution headers are `HTTP-Referer` and
    `X-OpenRouter-Title`.
  - llama.cpp's `llama-server` now listens on 9931 by default; its Docker
    examples still map 8080. Jan documents `127.0.0.1`, not `localhost`.
- Fireworks, Mistral, Anthropic and Jan don't document an OpenAI-style
  `/models` list on their compatibility endpoints; discovery may find nothing
  there, and models are then added by name.

## Alternatives considered

- **Presets only.** The form fills in a URL and saves a plain `generic_openai`
  provider. No migration, but nothing records the service, so lists can't show
  it and per-service behavior has no key.
- **A provider type per service.** The type decides URL pinning and request
  capabilities; a type per service would multiply both for services that all
  speak the same protocol.
