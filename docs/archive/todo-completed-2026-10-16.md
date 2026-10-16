# Completed Work — 2026-10-16

## US-26.2 — Composable project prompts

User confirmed completion on 2026-10-16 and authorized commit and merge into `main`.

- [x] US-26.2: Composable project prompts — confirmed complete 2026-10-16.
  - [x] US-26.2-T1: Extract a PromptComposer from Agent.\_build_system_prompt with typed layers and explicit conflict rules.
  - [x] US-26.2-T2: Compose platform rules, agent role/capabilities, profile instructions where supported, project task instructions, and bounded runtime context.
  - [x] US-26.2-T3: Use the same composed prompt for token estimates, main-agent calls, delegated calls, and turn replay; never treat file text as system instructions.
  - [x] US-26.2-T4: Snapshot prompt revision per turn; apply edits to later turns and persist source/revision provenance rather than logging full private prompts.
  - [x] US-26.2-T5: Test precedence, empty project prompt, edits, chat model switching, main-agent settings edits, delegation, and context-budget accounting.

Verification: 409 backend tests (including 7 prompt-composition cases), 101 frontend unit tests, 6 frontend migration tests, 29 root configuration tests, and 16 isolated Playwright tests passed. Backend/frontend lint, formatting, configured type checks, targeted basedpyright on changed modules (0 errors/warnings), frontend production build, generated-client consistency, import-cycle checks (211 modules / 962 imports), and diff integrity passed. The isolated runner exited 0; its managed backend reported 143 during intentional cleanup. Repaired setup failures and verification details are recorded in [EPIC-26](../epics/EPIC-26-COMPOSABLE-EXECUTION-CONTEXT.md).

The current database was retained. The direct schema changes require the normal disposable development-data reset before using this schema; no data migration or compatibility path was added.

Next recommended story: US-26.3 — Shared retrieval and file-tool authorization.

## US-26.3 — Shared retrieval and file-tool authorization

User confirmed completion on 2026-10-16 and authorized commit and merge into `main`.

- [x] US-26.3: Shared retrieval and file-tool authorization — confirmed complete 2026-10-16.
  - [x] US-26.3-T1: Move search logic from the built-in tool into an injected RetrievalService using the resolved scope and existing extraction/vector interfaces.
  - [x] US-26.3-T2: Replace agent knowledge-base assignments with contextual access; derive contextual retrieval as an internal tool through US-29.4 policy, rather than a user-selectable agent toggle or assignment.
  - [x] US-26.3-T3: Apply owner and allowed-file filters before vector search and equivalent checks to every file reading/summarization/image path.
  - [x] US-26.3-T4: Preserve current-generation readiness, result limits, captions, image routing, citations, and scope provenance.
  - [x] US-26.3-T5: Test empty scope fails closed, foreign and unrelated files, unavailable embeddings, replacement generations, and stale authorization.

Verification: 421 backend tests (including 13 new scoped retrieval/file cases), 102 frontend unit tests, 6 migration tests, 29 root configuration tests, and 16 isolated Playwright tests passed. Backend/frontend lint, formatting, configured type checks, targeted basedpyright on changed modules (0 errors/warnings), production build, independent generated-client consistency, import-cycle checks (168 modules / 654 imports), and diff integrity passed. Playwright had no browser retries; the isolated runner exited 0 while its managed backend reported 143 during intentional cleanup. Setup/test-double repairs and the resolved import cycle are documented in [EPIC-26](../epics/EPIC-26-COMPOSABLE-EXECUTION-CONTEXT.md).

Verification used fresh databases, real source bytes, and a real LanceDB search with injected query embeddings. External provider calls and live model provisioning were not run. The current database was retained; removal of agent knowledge-base assignment storage requires fresh disposable development schema initialization. No migration or compatibility fallback was added.

Next recommended story: US-26.4 — Context provenance and memory isolation.

## US-26.4 — Context provenance and memory isolation

User confirmed completion on 2026-10-16 and authorized commit and merge into `main`.

- [x] US-26.4: Context provenance and memory isolation — confirmed complete 2026-10-16.
  - [x] US-26.4-T1: Add project/chat/scope-revision, main/sub-agent configuration, selected target set, and actual model/provider provenance to execution and retrieval traces without logging file bodies or full prompts.
  - [x] US-26.4-T2: Audit any existing summary, cache, memory, and resume paths for cross-chat reuse; key derived context by its source scope.
  - [x] US-26.4-T3: For any active long-term memory path, scope project-derived writes/reads by project and General-chat-derived writes/reads by chat; do not add a new memory engine.
  - [x] US-26.4-T4: If no long-term memory integration exists, define the typed boundary and tests for future integration without building project-wide conversational memory.
  - [x] US-26.4-T5: Test reuse of one agent/profile across projects, moves, restart, and removal; document that existing historical messages cannot be unlearned.

