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
