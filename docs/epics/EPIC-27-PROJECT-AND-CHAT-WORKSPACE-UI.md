# EPIC-27 — Project and chat workspace UI

Status: In progress. US-27.1 was confirmed complete on 2026-10-16; US-27.2 is next. Later stories remain pending.

Part of the [Projects and Chat Context Refactor](../plans/projects-and-chat-context-refactor.md). Product assumptions, module contracts, exclusions, and shared quality gates are defined there.

Estimated effort: **10–15 engineering person-days**, including story-level verification.

## User stories

### US-27.1 — Project navigation and settings

As a user, I want a clear project workspace with name, description, and instructions.

**Estimate:** 2–3 person-days. **Dependencies:** EPIC-25 and US-26.2.

- [x] US-27.1-T1: Replace folder navigation with Projects and General; add project CRUD, paginated lists/search, and project overview/settings routes.
- [x] US-27.1-T2: Add name, description, and system-prompt forms using existing shadcn components and generated TanStack Query hooks.
- [x] US-27.1-T3: Create chats in the selected project; show project identity in chat and provide moves with a clear history-transfer explanation.
- [x] US-27.1-T4: Handle empty/loading/error states and deletion confirmation describing chat detachment.
- [x] US-27.1-T5: Add component tests and focused Playwright coverage for navigation, edits, moves, and deletion.

**Acceptance:** The selected project is unambiguous; chats can be created in General or a project; project instructions are editable without editing an agent.

**Implementation and verification (2026-10-16):** Folder navigation is replaced
by General and paginated project navigation. Projects have a searchable directory,
creation dialog, overview with scoped chat pagination, and a settings route for
name, description, and instructions. Existing/new chats show linked workspace
identity; new-chat links carry the project ID and unavailable projects block sends.
Sidebar chat queries wait for persisted chat membership and reset pagination on
workspace changes. Project search results now link to project overviews.

Settings keep unsaved text paired with its original context revision across
background refreshes and provide an explicit refetch/reload after conflicts.
Move dialogs support paginated destination search, explain full history/local
attachment transfer and historical information retention, and disable moves during
active generation. Deletion confirms detachment to General, source-file retention,
and active-run cancellation. All project/move APIs use generated TanStack Query
options and the global mutation invalidation policy. See
[project workspace architecture](../architecture/project-workspaces.md).

| Gate                           | Result                                                                                                            |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| Backend unit/integration suite | 430 passed                                                                                                        |
| Frontend unit/component suite  | 114 passed, including 12 new project/workspace regressions                                                        |
| Frontend migration tests       | 6 passed                                                                                                          |
| Root configuration tests       | 29 passed                                                                                                         |
| Backend/frontend lint          | Passed                                                                                                            |
| Backend/frontend typecheck     | Configured compileall and TypeScript gates passed; no backend story code/schema changes                           |
| Formatting                     | `pnpm format` passed                                                                                              |
| Frontend production build      | Passed                                                                                                            |
| OpenAPI/generated clients      | Regeneration from current served schema reproduced the existing client without changes                            |
| Isolated Playwright            | 21 passed without retries on the final run; runner exit 0; managed backend reports 143 during intentional cleanup |
| Visual review                  | Desktop and 390px mobile screenshots inspected; no horizontal overflow                                            |
| Diff integrity                 | `git diff --check` passed                                                                                         |

Browser coverage uses the production workspace components in a test-only harness
with mocked generated-client HTTP endpoints. It covers navigation links, request
scopes and revisions, edits, creation, deletion, moves, and failure/retry states;
it does not exercise an authenticated project workflow against the real backend.
Existing backend tests cover owner/revision and lifecycle boundaries. External
model providers were not invoked and the current database was retained. The
unrelated `core/config.py` edit remains untouched.

Initial checks updated older query/navigation mocks and project-search link
expectations, corrected a test-harness stable-query-client lint issue and test
query typing, and scoped a duplicate-text assertion to its alert. The initial
browser run failed because its General-query assertion preceded loading; the
final run waits for the loaded state and for redirect completion before teardown,
with no uncaught browser errors. No migrations, new UI dependencies, compatibility
fallbacks, or later-story file/sub-agent workflows were added. User confirmed
completion and authorized commit/merge on 2026-10-16; the checklist is
[archived](../archive/todo-completed-2026-10-16.md).
Next recommended story: US-27.2 — Composable project file explorer.

### US-27.2 — Composable project file explorer

As a user, I want to manage project files through the existing explorer.