Verification: 430 backend tests (including 9 new provenance/isolation cases), 102 frontend unit tests, 6 frontend migration tests, 29 root configuration tests, and 16 isolated Playwright tests passed. Backend/frontend lint, formatting, configured type checks, targeted basedpyright on changed modules (0 errors/warnings), production build, independent generated-client consistency (18 files), import-cycle checks (170 modules / 668 imports), and diff integrity passed. Playwright had no retries; the isolated runner exited 0 while its managed backend reported 143 during intentional cleanup. Initial setup failures and repaired test assumptions are recorded in [EPIC-26](../epics/EPIC-26-COMPOSABLE-EXECUTION-CONTEXT.md).

No active long-term memory engine exists; typed project/General-chat memory namespaces and source-specific derived-context keys define the future boundary. Delegated traces retain metadata/digests rather than bodies. The current database and unrelated `core/config.py` edit were retained. No migration, compatibility fallback, live provider call, or automatic project-wide conversational memory was added.

EPIC-26 is confirmed complete. Next recommended story: US-27.1 — Project navigation and settings.

## US-27.1 — Project navigation and settings

User confirmed completion on 2026-10-16 and authorized commit and merge into `main`.

- [x] US-27.1: Project navigation and settings — confirmed complete 2026-10-16.
  - [x] US-27.1-T1: Replace folder navigation with Projects and General; add project CRUD, paginated lists/search, and project overview/settings routes.
  - [x] US-27.1-T2: Add name, description, and system-prompt forms using existing shadcn components and generated TanStack Query hooks.
  - [x] US-27.1-T3: Create chats in the selected project; show project identity in chat and provide moves with a clear history-transfer explanation.
  - [x] US-27.1-T4: Handle empty/loading/error states and deletion confirmation describing chat detachment.
  - [x] US-27.1-T5: Add component tests and focused Playwright coverage for navigation, edits, moves, and deletion.

Verification: 430 backend tests, 114 frontend unit/component tests (including 12 new workspace regressions), 6 frontend migration tests, 29 root configuration tests, and 21 isolated Playwright tests passed. Backend/frontend lint, formatting, configured type checks, production build, generated-client consistency, and diff integrity passed. Desktop and 390px mobile screenshots were inspected without horizontal overflow. Playwright passed without retries on the final run; the isolated runner exited 0, while its managed backend reported 143 during intentional cleanup. Initial test/mock repairs are recorded in [EPIC-27](../epics/EPIC-27-PROJECT-AND-CHAT-WORKSPACE-UI.md).

New browser coverage uses production workspace components in a test-only harness with mocked HTTP endpoints; authenticated project workflows against the real backend and external model providers were not exercised. Existing backend tests cover ownership, revisions, and lifecycle behavior. The current database and unrelated `core/config.py` edit were retained. No new UI dependencies, migration, or compatibility fallback was added.

Next recommended story: US-27.2 — Composable project file explorer. EPIC-27 remains in progress.

## US-27.2 — Composable project file explorer

User confirmed completion on 2026-10-16 and authorized commit and merge into `main`.

- [x] US-27.2: Composable project file explorer — confirmed complete 2026-10-16.
  - [x] US-27.2-T1: Reuse file-manager list, selection, upload, and picker components through explicit data sources and permitted actions.
  - [x] US-27.2-T2: Add project file upload/add/remove, processing state, regenerate, and file view links; reuse the atomic membership API.
  - [x] US-27.2-T3: Replace knowledge-base badges/detail links with project memberships and accurate deletion impact.
  - [x] US-27.2-T4: Keep remove-from-project distinct from physical file deletion; use generated hooks and the global mutation invalidation policy.
  - [x] US-27.2-T5: Test shared files, picker exclusions, unavailable artifacts, removal versus deletion, and project-local filtering.

Verification: 430 backend tests, 125 frontend unit/component tests (including 11 new regressions), 6 frontend migration tests, 29 root configuration tests, and 22 isolated Playwright tests passed. Backend/frontend lint, formatting, configured type checks, production build, generated-client consistency, and diff integrity passed. Final desktop and 390px mobile screenshots were inspected; filenames remain visible without horizontal overflow. Playwright passed without retries on the final run; the isolated runner exited 0 while its managed backend reported 143 during intentional cleanup. Initial verification repairs are recorded in [EPIC-27](../epics/EPIC-27-PROJECT-AND-CHAT-WORKSPACE-UI.md).

Project and library views share explorer components with explicit data sources and permitted actions. Membership addition reuses artifacts; removal is distinct from physical deletion. Browser coverage uses production components in a test-only harness with mocked HTTP endpoints; authenticated project workflows against the real backend and external providers were not exercised. The current database and unrelated `core/config.py` edit were retained. No new UI dependencies, migrations, or compatibility shims were added.

Next recommended story: US-27.3 — Visible chat attachment scope. EPIC-27 remains in progress.
