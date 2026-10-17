# Completed work — 2026-10-17

## US-27.4 — Main-agent settings and sub-agent management

User confirmed completion on 2026-10-17 and authorized archive, commit, and merge into `main`.

- [x] US-27.4: Main-agent settings and sub-agent management — confirmed complete 2026-10-17.
  - [x] US-27.4-T1: Replace multiple main-agent CRUD/default-selection UI with one main-agent settings form for instructions, ordinary capabilities, limits, and supported generation defaults; remove its model binding and agent selector.
  - [x] US-27.4-T2: Provide sub-agent create/edit/delete/list UI with a required fixed-model selector, instructions, and allowed capabilities; support zero or many definitions with pagination and clear unavailable-model states.
  - [x] US-27.4-T3: Consume generated settings/model/tool hooks using shadcn components; omit internal tools from selectable controls while preserving ordinary tool settings and admin configuration.
  - [x] US-27.4-T4: Add component and Playwright tests for settings persistence, singleton UI, fixed-model sub-agent management, owner isolation, validation, and hidden internal tool controls.

Verification: 431 backend tests, 138 frontend unit/component tests, 6 migration tests, 29 root configuration tests, and 26 isolated Playwright tests passed. The final settings-only screenshot check also passed 2/2 with retries disabled. Lint, configured typechecks, formatting, production build, generated-client consistency, import-cycle checks, and diff integrity passed. Desktop and 390px mobile settings and mobile editor screenshots were inspected without horizontal overflow.

Changed backend agent files pass static analysis. Full backend static analysis reports 10 pre-existing errors reproduced identically on unchanged HEAD. Browser settings coverage uses production components with mocked HTTP endpoints; backend API/service tests independently verify actual ownership, singleton protection, validation, and pagination. See [EPIC-27](../epics/EPIC-27-PROJECT-AND-CHAT-WORKSPACE-UI.md) for full verification evidence and limitations.

The current database and unrelated `core/config.py` edit were retained. No migration, compatibility shim, new UI dependency, or external model-provider call was introduced.

Next recommended story: US-27.5 — Chat model picker and project sub-agent selection. EPIC-27 remains in progress.

## US-27.5 — Chat model picker and project sub-agent selection

User confirmed completion on 2026-10-17 and authorized archive, commit, and merge into `main`.

- [x] US-27.5: Chat model picker and project sub-agent selection — confirmed complete 2026-10-17.
  - [x] US-27.5-T1: Replace chat agent selection with an available-model picker and visible active model/provider identity; persist selection across reopen and show the actual model used on historical assistant turns. Handle no available models, revoked selections, loading/error states, and model capability differences.
  - [x] US-27.5-T2: Support draft/new chat model choice and next-turn switching without changing main-agent properties; disable switching during active runs, and make regeneration use the chosen model without relabeling earlier turns.
  - [x] US-27.5-T3: Add select/deselect controls for owned sub-agents in project settings with empty initial selection, fixed-model labels, and deletion/revocation feedback. General offers no sub-agent selection or delegation; use atomic generated membership hooks.
  - [x] US-27.5-T4: Test two-model chats, reopen/regenerate/provenance, unavailable models, main-agent settings retained across model changes, two projects with different selected sub-agents, deselection, and General non-delegation in component and isolated E2E coverage.

Verification: 432 backend tests, 145 frontend unit/component tests, 6 migration tests, 29 root configuration tests, and 29 isolated Playwright tests passed. Final chat guard/draft checks passed 2/2 and final project layout/workflow checks passed 6/6 with retries disabled. Lint, configured typechecks, formatting, production build, independent served-OpenAPI/generated-client consistency, import-cycle checks, and diff integrity passed. Desktop and 390px mobile chat/project layouts were inspected without horizontal overflow.

Changed backend project modules pass static analysis. Full backend static analysis reports 10 pre-existing errors reproduced identically on unchanged HEAD. Browser tests use production UI with mocked HTTP/WebSocket boundaries; backend integration tests independently verify ownership, General non-delegation, model concurrency/provenance, atomic memberships, and candidate filtering before pagination. See [EPIC-27](../epics/EPIC-27-PROJECT-AND-CHAT-WORKSPACE-UI.md) for evidence and limitations.

The current database and unrelated `core/config.py` edit were retained. No migration, compatibility shim, new UI dependency, or external model-provider call was introduced.

