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
Status: Complete — US-12.1–US-12.7 verified and user-confirmed.
Order: US-12.1 → US-12.2 → US-12.3 → US-12.4 → US-12.5 → US-12.6 → US-12.7.
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

- [x] US-12.3 — Use attached files in the agent runtime (vision + document text)
  - [x] US-12.3-T1: Extend `LLMMessage.content` to text/image content parts, update `to_api_message()`, add `text_content()` helper; prove text-only payloads unchanged.
  - [x] US-12.3-T2: Add `Message.files` references with migration and OpenAPI schemas; extend the WebSocket `chat` command with `files` and orchestrator validation.
  - [x] US-12.3-T3: Build multimodal agent messages: vision-gated image parts, document/text injection blocks, skip/unsupported notes; text-safe title generation and sub-agent context; populate `Agent.user_files`.
  - [x] US-12.3-T4: Tests for multimodal payload shape, tri-state vision gating, size caps, injection, history rebuild/regenerate, and WS filename validation/ownership.

- [x] US-12.4 — Attach files to chat messages in the frontend (verified and user-confirmed)
  - [x] US-12.4-T1: Wire `ChatInput` attachments to the generated upload client with per-file progress/error, `files` in the WebSocket payload, and safe clear-on-success.
  - [x] US-12.4-T2: Render persisted message attachments: image thumbnails, document badges with download, unsupported/failed and missing-file states.
  - [x] US-12.4-T3: Frontend unit/integration tests for upload states, WS payload, attachment rendering, and accessibility; verify generated client usage.

- [x] US-12.5 — Verify the file workflow end to end and document it
  - [x] US-12.5-T1: Backend integration scenario: upload image + PDF, send message, assert vision-capable vs non-vision model inputs and cache reuse.
  - [x] US-12.5-T2: Playwright E2E with mocked provider/file endpoints: attach + upload + send, rendered chips, streamed reply, upload-failure path.
  - [x] US-12.5-T3: Update architecture docs and add ADR-0012 (vision + MarkItDown routing, caching, limits, secure-by-default gating).
  - [x] US-12.5-T4: Run and record all quality gates, migration re-run checks, OpenAPI/client consistency, and Playwright coverage.

- [x] US-12.6 — Deduplicate identical uploads (user-confirmed)
  - [x] US-12.6-T1: Reuse an existing per-user file when sanitized filename and SHA-256 match; do not create a copy.
  - [x] US-12.6-T2: Tests for repeated/batched duplicates, collision behavior, and user isolation.
  - [x] US-12.6-T3: Document deduplication semantics and run relevant quality gates (`tests/test_user_files.py`, Ruff).

- [x] US-12.7 — User file manager (user-confirmed)
  - [x] US-12.7-T1: Add `/files` and a sidebar Files link below Search.
  - [x] US-12.7-T2: Render generated-client file list with download and delete actions.
  - [x] US-12.7-T3: Add list/icon views and name/kind sorting.
  - [x] US-12.7-T4: Add bounded backend pagination (page/page_size, max 100) with total metadata and frontend previous/next controls; backend tests and frontend typecheck pass.

### Epic closure

- [x] Re-verify all story acceptance criteria; user confirmed completion.
- [x] Merge the final story branch, announce epic completion, and propose the next plan.

## EPIC-13 — Main Agents and Chat Agent Selection

Plan: [EPIC-13](epics/EPIC-13-MAIN-AGENTS-AND-CHAT-AGENT-SELECTION.md).
Status: Completed — US-13.1 through US-13.3 verified, user-confirmed, and merged.
Order: US-13.1 → US-13.2 → US-13.3. Work on one item at a time; create a feature branch when each story starts. Story completion requires passing checks and user confirmation before merge.
Checklist convention: `[ ]` pending, `[~]` in progress, `[x]` completed, `[-]` canceled/not applicable.

