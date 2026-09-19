# Todo

Live execution checklist. Preserve completed history.

## EPIC-9 — Environment Configuration Hardening

Plan: [EPIC-9](epics/EPIC-9-ENVIRONMENT-CONFIGURATION-HARDENING.md).
Status: EPIC-9 completed; SP-9.1–SP-9.3 and US-9.1, US-9.2, US-9.4, and US-9.5 completed; US-9.3 canceled as not applicable.
Order: SP-9.1 → SP-9.2 → SP-9.3 → US-9.5 → US-9.1 → US-9.2 → US-9.4.
Work on one item at a time; create a feature branch when each story starts.
Story completion requires passing checks and user confirmation before merge.
Checklist convention: `[ ]` pending, `[~]` in progress, `[x]` completed, `[-]` canceled/not applicable.

- [x] SP-9.1 — Task-runner selection, loading strategy, and portable dotenv grammar
  - [x] SP-9.1-T1: Inventory configuration consumers and supported root, filtered, workspace, and direct-runtime entrypoints; mark unsupported raw commands explicitly.
  - [x] SP-9.1-T2: Prototype launcher versus framework-native loading with synthetic fixtures for precedence, missing files, working directories, spaces, quotes, `#`, `=`, `$`, empty values, CRLF, and multiline/interpolation handling.
  - [x] SP-9.1-T3: Investigate Next.js dotenv variants and choose a stale-file detection policy that prevents silent app-local overrides without deleting user files.
  - [x] SP-9.1-T4: Record the selected runner and loader, portable grammar/rejections, precedence, command matrix, migration cost, and alternatives in an ADR; obtain user approval before runner replacement and refine US-9.1 estimates. ADR-0009 accepted and revised after maintainer review: use mprocs for local full-stack development, pnpm workspaces for finite tasks, and remove Turbo in US-9.5.
  - [x] SP-9.1-T5: Compare Turbo plus root loading, pnpm-only plus root loading, and a hybrid dev path using synthetic fixtures; measure setup complexity, cache benefit, task ordering, filtered execution, secret scoping, exit handling, and shutdown of both apps.
  - [x] SP-9.1-T6: Prototype root loading before mprocs with separate app commands/working directories; verify restart inheritance, secret-free configuration, descendant cleanup, app-exit policy, and a non-interactive fallback; compare retaining versus removing Turbo for build/check tasks.

- [x] SP-9.2 — Validation, secret boundaries, and safe migration
  - [x] SP-9.2-T1: Build a variable catalog with consumer, required/default rules, secret/public classification, build/runtime use, and environment/file-secret precedence.
  - [x] SP-9.2-T2: Define redacted validation and diagnostics, including placeholder/empty secrets, URL rules, absolute writable local storage, DB overrides, and unit-test/build exceptions.
  - [x] SP-9.2-T3: Design migration for conflicting existing files without printing values, regenerating secrets, overwriting files, or changing database destinations; review reset/init safety and confirmation requirements.
  - [x] SP-9.2-T4: Record the validation and migration ADR, including browser-bundle leakage checks and concrete acceptance fixtures. ADR-0010 accepted.

- [x] SP-9.3 — pnpm, Docker, and CI configuration parity
  - [x] SP-9.3-T1: Validate pnpm workspace environment inheritance, selection, failure propagation, and non-interactive execution; define checks proving complete removal of Turbo-specific assumptions.
  - [x] SP-9.3-T2: Compare Compose interpolation, `docker run --env-file`, image build, and file-free runtime; document grammar differences and runtime-only public-origin behavior.
  - [x] SP-9.3-T3: Define hermetic unit/E2E fixtures and a CI matrix that cannot read developer `.env` files, contact configured production services, or modify developer databases.
  - [x] SP-9.3-T4: Record deployment/environment-execution decisions and smoke-test evidence or blockers in an ADR; refine US-9.4 test scope. ADR-0011 accepted; strict portable dotenv grammar requires prominent documentation.

