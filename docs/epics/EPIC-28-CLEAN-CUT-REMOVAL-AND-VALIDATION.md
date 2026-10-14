# EPIC-28 — Clean-cut removal and validation

Status: Proposed / not started.

Part of the [Projects and Chat Context Refactor](../plans/projects-and-chat-context-refactor.md). Product assumptions, module contracts, exclusions, and shared quality gates are defined there.

Estimated effort: **5–8 engineering person-days**, including story-level verification.

## User stories
### US-28.1 — Remove folders and standalone knowledge bases

As a developer, I want one coherent product model without compatibility code.

**Estimate:** 2–3 person-days. **Dependencies:** EPIC-27.
- [ ] US-28.1-T1: Delete folder and standalone knowledge-base models/routes/services, knowledge-base agent assignments, multiple-main-agent/default-agent selection contracts and UI, obsolete agent-bound chat model paths, manual internal-tool toggles, generated schemas, obsolete tests, and search triggers; retain model-bound sub-agent definitions and project selections.
- [ ] US-28.1-T2: Remove old names from seeds, reset/initialization, harnesses, tool descriptions, and active docs; retain extraction and provider configuration.
- [ ] US-28.1-T3: Regenerate OpenAPI clients and verify the supported schema includes the new project/chat/file/sub-agent memberships, singleton main-agent settings, and chat model selection; obsolete selectable main-agent and manual internal-tool contracts are absent.
- [ ] US-28.1-T4: Run dependency/import checks and add a fresh-schema test proving obsolete tables and API paths are absent.

**Acceptance:** No dual writes, aliases, fallback paths, migrations, or old knowledge-base assignment UI remain; historical archived epic documents may remain as history.

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