- [x] US-13.1 — Separate agent settings and protect the default main agent (user-confirmed and merged)
  - [x] US-13.1-T1: Partition Agent Settings into accessible Main agents and Sub-agents sections with empty states and delegated-use copy.
  - [x] US-13.1-T2: Restrict and relabel the default control to main agents as the global default for new chats; require and lock the `sub_agent` tool for every main agent.
  - [x] US-13.1-T3: Validate default-agent updates server-side: owned main agent only; reject sub-agents, missing IDs, and malformed values; sanitize stale defaults on reads.
  - [x] US-13.1-T4: Prevent deleting/converting the default main agent such that no valid global default or main agent remains.
  - [x] US-13.1-T5: Add backend/frontend tests; regenerate typed client if needed.

- [x] US-13.2 — Bind a selected main agent to each chat session (user-confirmed and merged)
  - [x] US-13.2-T1: Add nullable `agent_id` chat storage, schemas, and repeatable data-preserving migration/backfill.
  - [x] US-13.2-T2: Resolve optional create-chat `agent_id` to the default main agent; reject sub-agent, missing, and cross-user IDs.
  - [x] US-13.2-T3: Run websocket chats with the stored agent, not the mutable default; handle unassigned legacy chats safely.
  - [x] US-13.2-T4: Protect main agents assigned to chats from unsafe delete/conversion.
  - [x] US-13.2-T5: Add service/router/migration tests and regenerate the Hey API client.

- [x] US-13.3 — Let users select the main agent when starting a chat (user-confirmed and merged)
  - [x] US-13.3-T1: Add an accessible main-agent selector to the new-chat composer, defaulted to the global default.
  - [x] US-13.3-T2: Send the selected ID through the generated create-chat client and display the selected chat agent where useful.
  - [x] US-13.3-T3: Handle no-main-agent, stale selection, and failure states explicitly.
  - [x] US-13.3-T4: Add frontend and Playwright coverage for default/override/exclusion/persistence behavior.
  - [x] US-13.3-T5: Run quality gates and document agent-selection and legacy-chat behavior.

### Epic closure

- [x] Re-verify all story acceptance criteria; user confirmed completion.
- [x] Merge the final story branch, announce epic completion, and propose the next plan.

## EPIC-15 — Chat Organization and Generation Control

Plan: [EPIC-15](epics/EPIC-15-CHAT-ORGANIZATION-AND-GENERATION-CONTROL.md).
Status: US-15.1, US-15.2, US-15.6, and US-15.3 completed and merged; US-15.4 in progress.
Order: US-15.1 → US-15.2 → US-15.6 → US-15.3 → US-15.4 → US-15.5. Work on one item at a time; create a feature branch when each story starts. Story completion requires passing checks and user confirmation before merge.
Checklist convention: `[ ]` pending, `[~]` in progress, `[x]` completed, `[-]` canceled/not applicable.

- [x] US-15.1 — Keep generation running in the background and allow explicit cancellation (user-confirmed and merged)
  - [x] US-15.1-T1: Introduce a per-chat background job manager that owns active orchestration independently of WebSocket controllers and prevents duplicate jobs.
  - [x] US-15.1-T2: Make WebSocket connections attach/detach from job state without cancelling it on disconnect; support reconnect during and after generation.
  - [x] US-15.1-T3: Add an authenticated `cancel` command and cancellation-safe orchestration, including model streams, tool tasks, and pending approvals.
  - [x] US-15.1-T4: Persist a terminal cancelled state and partial assistant output where available; ensure cancelled/pending work never restarts on reconnect.
  - [x] US-15.1-T5: Add accessible Stop-generating UI and live status handling without treating navigation as cancellation.
  - [x] US-15.1-T6: Add backend/frontend tests for disconnect continuation, reconnect, explicit cancellation, terminal persistence, and duplicate-job prevention.