- [x] US-9.5 — Remove unnecessary Turborepo orchestration
  - [x] US-9.5-T1: Replace root build, lint, typecheck, test, and local-CI Turbo invocations with explicit pnpm workspace commands; preserve workspace filtering and non-zero failure propagation without adding ordering or concurrency requirements.
  - [x] US-9.5-T2: Replace Dockerfile and GitHub Actions Turbo invocations, then verify frontend image build and both required CI status-check command paths.
  - [x] US-9.5-T3: Remove `turbo.json`, the Turbo dependency and lockfile entries, `.turbo` guidance/ignores where applicable, and all obsolete Turbo environment/cache configuration.
  - [x] US-9.5-T4: Update `AGENTS.md`, root/app READMEs, and command examples to describe pnpm workspaces and mprocs accurately; retain focused workspace commands.
  - [x] US-9.5-T5: Add or run regression checks proving every finite root task invokes both applicable workspaces, filtered tasks remain available, failures propagate, and no tracked command references Turbo.

- [x] US-9.1 — Configure and launch both apps from one root file
  - [x] US-9.1-T1: Implement the selected root-resolved loader and explicit inherited-environment precedence without shell evaluation.
  - [x] US-9.1-T2: Wire supported root/filtered/workspace dev, build/start, codegen, and maintenance entrypoints; remove backend/app-local implicit fallback and preserve subprocess exit codes/signals.
  - [x] US-9.1-T3: Implement non-destructive legacy dotenv detection and missing-file behavior; consolidate tracked examples into the root template.
  - [x] US-9.1-T4: Add parsing, precedence, command-directory, legacy-file, file-free, and signal/exit regression tests; prominently document the strict portable dotenv grammar with valid/invalid examples and explain why quotes, whitespace, `$`, escapes, interpolation, and inline comments are rejected.
  - [x] US-9.1-T5: Add a secret-free mprocs.yaml and root local-dev command using the shared loader; document installation/tested version, restart semantics, and the non-interactive fallback; test environment parity and process cleanup.

- [x] US-9.2 — Fail safely on invalid configuration without leaking secrets
  - [x] US-9.2-T1: Implement the agreed command-specific validation rules in backend and server-side frontend configuration, preserving stable variable names.
  - [x] US-9.2-T2: Add a documented configuration-check command that reports variable names and sources, never values, and performs no DB mutations.
  - [x] US-9.2-T3: Enforce server-only secret boundaries and agreed environment/file-secret precedence; prevent production startup with missing or known placeholder required secrets.
  - [x] US-9.2-T4: Add invalid-config, redaction, build/test-isolation, and client-bundle secret-canary tests; document the variable catalog.

- [-] US-9.3 — Migrate existing installations without data loss (not applicable: there are no existing installations)
  - [-] US-9.3-T1: Migration runbook not required.
  - [-] US-9.3-T2: Migration scope canceled; reset/init safety moved to US-9.4-T5.
  - [-] US-9.3-T3: Legacy-installation fixtures not required; reset cancellation coverage moved to US-9.4-T5.
  - [-] US-9.3-T4: Migration documentation not required; fresh-install/reset documentation moved to US-9.4-T6.

- [x] US-9.4 — Keep configuration deterministic across CI and containers
  - [x] US-9.4-T1: Verify pnpm workspace tasks inherit only the intended injected configuration, execute fresh, propagate failures, and contain no obsolete Turbo invocations.
  - [x] US-9.4-T2: Align Docker/Compose entrypoints and build/runtime validation with the contract, retain environment-only operation, and verify dotenv exclusion from build context/layers.
  - [x] US-9.4-T3: Add CI regressions for no-dotenv quality gates, isolated unit/E2E fixtures, root/filtered commands, special-character parity, and container auth/shared-key smoke tests.
  - [x] US-9.4-T4: Verify runtime `PUBLIC_URL` changes without image rebuild and secret-canary absence from client artifacts/logs/layers; document deployment limitations and run all relevant quality gates.
  - [x] US-9.4-T5: Harden reset/init scripts to validate configuration before selecting targets, remove developer-specific paths and shell sourcing, use the pinned auth CLI, require explicit destructive confirmation, and test cancellation with disposable data.
  - [x] US-9.4-T6: Document the tested fresh-install, initialization, and destructive-reset workflows without legacy-installation migration guidance.

### Epic closure

- [x] Verify all spike exits and story acceptance criteria; request user completion confirmation.
- [x] On confirmation, complete approved merges, announce epic completion, and propose the next plan.

## EPIC-10 — Sub-Agent Upgrade and Tool Approval Refactor

