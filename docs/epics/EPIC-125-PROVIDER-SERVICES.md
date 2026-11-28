# EPIC-125: Choose a provider by service

Status: complete (2026-11-28). Source: user request (2026-11-28).

## Objective

An administrator adds a provider by choosing its service (Google Gemini,
OpenRouter, Ollama and so on) from one dropdown, and Asterism fills in the
service's current base URL. The provider remembers which service it is.

Today an administrator picks OpenAI or "Generic OpenAI" and types the base URL
of any other service by hand. Every OpenAI-compatible service already works
through `generic_openai`; what is missing is knowing their URLs, a record of
which service a provider is, and keyless local servers: Asterism requires an API
key even for servers that ignore it.

## Decisions (2026-11-28)

- A provider records its service in a new nullable `providers.service` column.
  It is set only on `generic_openai` providers; existing ones read as Custom.
  The provider type and its request behavior don't change.
- The service list lives on the backend, which validates `service` and serves
  the list to the frontend. Each entry has an id, a label, a group (hosted,
  aggregator, local), a default base URL and whether it needs a key.
- The first list: OpenAI (as today); hosted APIs: Google Gemini, Mistral, xAI,
  DeepSeek and Anthropic's OpenAI-compatible endpoint; aggregators: OpenRouter,
  Groq, Together AI, Fireworks, DeepInfra and Cerebras; local servers: Ollama,
  LM Studio, llama.cpp server, vLLM, LocalAI and Jan; and Custom, any other URL.
- The API key is optional for local servers and Custom, required for hosted
  services and aggregators.
- Per-service request changes (such as OpenRouter's attribution headers) are
  out of scope; the recorded service is where they would go later.

## Stories

### US-125.1: A service catalog, recorded on each provider

As an administrator, I want each provider to know which service it is.

- [x] An ADR records the decisions above: the column, the catalog and its
      fields, and which services need a key.
- [x] The catalog lists each service with its base URL, each checked against
      the service's current documentation (with the date checked).
- [x] A versioned migration adds `providers.service`, with a test that upgrades
      a database seeded at the previous revision; existing providers read as
      Custom.
- [x] Provider reads and writes carry `service`; an unknown service, or one on
      a non-`generic_openai` provider, is refused with a clear message.
- [x] An endpoint returns the catalog; the settings export and import carry
      `service`.
- [x] Tests, regenerated client, and release note (Data).

### US-125.2: The service dropdown

As an administrator, I want to pick the service and have its URL filled in.

- [x] Admin Settings → Providers and the setup step use one service dropdown,
      grouped as OpenAI, hosted, aggregators, local servers and Custom.
- [x] Choosing a service fills in its name and base URL; switching services
      replaces only a name or URL that is empty or still the previous
      service's default, so the administrator's edits are kept.
- [x] A saved provider reopens on its service; the provider list shows the
      service's name.
- [x] Local servers explain that, when Asterism runs in Docker, `localhost` is
      the container, and suggest `host.docker.internal`.
- [x] Unit and E2E tests, and release note (Behavior).

### US-125.3: Local servers without an API key

As an administrator, I want to connect a local server without inventing a key.

- [x] The API key is optional for local servers and Custom, and required for
      hosted services and aggregators, in the form and on the server.
- [x] A provider without a key sends no `Authorization` header, for chats and
      for model discovery.
- [x] A saved key stays redacted; clearing it is distinct from keeping it.
- [x] Tests, and release note (Behavior).