- [x] US-15.2 — Find chats and folders with keyword search (user-confirmed and merged)
  - [x] US-15.2-T1: Add a user-scoped, paginated search API and SQLite FTS-backed indexes for folder titles, chat titles, and message content.
  - [x] US-15.2-T2: Return typed grouped results with match reason, safe snippet, chat/folder path, and stable ordering.
  - [x] US-15.2-T3: Add debounced accessible sidebar/global search UI using the generated client.
  - [x] US-15.2-T4: Test user isolation, escaping, pagination, title/content/folder matches, and empty/error states.
- [x] US-15.6 — Generate reliable chat titles (user-confirmed and merged)
  - [x] US-15.6-T1: Move title generation into the connection-independent chat job lifecycle and ensure it runs at most once per chat.
  - [x] US-15.6-T2: Replace the unbounded empty-title retry with bounded retries, timeouts, validation, and a deterministic fallback title.
  - [x] US-15.6-T3: Persist and publish the final title reliably; prevent background failures from leaving a title permanently null.
  - [x] US-15.6-T4: Add tests for disconnect continuation, empty/invalid provider output, provider failure, duplicate connections, title persistence, and search/sidebar updates.

- [x] US-15.3 — Select and safely delete chats from the sidebar (user-confirmed and merged)
  - [x] US-15.3-T1: Add sidebar selection mode, selected count, select-visible, and accessible keyboard controls.
  - [x] US-15.3-T2: Add atomic bulk deletion with strict ownership validation and coherent cache invalidation.
  - [x] US-15.3-T3: Require confirmation for single and bulk chat deletion; handle Escape/backdrop cancellation correctly.
  - [x] US-15.3-T4: Test confirmation, active-route navigation, partial failure, cache updates, and bulk ownership checks.
- [x] US-15.4 — Browse and start chats from a folder page (user-confirmed and merged)
  - [x] US-15.4-T1: Add an ownership-safe folder route and paginated direct-chat listing API.
  - [x] US-15.4-T2: Render session cards with title, updated time, agent, message count, and deterministic conversation preview.
  - [x] US-15.4-T3: Add a folder-scoped composer that starts a chat in that folder and routes to it.
  - [x] US-15.4-T4: Test pagination, empty states, ownership, navigation, and folder assignment.
- [x] US-15.5 — Show estimated chat context consumption
  - [x] US-15.5-T1: Expose selected-chat model context metadata through the generated API client.
  - [x] US-15.5-T2: Calculate input usage from the assembled model payload and reserved output budget; label estimates honestly.
  - [x] US-15.5-T3: Render accessible normal/warning/critical context meter states.
  - [x] US-15.5-T4: Test unknown model limits, multimodal/file/tool content, and threshold states.
  - [x] US-15.5-T5: Display tokens per second for each generated message using provider-reported output tokens and generation duration.

### Epic closure

- [x] Re-verify all story acceptance criteria; obtain user completion confirmation.
- [x] Merge the final story branch and announce epic completion.

## EPIC-16 — Memory Lifecycle and Resource Bounds

Plan: [EPIC-16](epics/EPIC-16-MEMORY-LIFECYCLE-AND-RESOURCE-BOUNDS.md).
Status: Completed — US-16.1–US-16.5 verified and user-confirmed.
Order: US-16.1 → US-16.2 → US-16.3 → US-16.4 → US-16.5. Work on one item at a time; create a feature branch when each story starts. Story completion requires passing checks and user confirmation before merge.
Checklist convention: `[ ]` pending, `[~]` in progress, `[x]` completed, `[-]` canceled/not applicable.

- [x] US-16.1 — Audit process-lifetime state and define resource contracts
  - [x] US-16.1-T1: Inventory backend/frontend application-owned globals, singleton registries, caches, maps, queues, timers, listeners, background tasks, and connection state; exclude generated/dependency internals unless Asterism controls keys or retention.
  - [x] US-16.1-T2: Record each resource's owner, key cardinality/source, retained graph, creation path, cleanup paths, bound/TTL, and eager versus lazy expiry.
  - [x] US-16.1-T3: Exercise completed/cancelled/deleted chats, reconnects, provider failure, WebSocket/SSE disconnect, event-handler failure, and high-cardinality model/IP input.
  - [x] US-16.1-T4: Publish the inventory and resource contracts in an ADR-style note; obtain approval for unresolved unbounded-path follow-up tasks.

