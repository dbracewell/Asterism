# Completed checklist: 2026-11-28

## Test tooling

EPIC-124 is complete: every story was confirmed and merged on 2026-11-28 through pull requests #200 (US-124.1) and #201 (US-124.2). Development, CI and the image run Node 22.23.5, and the frontend unit tests run on Vitest 5.1.1, jsdom 31.0.1 and jest-dom 8.0.0. Dependabot pull requests #41 and #190 were closed in favor of #201.

### [EPIC-124: Vitest 5 and its test libraries](../epics/EPIC-124-VITEST-5.md)

- [x] US-124.1: Node 22.23 for development and CI
  - [x] `.node-version` moves to the newest Node 22 release at least a week old, and the Dockerfile's Node 22 base image is refreshed to match.
  - [x] CI, the image check and the E2E suite pass on it.
  - [x] Release note (Image), and the development guide names the version.
- [x] US-124.2: Vitest 5, jsdom 31 and jest-dom 8
  - [x] Vitest 5, jsdom 31, jest-dom 8 and `@testing-library/dom` are updated together, following Vitest 5's migration guide for the config and setup file.
  - [x] Every unit test passes unchanged, or with a change the migration guide calls for.
  - [x] Dependabot pull requests #41 and #190 are closed in favor of this one.

## Provider services

EPIC-125 is complete: every story was confirmed and merged on 2026-11-28 through pull requests #204 (US-125.1), #205 (US-125.2) and #206 (US-125.3). A provider is chosen by service from one dropdown that fills in its current base URL, from a backend catalog of 17 hosted APIs, aggregators and local servers checked against each service's documentation (ADR-0086). Each OpenAI-compatible provider records its service, and local servers and custom URLs work without an API key.

### [EPIC-125: Choose a provider by service](../epics/EPIC-125-PROVIDER-SERVICES.md)

- [x] US-125.1: A service catalog, recorded on each provider
  - [x] An ADR records the decisions: the column, the catalog and its fields, and which services need a key.
  - [x] The catalog lists each service with its base URL, each checked against the service's current documentation (with the date checked).
  - [x] A versioned migration adds `providers.service`, with a test that upgrades a database seeded at the previous revision; existing providers read as Custom.
  - [x] Provider reads and writes carry `service`; an unknown service, or one on a non-`generic_openai` provider, is refused with a clear message.
  - [x] An endpoint returns the catalog; the settings export and import carry `service`.
  - [x] Tests, regenerated client, and release note (Data).
- [x] US-125.2: The service dropdown
  - [x] Admin Settings → Providers and the setup step use one service dropdown, grouped as OpenAI, hosted, aggregators, local servers and Custom.
  - [x] Choosing a service fills in its name and base URL; switching services replaces only a name or URL that is empty or still the previous service's default.
  - [x] A saved provider reopens on its service; the provider list shows the service's name.
  - [x] Local servers explain that, when Asterism runs in Docker, `localhost` is the container, and suggest `host.docker.internal`.
  - [x] Unit and E2E tests, and release note (Behavior).
- [x] US-125.3: Local servers without an API key
  - [x] The API key is optional for local servers and Custom, and required for hosted services and aggregators, in the form and on the server.
  - [x] A provider without a key sends no `Authorization` header, for chats and for model discovery.
  - [x] A saved key stays redacted; clearing it is distinct from keeping it.
  - [x] Tests, and release note (Behavior).