EPIC-27 is confirmed complete. Next recommended story: US-28.1 — Remove folders and standalone knowledge bases.

## US-28.1 — Remove folders and standalone knowledge bases

User confirmed completion on 2026-10-17 and authorized archive, commit, and merge into `main`.

- [x] US-28.1: Remove folders and standalone knowledge bases (2–3 person-days). **Confirmed complete 2026-10-17** on `feat/us-28.1-remove-legacy-context`.
  - [x] US-28.1-T1: Delete folder and standalone knowledge-base models/routes/services, knowledge-base agent assignments, multiple-main-agent/default-agent selection contracts and UI, obsolete agent-bound chat model paths, manual internal-tool toggles, generated schemas, obsolete tests, and search triggers; retain model-bound sub-agent definitions and project selections.
  - [x] US-28.1-T2: Remove old names from seeds, reset/initialization, harnesses, tool descriptions, and active docs; retain extraction and provider configuration.
  - [x] US-28.1-T3: Regenerate OpenAPI clients and verify the supported schema includes the new project/chat/file/sub-agent memberships, singleton main-agent settings, and chat model selection; obsolete selectable main-agent and manual internal-tool contracts are absent.
  - [x] US-28.1-T4: Run dependency/import checks and add a fresh-schema test proving obsolete tables and API paths are absent.

Verification: 429 backend tests, 129 frontend unit/component tests, 6 auth-database tests, 29 root configuration tests, and 26 isolated Playwright tests passed. Lint, formatting, configured typechecks, production build, independent served-OpenAPI/generated-client consistency, real HTTP/header/WebSocket proxy verification, import-cycle checks, and diff integrity passed. The initial frontend typecheck required clearing stale generated Next.js route types for removed pages; subsequent verification passed.

Changed backend modules pass static analysis with zero errors or warnings. Full backend static analysis still reports the same 10 baseline errors in unchanged chat controller and search component modules. See [EPIC-28](../epics/EPIC-28-CLEAN-CUT-REMOVAL-AND-VALIDATION.md) for evidence and limitations.

Removed standalone collection models, APIs, UI, generated contracts, and obsolete tests. Retained processing contracts and policy transitions now belong to the files domain. Fresh-schema and API tests verify absence of obsolete tables, triggers, routes, and schemas while preserving project/chat references, model selection, sub-agent definitions, captions, extraction, and provider configuration. The current database was retained; verification used disposable isolated databases. No migrations, compatibility shims, or fallback paths were introduced.

Next recommended story: US-28.2 — Architecture and operator documentation. EPIC-28 remains in progress.

## US-28.2 — Architecture and operator documentation

User confirmed completion on 2026-10-17 and authorized final archival, commit, and merge into `main`.

- [x] US-28.2: Architecture and operator documentation (1–2 person-days). **Confirmed complete 2026-10-17** on `feat/us-28.2-architecture-operator-docs`.
  - [x] US-28.2-T1: Update architecture diagrams, API/runtime/file lifecycle docs, backend/frontend READMEs, and contributor guidance, including AGENTS.md: exactly one main-agent configuration per user, separate persona/profile defaults, zero or more fixed-model sub-agent definitions, project-selected delegation, and internal context-managed tools.
  - [x] US-28.2-T2: Document singleton main-agent settings, chat model selection/provenance, project-selected fixed-model sub-agents, internal tool policy, prompt composition, scope resolution, delegation, attachment branching, deletion, memory limits, and provider boundaries.
  - [x] US-28.2-T3: Document a clean development reset for relational data, vectors, and source files without deleting verified provider model bundles.
  - [x] US-28.2-T4: Update the ADR to accepted decisions and archive completed planning/status history after user confirmation.

Updated runtime, transport, tool authorization, storage/provider/file lifecycle guidance, contributor rules, and the accepted ADR. Added execution-context/module and development-reset guides. Removed unsupported operator instructions and separated implemented provenance/isolation from future memory storage. The working database was preserved.

Verification: formatting, lint, configured typechecks, 429 backend tests, 129 frontend tests, 6 auth-database tests, and 29 root configuration tests passed. Reset canaries use temporary data and verify source/vector cleanup with model-bundle retention. Documentation links/anchors and methods were checked against repository files/current OpenAPI; shell syntax and diff integrity passed. Final archival references were rechecked after confirmation. Build, Playwright, and full basedpyright were not rerun for this documentation-only story; preceding US-28.1 evidence records those results and its 10 known baseline static errors. Diagrams were reviewed as Mermaid source, without a rendered-image check.