- [x] US-16.2 — Give chat jobs and outbound queues an explicit lifecycle
  - [x] US-16.2-T1: Define `ChatJob` lifecycle/state for active generation, title task, pending approvals, controllers, idle state, cancellation, deletion, and shutdown.
  - [x] US-16.2-T2: Add race-safe job retirement APIs and controller attach/detach tracking; retire idle jobs only after the last controller disconnects.
  - [x] US-16.2-T3: Couple chat deletion to safe runtime retirement, cancellation, queue discard, and prevention of late writes/stale recreation.
  - [x] US-16.2-T4: Constrain or replace the per-chat message-queue cache with explicit cleanup, bounded fallback, and defined disconnected-client backpressure.
  - [x] US-16.2-T5: Add lifespan shutdown cleanup that cancels/awaits active jobs and releases queues safely.
  - [x] US-16.2-T6: Test completion, cancellation, reconnect, duplicate connections, deletion, queue bounds, expiry fallback, and shutdown cardinality.

- [x] US-16.3 — Bound backend caches and background event work
  - [x] US-16.3-T1: Apply a finite cache bound/invalidation policy to token encodings and test high-cardinality model names.
  - [x] US-16.3-T2: Review and correct `SlidingTTLCache` lazy-expiry/size-accounting behavior where needed.
  - [x] US-16.3-T3: Define bounded concurrency, ownership, error handling, and shutdown for backend event-dispatch tasks.
  - [x] US-16.3-T4: Review component singletons and user caches; add limits/invalidation/cleanup where evidence requires it.
  - [x] US-16.3-T4a: Replace the chat-ID-keyed logger cache with a bounded policy or stable logger plus structured correlation; test many unique chats.
  - [x] US-16.3-T5: Test cache eviction/expiry, task failure/cancellation/shutdown, and safe aggregate diagnostics.

- [x] US-16.4 — Bound frontend server SSE and request-lifecycle state
  - [x] US-16.4-T1: Verify idempotent SSE cleanup for abort, cancellation, enqueue failure, and initialization failure.
  - [x] US-16.4-T1a: Remove payload-bearing SSE POST logging and make shared cleanup reachable from start failure, abort, and cancel.
  - [x] US-16.4-T2: Bound server-global SSE listener population and define threshold behavior with safe diagnostics.
  - [x] US-16.4-T3: Verify/bound high-cardinality IP rate-limit storage and its expiry/cleanup scheduling.
  - [x] US-16.4-T3a: Cap normalized client-IP cardinality and use lifecycle-owned cleanup or a bounded on-access policy; test high-cardinality input.
  - [x] US-16.4-T4: Audit client timers, WebSocket hooks, subscriptions, and global event-bus handlers through navigation/reconnect cycles.
  - [x] US-16.4-T5: Add frontend unit/integration coverage and an isolated connection-churn harness where needed.

- [x] US-16.5 — Verify long-run bounds and document operations
  - [x] US-16.5-T1: Build deterministic churn scenarios for unique chats, users/model names, reconnects, cancellation/deletion, SSE clients, and event bursts.
  - [x] US-16.5-T2: Assert resource counters and task/listener cardinality plateau within documented bounds after cleanup/TTL windows.
  - [x] US-16.5-T3: Run focused/full quality gates and regenerate the Hey API client if the contract changes. Backend/frontend lint, typecheck, tests, migrations, and Playwright pass; no API contract changed.
  - [x] US-16.5-T4: Update architecture/operator documentation with ownership, bounds, eviction/overflow behavior, restart semantics, and safe diagnostics.

### Epic closure