Plan: [EPIC-10](epics/EPIC-10-SUB-AGENT-AND-TOOL-APPROVAL-REFACTOR.md).
Status: EPIC-10 completed; US-10.1–US-10.7 completed and verified.
Order: US-10.1 → US-10.2 → US-10.3 → US-10.4 → US-10.5 → US-10.6 → US-10.7.
Work on one item at a time; create a feature branch when each story starts.
Story completion requires passing checks and user confirmation before merge.
Checklist convention: `[ ]` pending, `[~]` in progress, `[x]` completed, `[-]` canceled/not applicable.

- [x] US-10.1 — Extract tool approval into a pluggable policy
  - [x] US-10.1-T1: Define `ToolApprovalPolicy` protocol.
  - [x] US-10.1-T2: Implement `AllowlistApprovalPolicy`.
  - [x] US-10.1-T3: Implement `InteractiveApprovalPolicy`.
  - [x] US-10.1-T4: Refactor `Agent.__init__` to accept optional `approval_policy`.
  - [x] US-10.1-T5: Refactor `Agent.run()` to use `self.approval_policy.authorize(...)`.
  - [x] US-10.1-T6: Migrate `ChatOrchestrator` to construct `Agent` with `InteractiveApprovalPolicy`.
  - [x] US-10.1-T7: Simplify or remove `UserResponseQueue`.
  - [x] US-10.1-T8: Add unit tests for both policies and `Agent.run()` with each.

- [x] US-10.2 — Fix sub-agent tool authorization to respect permissions (parent-intersection detail superseded by US-10.7-T7)
  - [x] US-10.2-T1: Construct sub-agent with `AllowlistApprovalPolicy` using intersection of parent and sub-agent permissions.
  - [x] US-10.2-T2: Remove manual auto-approve loop from `sub_agent.py`.
  - [x] US-10.2-T3: Test sub-agent cannot use tools outside its profile allowlist.
  - [x] US-10.2-T4: Test sub-agent cannot use tools outside parent allowlist.

- [x] US-10.3 — Add recursion safety to sub-agent execution
  - [x] US-10.3-T1: Add `call_stack` tracking to `ToolContext` or `SubAgentContext`.
  - [x] US-10.3-T2: Check for cycles and depth limit before creating child agent.
  - [x] US-10.3-T3: Return clear error on cycle detection.
  - [x] US-10.3-T4: Return clear error on depth exceeded.
  - [x] US-10.3-T5: Unit tests for no-recursion, allowed depth, cycle, and depth exceeded.

- [x] US-10.4 — Stream sub-agent events to the parent context
  - [x] US-10.4-T1: Define sub-agent event envelope with metadata.
  - [x] US-10.4-T2: Add optional `event_sink` to sub-agent tool context.
  - [x] US-10.4-T3: Forward `DELTA`, `THINKING`, `TOOL_CALL`, `COMPLETE` events through sink.
  - [x] US-10.4-T4: Handle sub-agent envelope events in `ChatOrchestrator`.
  - [x] US-10.4-T5: Tests for event forwarding with correct metadata.

- [x] US-10.5 — Forward context to sub-agents
  - [x] US-10.5-T1: Add optional `parent_context` with conversation summary and file refs.
  - [x] US-10.5-T2: Prepend context block to sub-agent message list.
  - [x] US-10.5-T3: Implement configurable context window (last N messages / M tokens).
  - [x] US-10.5-T4: Forward `user_files` from parent `ToolContext`.
  - [x] US-10.5-T5: Tests for context forwarding and file accessibility.

- [x] US-10.6 — Persist sub-agent execution traces
  - [x] US-10.6-T1: Design storage schema for sub-agent traces.
  - [x] US-10.6-T2: Persist full sub-agent message history after completion.
  - [x] US-10.6-T3: Include token usage, step count, elapsed time in trace.
  - [x] US-10.6-T4: Add query/retrieval interface for traces by parent message ID.
  - [x] US-10.6-T5: Tests for trace persistence, retrieval, and parent association.

