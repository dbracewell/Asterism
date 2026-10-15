# Active and Pending Work

EPIC-24 and EPIC-25 were confirmed complete on 2026-10-14; their checklists are [archived](docs/archive/todo-completed-2026-10-14.md). US-29.1 was also confirmed complete and archived. US-29.2 was confirmed complete on 2026-10-15; its checklist is [archived](docs/archive/todo-completed-2026-10-15.md). US-29.3 and US-29.4 were confirmed complete on 2026-10-15 and are archived in the same file. EPIC-29 is complete. Remaining stories are pending. See [roadmap and estimates](docs/plans/projects-and-chat-context-refactor.md). Implement only one story at a time; create its feature branch when implementation begins.

## [EPIC-26 — Composable execution context](docs/epics/EPIC-26-COMPOSABLE-EXECUTION-CONTEXT.md)

- [ ] US-26.1: Execution scope resolver (2–3 person-days).
  - [ ] US-26.1-T1: Implement a server-derived context with user/profile/main-agent-or-sub-agent/chat/project IDs, selected and executed model identity, eligible project sub-agent IDs, effective internal tools, active branch, configuration/prompt revision, allowed file IDs, and file provenance.
  - [ ] US-26.1-T2: Inject small project and chat scope readers into the resolver rather than letting Agent query domain tables.
  - [ ] US-26.1-T3: Resolve scope at turn start and recheck authorization before each file/retrieval tool call; reject canceled or revoked execution contexts. Connect project deletion to cancellation of affected active runs before deleting project context, once runtime integration exists.
  - [ ] US-26.1-T4: Pass narrowed context to delegated agents and background/restarted jobs without granting new tools or wider files.
  - [ ] US-26.1-T5: Test empty scope, cross-user IDs, same-agent different-chat isolation, delegation, and revocation races.
- [ ] US-26.2: Composable project prompts (2–3 person-days).
  - [ ] US-26.2-T1: Extract a PromptComposer from Agent._build_system_prompt with typed layers and explicit conflict rules.
  - [ ] US-26.2-T2: Compose platform rules, agent role/capabilities, profile instructions where supported, project task instructions, and bounded runtime context.
  - [ ] US-26.2-T3: Use the same composed prompt for token estimates, main-agent calls, delegated calls, and turn replay; never treat file text as system instructions.
  - [ ] US-26.2-T4: Snapshot prompt revision per turn; apply edits to later turns and persist source/revision provenance rather than logging full private prompts.
  - [ ] US-26.2-T5: Test precedence, empty project prompt, edits, chat model switching, main-agent settings edits, delegation, and context-budget accounting.
- [ ] US-26.3: Shared retrieval and file-tool authorization (2–3 person-days).
  - [ ] US-26.3-T1: Move search logic from the built-in tool into an injected RetrievalService using the resolved scope and existing extraction/vector interfaces.
  - [ ] US-26.3-T2: Replace agent knowledge-base assignments with contextual access; derive contextual retrieval as an internal tool through US-29.4 policy, rather than a user-selectable agent toggle or assignment.
  - [ ] US-26.3-T3: Apply owner and allowed-file filters before vector search and equivalent checks to every file reading/summarization/image path.
  - [ ] US-26.3-T4: Preserve current-generation readiness, result limits, captions, image routing, citations, and scope provenance.
  - [ ] US-26.3-T5: Test empty scope fails closed, foreign and unrelated files, unavailable embeddings, replacement generations, and stale authorization.
- [ ] US-26.4: Context provenance and memory isolation (2–3 person-days).
  - [ ] US-26.4-T1: Add project/chat/scope-revision, main/sub-agent configuration, selected target set, and actual model/provider provenance to execution and retrieval traces without logging file bodies or full prompts.
  - [ ] US-26.4-T2: Audit any existing summary, cache, memory, and resume paths for cross-chat reuse; key derived context by its source scope.
  - [ ] US-26.4-T3: For any active long-term memory path, scope project-derived writes/reads by project and General-chat-derived writes/reads by chat; do not add a new memory engine.
  - [ ] US-26.4-T4: If no long-term memory integration exists, define the typed boundary and tests for future integration without building project-wide conversational memory.
  - [ ] US-26.4-T5: Test reuse of one agent/profile across projects, moves, restart, and removal; document that existing historical messages cannot be unlearned.

## [EPIC-27 — Project and chat workspace UI](docs/epics/EPIC-27-PROJECT-AND-CHAT-WORKSPACE-UI.md)

- [ ] US-27.1: Project navigation and settings (2–3 person-days).
  - [ ] US-27.1-T1: Replace folder navigation with Projects and General; add project CRUD, paginated lists/search, and project overview/settings routes.
  - [ ] US-27.1-T2: Add name, description, and system-prompt forms using existing shadcn components and generated TanStack Query hooks.
  - [ ] US-27.1-T3: Create chats in the selected project; show project identity in chat and provide moves with a clear history-transfer explanation.
  - [ ] US-27.1-T4: Handle empty/loading/error states and deletion confirmation describing chat detachment.
  - [ ] US-27.1-T5: Add component tests and focused Playwright coverage for navigation, edits, moves, and deletion.
- [ ] US-27.2: Composable project file explorer (2–3 person-days).
  - [ ] US-27.2-T1: Reuse file-manager list, selection, upload, and picker components through explicit data sources and permitted actions.
  - [ ] US-27.2-T2: Add project file upload/add/remove, processing state, regenerate, and file view links; reuse the atomic membership API.
  - [ ] US-27.2-T3: Replace knowledge-base badges/detail links with project memberships and accurate deletion impact.
  - [ ] US-27.2-T4: Keep remove-from-project distinct from physical file deletion; use generated hooks and the global mutation invalidation policy.
  - [ ] US-27.2-T5: Test shared files, picker exclusions, unavailable artifacts, removal versus deletion, and project-local filtering.
- [ ] US-27.3: Visible chat attachment scope (2–3 person-days).
  - [ ] US-27.3-T1: Expose project files separately from chat attachments in the composer and chat context display.
  - [ ] US-27.3-T2: Integrate draft uploads, explicit library picks, ready/pending/failed states, removal, and retry.
  - [ ] US-27.3-T3: Show source provenance on retrieval citations and provide explicit add-to-project rather than automatic promotion.
  - [ ] US-27.3-T4: Handle reopened chats, model changes, branches, and context estimates consistently.
  - [ ] US-27.3-T5: Add component and E2E tests for General-chat isolation and two project chats with different local attachments.

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