- [x] Re-verify story acceptance criteria and request user completion confirmation.
- [x] On confirmation, merge final work, announce completion, and propose the next plan.

## EPIC-17 — Knowledge Bases and Multimodal Retrieval

Plan: [EPIC-17](epics/EPIC-17-KNOWLEDGE-BASES-AND-MULTIMODAL-RETRIEVAL.md).
Status: US-17.1 completed, user-confirmed, and merged.
Order: US-17.1 → US-17.2 → US-17.3 → US-17.4 → US-17.5. Work on one item at a time; create a feature branch when each story starts. Story completion requires passing checks and user confirmation before merge.
Checklist convention: `[ ]` pending, `[~]` in progress, `[x]` completed, `[-]` canceled/not applicable.

- [x] US-17.1 — Establish storage, embedding, and lifecycle foundations (user-confirmed and merged)
  - [x] US-17.1-T1: Define vector-store/embedding-provider protocols and configuration; implement LanceDB adapter lifecycle, owner/base filtering, and vector deletion.
  - [x] US-17.1-T2: Add pinned, local, quantized ONNX CLIP text/image embedding provider with artifact verification, bounded concurrency, and no remote code.
  - [x] US-17.1-T3: Benchmark supported macOS/Linux targets against fixed corpus; record size, latency, memory, relevance threshold, and ADR decision. macOS/Linux arm64 pass; x86_64/Intel remain release-environment preflight targets.
  - [x] US-17.1-T4: Add data-preserving relational migrations and vector schema/version rebuild plan.
  - [x] US-17.1-T5: Test adapters/providers, lifecycle, filters, deletion, bounds, and model artifact failures.

- [~] US-17.2 — Manage knowledge bases and documents
  - [x] US-17.2-T1: Add ownership-safe knowledge-base CRUD APIs.
  - [x] US-17.2-T2: Add document CRUD using immutable file revisions, metadata, and indexing status.
  - [x] US-17.2-T3: Implement bounded, idempotent extract/chunk/embed/index ingestion with retry/cancel/failure/reindex behavior.
  - [x] US-17.2-T4: Safely delete vectors, document references, assignments, and pending work.
  - [x] US-17.2-T5: Add safe audit events for CRUD and ingestion transitions.
  - [x] US-17.2-T6: Test ownership, mutations, ingestion/retry/deletion, migrations; regenerated Hey API client.

- [ ] US-17.3 — Assign knowledge bases to agents
  - [ ] US-17.3-T1: Add ownership-safe agent-to-knowledge-base associations.
  - [ ] US-17.3-T2: Add typed zero-or-more assignment APIs with validation.
  - [ ] US-17.3-T3: Include assignment summaries in agent APIs without metadata leakage.
  - [ ] US-17.3-T4: Test ownership, duplicate/delete races, empty/many/legacy assignments; regenerate Hey API client.

- [ ] US-17.4 — Expose safe automatic knowledge search to the agent runtime
  - [ ] US-17.4-T1: Implement bounded, assigned-base-filtered `search_knowledge` with provenance.
  - [ ] US-17.4-T2: Offer it only to eligible assigned agents and automatically authorize only this tool.
  - [ ] US-17.4-T3: Return bounded excerpts, stable scores, provenance, and safe no-result/failure responses.
  - [ ] US-17.4-T4: Add safe execution/audit traces.
  - [ ] US-17.4-T5: Test availability, authorization, filtering, stale bases, limits, and document injection content.

- [ ] US-17.5 — Build the knowledge-base and agent-assignment UI
  - [ ] US-17.5-T1: Add generated-client knowledge-base CRUD UI.
  - [ ] US-17.5-T2: Add accessible document upload/status/retry/delete management.
  - [ ] US-17.5-T3: Add zero-or-more agent assignment selector and automatic-search explanation.
  - [ ] US-17.5-T4: Add frontend and Playwright coverage.
  - [ ] US-17.5-T5: Run quality gates and document model/LanceDB operations and security boundaries.