- [x] US-10.7 — Make delegated execution visible and verify it end to end
  - [x] US-10.7-T1: Exercise and inspect the complete browser → WebSocket → parent agent → sub-agent → parent response path; fix dropped events, missing results, hangs, or misleading completion behavior.
  - [x] US-10.7-T2: Add an accessible live sub-agent UI covering lifecycle, text/thinking progress, tool calls, completion, and errors.
  - [x] US-10.7-T3: Add structured Python delegation logs with lifecycle, timing, event, and correlation data while excluding sensitive content.
  - [x] US-10.7-T4: Add frontend unit/integration coverage for sub-agent WebSocket state and rendering, including nested and terminal states.
  - [x] US-10.7-T5: Add Playwright delegation success and failure/timeout scenarios proving child progress and the final parent response.
  - [x] US-10.7-T6: Run focused/full quality gates and document the verified event flow, diagnostics, and external-provider limitations.
  - [x] US-10.7-T7: Use the active child profile allowlist instead of the parent/child intersection, warn that sub-agent tools run without approval, and add regression coverage (supersedes the US-10.2 intersection rule by user decision).

### Epic closure

- [x] Re-verify all story acceptance criteria; user confirmed completion.
- [x] Merge the US-10.7 branch, announce epic completion, and propose the next plan.

## EPIC-11 — LLM Provider Types and Model Capabilities

Plan: [EPIC-11](epics/EPIC-11-LLM-PROVIDER-TYPES-AND-MODEL-CAPABILITIES.md).
Status: EPIC-11 completed; US-11.1–US-11.4 completed, verified, and user-confirmed.
Order: US-11.1 → US-11.2 → US-11.3 → US-11.4.
Work on one item at a time; create a feature branch when each story starts.
Story completion requires passing checks and user confirmation before merge.
Checklist convention: `[ ]` pending, `[~]` in progress, `[x]` completed, `[-]` canceled/not applicable.

- [x] US-11.1 — Persist provider types and model capability metadata (completed, verified, and user-confirmed)
  - [x] US-11.1-T1: Add the provider enum, canonical OpenAI URL policy, and backend normalization.
  - [x] US-11.1-T2: Extend persistence and API schemas with provider type, context window, tri-state vision, and per-field provenance.
  - [x] US-11.1-T3: Add a repeatable data-preserving migration that classifies existing providers and preserves references.
  - [x] US-11.1-T4: Update provider/model upsert, merge, and read services for the new metadata.
  - [x] US-11.1-T5: Test fresh/existing/repeated migrations, validation, round trips, and reference preservation.
  - [x] US-11.1-T6: Regenerate and verify the Hey API client.

- [x] US-11.2 — Discover models and capabilities through the backend (completed, verified, and user-confirmed)
  - [x] US-11.2-T1: Define an admin-only typed discovery API and backend discovery interface.
  - [x] US-11.2-T2: Implement canonical OpenAI discovery with a versioned capability catalog.
  - [x] US-11.2-T3: Implement conservative Generic OpenAI model and capability extraction.
  - [x] US-11.2-T4: Add bounded I/O, redirect/credential protections, and redacted diagnostics.
  - [x] US-11.2-T5: Preserve IDs, active/default state, and manual per-field overrides during refresh.
  - [x] US-11.2-T6: Test catalogs, generic metadata shapes, unknown/conflicting data, failures, and refresh preservation.

- [x] US-11.3 — Configure provider type and capabilities in the admin UI (completed, verified, and user-confirmed)
  - [x] US-11.3-T1: Add an accessible OpenAI / Generic OpenAI provider-type dropdown.
  - [x] US-11.3-T2: Implement fixed OpenAI and required editable Generic OpenAI base URL behavior.
  - [x] US-11.3-T3: Replace direct frontend model fetching with the generated backend discovery client.
  - [x] US-11.3-T4: Add editable context-window and tri-state vision fields with source/unknown indicators.
  - [x] US-11.3-T5: Preserve active/default/manual values through refresh and type changes.
  - [x] US-11.3-T6: Test type switching, discovery states, manual fallback, refresh, validation, and accessibility.

- [x] US-11.4 — Verify the provider workflow end to end (completed, verified, and user-confirmed)
  - [x] US-11.4-T1: Integrate provider creation, discovery, manual fallback, save/reload, and default retention.
  - [x] US-11.4-T2: Verify runtime clients and chat/draft lookup use the correct normalized URL and active models.
  - [x] US-11.4-T3: Add deterministic browser E2E coverage for both provider types and discovery failure.
  - [x] US-11.4-T4: Document provider types, provenance, discovery limitations, and manual fallback.
  - [x] US-11.4-T5: Run and record all quality gates, migration checks, codegen consistency, and relevant Playwright coverage.

### Epic closure

- [x] Re-verify all story acceptance criteria; user confirmed completion.
- [x] Merge the final story branch, announce epic completion, and propose the next plan.