Pre-consolidation ADR, dated README appendices, and original roadmap are preserved verbatim from `aa3f943` in the [documentation history archive](us-28.2-documentation-history-2026-10-17.md). The README appendices now link there; the roadmap retains a stable current-status entry point. See [EPIC-28](../epics/EPIC-28-CLEAN-CUT-REMOVAL-AND-VALIDATION.md) for detailed implementation and verification.

Next recommended story: US-28.3 — Integrated quality and isolation verification. EPIC-28 remains in progress.

## US-28.3 — Integrated quality and isolation verification

Confirmed complete by the user on 2026-10-17, authorizing archival, commit, and local merge from `feat/us-28.3-integrated-validation`.

- [x] US-28.3: Integrated quality and isolation verification (2–3 person-days).
  - [x] US-28.3-T1: Run backend and frontend lint, typecheck, unit/integration suites, frontend build, and generated-client consistency checks.
  - [x] US-28.3-T2: Run isolated Playwright covering General upload/use/reopen, project prompt/files, moves, deletion, processing failures, two-user isolation, main-agent settings, chat model switching/provenance, project sub-agent selection/revocation, General non-delegation, and hidden internal tools.
  - [x] US-28.3-T3: Test main/delegated agent file access and replay; measure bounded scope resolution/query behavior with representative file counts.
  - [x] US-28.3-T4: Record each gate separately, including any unrun or retry-dependent check; update todo and archive before requesting completion confirmation.
  - [x] US-28.3-T5: On user confirmation, merge the approved story branch and report epic closure.

Verification: formatting, backend/frontend lint, full basedpyright (zero errors and warnings), compileall, frontend TypeScript, 437 backend tests, 129 frontend tests, 6 auth-database tests, 30 root tests, production frontend build, served-OpenAPI/generated-client consistency, and import-cycle checks passed. All 27 isolated Playwright tests passed with retries disabled. Documentation references and diff integrity passed.

The [verification report](us-28.3-verification-2026-10-17.md) records individual gates, earlier failures and repairs, scope measurements, and limitations. Dependency checks reused installed packages and local caches; real authenticated browser flows used a local model double. Live external providers and an empty-cache operating-system installation were not tested. The working database was preserved. No remote CI result or push is claimed.

EPIC-28 and the Projects and Chat Context Refactor roadmap (EPIC-24, EPIC-25, EPIC-29, EPIC-26, EPIC-27, and EPIC-28) are confirmed complete. Recommended next plan: live-provider smoke testing and release preparation.

## US-30.1 — Responsive provider controls and shared Save

The user authorized committing and merging all pending changes on 2026-10-17 from `fix/provider-model-settings-save`, following disclosure of the remaining frontend test failures.

- [x] Replace fixed-width model rows with a layout that wraps within its container.
- [x] Keep model drafts in the provider form and save all staged changes from the shared action, including edits across searches and pages.
- [x] Preserve capability provenance, validate context windows, and retain failed edits for retry.
- [x] Set `provider=<id>` on catalog expansion using the existing URL utility while preserving all current parameters.
- [x] Add TooltipProvider to agent-settings test wrappers and custom-query-client render paths.
- [x] Verify provider regressions, lint, type checks, formatting, and responsive browser behavior.
- [x] Record and defer the remaining agent-settings failures under the user's explicit merge authorization.
- [x] Obtain user completion confirmation before commit and merge.

Verification: nine provider unit/integration tests and four provider Playwright tests passed; frontend lint, TypeScript, formatting, production build, and six migration checks passed. The broader frontend unit suite reported 124 passing tests and nine failures. Tooltip context errors are fixed; remaining failures concern unnamed icon dialog triggers, outdated Fixed model label/display assertions, and an unavailable-model alert assertion. The full suite is not green; these failures remain tracked in `todo.md`. No backend contract changes, database reset, remote push, or remote CI result is claimed.

See [EPIC-30](../epics/EPIC-30-PROVIDER-SETTINGS-EDITING.md) for behavior and verification details. Recommended next work: repair the remaining agent-settings test/UI mismatches.
