# Active and Pending Work

EPIC-24 and EPIC-25 were confirmed complete on 2026-10-14; their checklists are [archived](docs/archive/todo-completed-2026-10-14.md). US-29.1 was also confirmed complete and archived. US-29.2 was confirmed complete on 2026-10-15; its checklist is [archived](docs/archive/todo-completed-2026-10-15.md). US-29.3 and US-29.4 were confirmed complete on 2026-10-15 and are archived in the same file. US-26.1 was confirmed complete on 2026-10-15 and is archived there too. US-26.2, US-26.3, and US-26.4 were confirmed complete on 2026-10-16; their checklists are [archived](docs/archive/todo-completed-2026-10-16.md). EPIC-26 and EPIC-29 are complete. US-27.1 was confirmed complete on 2026-10-16 and is [archived](docs/archive/todo-completed-2026-10-16.md). US-27.2 was confirmed complete on 2026-10-16 and is [archived](docs/archive/todo-completed-2026-10-16.md). US-27.3 was confirmed complete on 2026-10-16 and is [archived](docs/archive/todo-completed-2026-10-16.md). Remaining stories are pending. See [roadmap and estimates](docs/plans/projects-and-chat-context-refactor.md). Implement only one story at a time; create its feature branch when implementation begins.

## [EPIC-27 — Project and chat workspace UI](docs/epics/EPIC-27-PROJECT-AND-CHAT-WORKSPACE-UI.md)

- [ ] US-27.4: Main-agent settings and sub-agent management.
  - [ ] US-27.4-T1: Replace multiple main-agent CRUD/default-selection UI with one main-agent settings form for instructions, ordinary capabilities, limits, and supported generation defaults; remove its model binding and agent selector.
  - [ ] US-27.4-T2: Provide sub-agent create/edit/delete/list UI with a required fixed-model selector, instructions, and allowed capabilities; support zero or many definitions with pagination and clear unavailable-model states.
  - [ ] US-27.4-T3: Consume generated settings/model/tool hooks using shadcn components; omit internal tools from selectable controls while preserving ordinary tool settings and admin configuration.
  - [ ] US-27.4-T4: Add component and Playwright tests for settings persistence, singleton UI, fixed-model sub-agent management, owner isolation, validation, and hidden internal tool controls.
- [ ] US-27.5: Chat model picker and project sub-agent selection.
  - [ ] US-27.5-T1: Replace chat agent selection with an available-model picker and visible active model/provider identity; persist selection across reopen and show the actual model used on historical assistant turns. Handle no available models, revoked selections, loading/error states, and model capability differences.
  - [ ] US-27.5-T2: Support draft/new chat model choice and next-turn switching without changing main-agent properties; disable switching during active runs, and make regeneration use the chosen model without relabeling earlier turns.
  - [ ] US-27.5-T3: Add select/deselect controls for owned sub-agents in project settings with empty initial selection, fixed-model labels, and deletion/revocation feedback. General offers no sub-agent selection or delegation; use atomic generated membership hooks.
  - [ ] US-27.5-T4: Test two-model chats, reopen/regenerate/provenance, unavailable models, main-agent settings retained across model changes, two projects with different selected sub-agents, deselection, and General non-delegation in component and isolated E2E coverage.

## [EPIC-28 — Clean-cut removal and validation](docs/epics/EPIC-28-CLEAN-CUT-REMOVAL-AND-VALIDATION.md)

- [ ] US-28.1: Remove folders and standalone knowledge bases (2–3 person-days).
  - [ ] US-28.1-T1: Delete folder and standalone knowledge-base models/routes/services, knowledge-base agent assignments, multiple-main-agent/default-agent selection contracts and UI, obsolete agent-bound chat model paths, manual internal-tool toggles, generated schemas, obsolete tests, and search triggers; retain model-bound sub-agent definitions and project selections.
  - [ ] US-28.1-T2: Remove old names from seeds, reset/initialization, harnesses, tool descriptions, and active docs; retain extraction and provider configuration.
  - [ ] US-28.1-T3: Regenerate OpenAPI clients and verify the supported schema includes the new project/chat/file/sub-agent memberships, singleton main-agent settings, and chat model selection; obsolete selectable main-agent and manual internal-tool contracts are absent.
  - [ ] US-28.1-T4: Run dependency/import checks and add a fresh-schema test proving obsolete tables and API paths are absent.
- [ ] US-28.2: Architecture and operator documentation (1–2 person-days).
  - [ ] US-28.2-T1: Update architecture diagrams, API/runtime/file lifecycle docs, backend/frontend READMEs, and contributor guidance, including AGENTS.md: exactly one main-agent configuration per user, separate persona/profile defaults, zero or more fixed-model sub-agent definitions, project-selected delegation, and internal context-managed tools.
  - [ ] US-28.2-T2: Document singleton main-agent settings, chat model selection/provenance, project-selected fixed-model sub-agents, internal tool policy, prompt composition, scope resolution, delegation, attachment branching, deletion, memory limits, and provider boundaries.
  - [ ] US-28.2-T3: Document a clean development reset for relational data, vectors, and source files without deleting verified provider model bundles.
  - [ ] US-28.2-T4: Update the ADR to accepted decisions and archive completed planning/status history after user confirmation.
- [ ] US-28.3: Integrated quality and isolation verification (2–3 person-days).
  - [ ] US-28.3-T1: Run backend and frontend lint, typecheck, unit/integration suites, frontend build, and generated-client consistency checks.
  - [ ] US-28.3-T2: Run isolated Playwright covering General upload/use/reopen, project prompt/files, moves, deletion, processing failures, two-user isolation, main-agent settings, chat model switching/provenance, project sub-agent selection/revocation, General non-delegation, and hidden internal tools.
  - [ ] US-28.3-T3: Test main/delegated agent file access and replay; measure bounded scope resolution/query behavior with representative file counts.
  - [ ] US-28.3-T4: Record each gate separately, including any unrun or retry-dependent check; update todo and archive before requesting completion confirmation.
  - [ ] US-28.3-T5: On user confirmation, merge the approved story branch and report epic closure.