## EPIC-12 — User Files in Chat (Upload, Vision, and MarkItDown)

Plan: [EPIC-12](epics/EPIC-12-USER-FILES-IN-CHAT.md).
Status: US-12.1–US-12.2 completed, verified, and user-confirmed; US-12.3–US-12.5 pending.
Order: US-12.1 → US-12.2 → US-12.3 → US-12.4 → US-12.5.
Work on one item at a time; create a feature branch when each story starts.
Story completion requires passing checks and user confirmation before merge.
Checklist convention: `[ ]` pending, `[~]` in progress, `[x]` completed, `[-]` canceled/not applicable.

- [x] US-12.1 — Upload, list, and delete user files
  - [x] US-12.1-T1: Introduce the `FileStore` protocol and `LocalFileStore`; refactor the existing files service onto it without changing `GET /files/{filename}` behavior.
  - [x] US-12.1-T2: Add the `user_files` model, Pydantic/OpenAPI schemas, and a repeatable data-preserving migration.
  - [x] US-12.1-T3: Implement `POST /files` multipart upload with size cap, extension denylist, filename sanitization, dedupe, MIME sniffing, kind classification, and `sha256` hashing.
  - [x] US-12.1-T4: Implement `GET /files` list and `DELETE /files/{filename}` with strict user scoping.
  - [x] US-12.1-T5: Tests for auth/ownership, traversal/sanitization, limits, dedupe, MIME/kind detection, delete, migration idempotency; regenerate the Hey API client.

- [x] US-12.2 — Convert files to model-readable text with MarkItDown
  - [x] US-12.2-T1: Add pinned `markitdown[docx,pdf,pptx,xls,xlsx]` and isolate conversion behind a `FileProcessor` interface with kind routing.
  - [x] US-12.2-T2: Implement direct text reading and MarkItDown conversion in a worker thread with timeout, input size cap, and output truncation.
  - [x] US-12.2-T3: Persist processing status/cache on `user_files` with hash invalidation and per-file non-fatal user-safe errors.
  - [x] US-12.2-T4: Fixture tests with real sample files plus timeout/oversize/corrupt/truncation/cache cases; assert content never appears in logs.

- [ ] US-12.3 — Use attached files in the agent runtime (vision + document text)
  - [ ] US-12.3-T1: Extend `LLMMessage.content` to text/image content parts, update `to_api_message()`, add `text_content()` helper; prove text-only payloads unchanged.
  - [ ] US-12.3-T2: Add `Message.files` references with migration and OpenAPI schemas; extend the WebSocket `chat` command with `files` and orchestrator validation.
  - [ ] US-12.3-T3: Build multimodal agent messages: vision-gated image parts, document/text injection blocks, skip/unsupported notes; text-safe title generation and sub-agent context; populate `Agent.user_files`.
  - [ ] US-12.3-T4: Tests for multimodal payload shape, tri-state vision gating, size caps, injection, history rebuild/regenerate, and WS filename validation/ownership.

- [ ] US-12.4 — Attach files to chat messages in the frontend
  - [ ] US-12.4-T1: Wire `ChatInput` attachments to the generated upload client with per-file progress/error, `files` in the WebSocket payload, and safe clear-on-success.
  - [ ] US-12.4-T2: Render persisted message attachments: image thumbnails, document badges with download, unsupported/failed and missing-file states.
  - [ ] US-12.4-T3: Frontend unit/integration tests for upload states, WS payload, attachment rendering, and accessibility; verify generated client usage.

- [ ] US-12.5 — Verify the file workflow end to end and document it
  - [ ] US-12.5-T1: Backend integration scenario: upload image + PDF, send message, assert vision-capable vs non-vision model inputs and cache reuse.
  - [ ] US-12.5-T2: Playwright E2E with mocked provider/file endpoints: attach + upload + send, rendered chips, streamed reply, upload-failure path.
  - [ ] US-12.5-T3: Update architecture docs and add ADR-0012 (vision + MarkItDown routing, caching, limits, secure-by-default gating).
  - [ ] US-12.5-T4: Run and record all quality gates, migration re-run checks, OpenAPI/client consistency, and Playwright coverage.

### Epic closure

- [ ] Re-verify all story acceptance criteria; user confirms completion.
- [ ] Merge the final story branch, announce epic completion, and propose the next plan.