**Estimate:** 2–3 person-days. **Dependencies:** US-27.1 and US-26.3.

- [ ] US-27.2-T1: Reuse file-manager list, selection, upload, and picker components through explicit data sources and permitted actions.
- [ ] US-27.2-T2: Add project file upload/add/remove, processing state, regenerate, and file view links; reuse the atomic membership API.
- [ ] US-27.2-T3: Replace knowledge-base badges/detail links with project memberships and accurate deletion impact.
- [ ] US-27.2-T4: Keep remove-from-project distinct from physical file deletion; use generated hooks and the global mutation invalidation policy.
- [ ] US-27.2-T5: Test shared files, picker exclusions, unavailable artifacts, removal versus deletion, and project-local filtering.

**Acceptance:** Project and library views share explorer components; adding membership does not reprocess a file; destructive controls match the selected scope.

### US-27.3 — Visible chat attachment scope

As a user, I want to understand which files this conversation can use.

**Estimate:** 2–3 person-days. **Dependencies:** US-27.1 and US-25.3 and EPIC-26.

- [ ] US-27.3-T1: Expose project files separately from chat attachments in the composer and chat context display.
- [ ] US-27.3-T2: Integrate draft uploads, explicit library picks, ready/pending/failed states, removal, and retry.
- [ ] US-27.3-T3: Show source provenance on retrieval citations and provide explicit add-to-project rather than automatic promotion.
- [ ] US-27.3-T4: Handle reopened chats, model changes, branches, and context estimates consistently.
- [ ] US-27.3-T5: Add component and E2E tests for General-chat isolation and two project chats with different local attachments.

**Acceptance:** A file attached in one chat is visibly local to that chat unless explicitly added to the project; citations resolve to authorized file views.

### US-27.4 — Main-agent settings and sub-agent management

As a user, I want to configure my main agent and manage model-bound sub-agents in settings.

**Estimate:** 2–3 person-days. **Dependencies:** US-29.1 and US-29.4.

- [ ] US-27.4-T1: Replace multiple main-agent CRUD/default-selection UI with one main-agent settings form for instructions, ordinary capabilities, limits, and supported generation defaults; remove its model binding and agent selector.
- [ ] US-27.4-T2: Provide sub-agent create/edit/delete/list UI with a required fixed-model selector, instructions, and allowed capabilities; support zero or many definitions with pagination and clear unavailable-model states.
- [ ] US-27.4-T3: Consume generated settings/model/tool hooks using shadcn components; omit internal tools from selectable controls while preserving ordinary tool settings and admin configuration.
- [ ] US-27.4-T4: Add component and Playwright tests for settings persistence, singleton UI, fixed-model sub-agent management, owner isolation, validation, and hidden internal tool controls.

**Acceptance:** User settings expose one main-agent configuration and separate sub-agent management. Internal delegation/retrieval tools have no manual user toggles; sub-agent model binding remains visible.

### US-27.5 — Chat model picker and project sub-agent selection

As a user, I want to see and choose my chat model and select the sub-agents available to a project.

**Estimate:** 2–3 person-days. **Dependencies:** US-27.1, US-27.4, EPIC-29, and US-26.1.

- [ ] US-27.5-T1: Replace chat agent selection with an available-model picker and visible active model/provider identity; persist selection across reopen and show the actual model used on historical assistant turns. Handle no available models, revoked selections, loading/error states, and model capability differences.
- [ ] US-27.5-T2: Support draft/new chat model choice and next-turn switching without changing main-agent properties; disable switching during active runs, and make regeneration use the chosen model without relabeling earlier turns.
- [ ] US-27.5-T3: Add select/deselect controls for owned sub-agents in project settings with empty initial selection, fixed-model labels, and deletion/revocation feedback. General offers no sub-agent selection or delegation; use atomic generated membership hooks.
- [ ] US-27.5-T4: Test two-model chats, reopen/regenerate/provenance, unavailable models, main-agent settings retained across model changes, two projects with different selected sub-agents, deselection, and General non-delegation in component and isolated E2E coverage.

**Acceptance:** Users always see the chat's selected model and can inspect available models; historical model labels remain accurate. Project-selected sub-agents are explicit and model-bound; automatic tool availability requires no user tool toggles.

## Shared definition of done

Complete only one story at a time, on its own feature branch. Run relevant lint, type checks, unit/integration tests, generated-client checks, and E2E for changed workflows. Record unrun gates accurately. Update todo/documentation; obtain user completion confirmation before merge. This plan does not authorize resetting the current database during planning.
