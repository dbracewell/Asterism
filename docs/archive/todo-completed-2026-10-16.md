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
