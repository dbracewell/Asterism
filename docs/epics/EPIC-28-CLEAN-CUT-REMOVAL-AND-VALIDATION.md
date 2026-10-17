# EPIC-28 — Clean-cut removal and validation

Status: In progress. US-28.1 confirmed complete on 2026-10-17; US-28.2 and US-28.3 remain pending.

Part of the [Projects and Chat Context Refactor](../plans/projects-and-chat-context-refactor.md). Product assumptions, module contracts, exclusions, and shared quality gates are defined there.

Estimated effort: **5–8 engineering person-days**, including story-level verification.

## User stories

### US-28.1 — Remove folders and standalone knowledge bases

As a developer, I want one coherent product model without compatibility code.

**Estimate:** 2–3 person-days. **Dependencies:** EPIC-27.

- [x] US-28.1-T1: Delete folder and standalone knowledge-base models/routes/services, knowledge-base agent assignments, multiple-main-agent/default-agent selection contracts and UI, obsolete agent-bound chat model paths, manual internal-tool toggles, generated schemas, obsolete tests, and search triggers; retain model-bound sub-agent definitions and project selections.
- [x] US-28.1-T2: Remove old names from seeds, reset/initialization, harnesses, tool descriptions, and active docs; retain extraction and provider configuration.
- [x] US-28.1-T3: Regenerate OpenAPI clients and verify the supported schema includes the new project/chat/file/sub-agent memberships, singleton main-agent settings, and chat model selection; obsolete selectable main-agent and manual internal-tool contracts are absent.
- [x] US-28.1-T4: Run dependency/import checks and add a fresh-schema test proving obsolete tables and API paths are absent.

**Acceptance:** No dual writes, aliases, fallback paths, migrations, or old knowledge-base assignment UI remain; historical archived epic documents may remain as history.

**Implementation and verification (2026-10-17):** Implemented on
`feat/us-28.1-remove-legacy-context`. User confirmed completion on 2026-10-17
and authorized archive, commit, and merge into `main`. The completed checklist is
[archived](../archive/todo-completed-2026-10-17.md).

Folder and standalone knowledge-base domains, UI routes, management components,
file membership filters/response fields, and generated contracts are removed.
Retained file-processing schemas and policy transitions now belong to
`domains/files/processing_schemas.py` and `domains/files/processing.py`. Extraction,
canonical captions, generation replacement/recovery, provider administration,
project/chat file references, model selection, and fixed-model sub-agent
management remain supported. The unused selectable-agent listing helper is removed;
the internal normalized agent configuration and chat main-configuration identity
remain runtime contracts. Internal tools remain context managed; admin policy
controls remain supported.

Fresh-schema tests initialize model tables and FTS indexes, assert obsolete tables
and triggers are absent, and verify project/chat memberships and search survive.
OpenAPI tests assert removed paths/schemas are absent, singleton main settings are
model-free, and sub-agents retain required model bindings. Removed routes return 404. Processing tests were retained in `test_file_processing.py`; only obsolete
collection tests and browser harnesses were removed. Active guides and the proxy
fixture now describe projects and live execution file scope. Broader documentation
consolidation and accepted ADR work remain US-28.2.

Verification:

- Backend suite: **429 passed**; includes fresh-schema, contract, removed-route,
  processing, ownership, and project/chat tests.
- Frontend: **129 tests across 34 files passed**, plus **6 auth-database tests**.
- Root configuration tests: **29 passed**.
- Root lint and formatting: **passed**, with no remaining lint warnings.
- Configured root typecheck (backend compileall and frontend TypeScript): **passed**.
- Backend static analysis of changed modules: **0 errors, 0 warnings**. Full
  basedpyright: **not passing**, with the same 10 diagnostics as the independently
  checked prior main baseline in unchanged `chat/controller.py`,
  `components/builtin/image_search.py`, and `components/builtin/web_search.py`.
- Dependency cycle check: **213 modules, 1008 imports; no cycles**.
- Production frontend build: **passed**; removed routes are absent from its route
  output. Initial TypeScript verification required clearing stale generated Next.js
  route types after route deletion; subsequent verification passed.
- Isolated Chromium Playwright: **26 passed**, with no test retries or unhandled
  errors. The runner exited 0; the backend's exit 143 is its intentional teardown.
- Client generation from served OpenAPI into a separate temporary directory:
  **identical after formatting**; served paths and schemas match the export.
- Real Next.js HTTP/header/WebSocket proxy verification: **passed**, including
  the project collection route.

The current database was retained. Fresh initialization and browser checks used
isolated disposable databases. No migration, compatibility shim, or fallback was
introduced. Historical planning and archive documents remain unchanged.

### US-28.2 — Architecture and operator documentation

As a contributor, I want a clear guide to extending the new modules.

**Estimate:** 1–2 person-days. **Dependencies:** US-28.1.

- [ ] US-28.2-T1: Update architecture diagrams, API/runtime/file lifecycle docs, backend/frontend READMEs, and contributor guidance, including AGENTS.md: exactly one main-agent configuration per user, separate persona/profile defaults, zero or more fixed-model sub-agent definitions, project-selected delegation, and internal context-managed tools.
- [ ] US-28.2-T2: Document singleton main-agent settings, chat model selection/provenance, project-selected fixed-model sub-agents, internal tool policy, prompt composition, scope resolution, delegation, attachment branching, deletion, memory limits, and provider boundaries.
- [ ] US-28.2-T3: Document a clean development reset for relational data, vectors, and source files without deleting verified provider model bundles.
- [ ] US-28.2-T4: Update the ADR to accepted decisions and archive completed planning/status history after user confirmation.

**Acceptance:** A contributor can trace project or chat context into Agent and RetrievalService without relying on removed folder or knowledge-base concepts.

### US-28.3 — Integrated quality and isolation verification

As a maintainer, I want the complete replacement validated from a clean install.

**Estimate:** 2–3 person-days. **Dependencies:** US-28.2.

- [ ] US-28.3-T1: Run backend and frontend lint, typecheck, unit/integration suites, frontend build, and generated-client consistency checks.
- [ ] US-28.3-T2: Run isolated Playwright covering General upload/use/reopen, project prompt/files, moves, deletion, processing failures, two-user isolation, main-agent settings, chat model switching/provenance, project sub-agent selection/revocation, General non-delegation, and hidden internal tools.
- [ ] US-28.3-T3: Test main/delegated agent file access and replay; measure bounded scope resolution/query behavior with representative file counts.
- [ ] US-28.3-T4: Record each gate separately, including any unrun or retry-dependent check; update todo and archive before requesting completion confirmation.
- [ ] US-28.3-T5: On user confirmation, merge the approved story branch and report epic closure.

**Acceptance:** Fresh initialization and required CI jobs pass; unauthorized files are rejected through every runtime access path; no unrun gate is reported as passing.

## Shared definition of done

Complete only one story at a time, on its own feature branch. Run relevant lint, type checks, unit/integration tests, generated-client checks, and E2E for changed workflows. Record unrun gates accurately. Update todo/documentation; obtain user completion confirmation before merge. This plan does not authorize resetting the current database during planning.
