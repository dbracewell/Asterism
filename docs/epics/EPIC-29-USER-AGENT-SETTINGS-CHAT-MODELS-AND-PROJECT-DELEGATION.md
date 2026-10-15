# EPIC-29 — User agent settings, chat models, and project delegation

Status: US-29.1 completed; user confirmed 2026-10-14. US-29.2 completed; user confirmed 2026-10-15. US-29.3 completed; user confirmed 2026-10-15. US-29.4 not started.

Part of the [Projects and Chat Context Refactor](../plans/projects-and-chat-context-refactor.md). Added from the user's 2026-10-14 product direction. Numbering is stable: implement this epic **after EPIC-25 and before EPIC-26**, despite its number. UI work belongs to US-27.4/27.5.

Estimated effort: **8–12 engineering person-days**, including story-level verification.

## User stories
### US-29.1 — One main agent configuration per user

As a user, I want one main agent whose behavior I configure in user settings.

**Estimate:** 2–3 person-days. **Dependencies:** EPIC-25.
- [x] US-29.1-T1: Replace multiple selectable main-agent profiles/default-agent selection with exactly one user-owned main-agent configuration; provision it with the user and enforce uniqueness in the DB and existence in service lifecycle paths. Main-agent configuration has no bound model.
- [x] US-29.1-T2: Expose owner-scoped read/update of main-agent instructions, ordinary capabilities, loop limits, and supported generation defaults through user settings; prevent deleting the sole main-agent configuration. Preserve separate user-profile/persona invariants.
- [x] US-29.1-T3: Keep separately managed, owner-scoped sub-agent definitions with name, description, instructions, capabilities, and one fixed model per definition; permit zero or more without an arbitrary product count limit. Validate model availability and handle model deletion/disablement explicitly without silent replacement.
- [x] US-29.1-T4: Update fresh initialization, user provisioning, schemas, and generated clients without migrations; test singleton creation/races, settings isolation, sub-agent CRUD, required model binding, and invalid capability/model references.

**Acceptance:** Every user has exactly one main agent edited in settings; users cannot create/select alternative main agents. Main-agent configuration is independent of chat model selection; sub-agents remain distinct definitions bound to a single model.

US-29.1 delivery boundary: the existing settings and new-chat callers now consume
singleton main settings and distinct sub-agent endpoints. Main runtime construction
uses the explicitly selected user `default_model_id` separately from configuration,
with no first-available fallback. Persisted per-chat model selection remains US-29.2;
project sub-agent selection and automatic internal tools remain US-29.3/29.4. The
broader settings/navigation experience remains US-27.4/27.5.

Verification: all 358 backend tests, backend lint, compileall, focused basedpyright (agent/user/settings and
changed tool catalog/registry), and import-cycle checks pass. Frontend lint/TypeScript,
94 Vitest tests, 6 auth-database checks, 29 root configuration tests, and production
build pass. All 18 generated TypeScript files match freshly served OpenAPI after
SDK trailing-whitespace normalization. The final isolated Playwright run passed all
13 tests without retries, after correcting a locator that also matched Next's route
announcer. Backend regression coverage includes atomic singleton provisioning/races,
role/model storage checks, owner isolation, fixed-model CRUD/disablement/deletion,
main behavior refresh, and rejection of tool grants outside configured capabilities.
The working database was retained. User confirmed completion on 2026-10-14, authorizing commit and merge into main.

A broader basedpyright probe of the chat domain still reports two unchanged typing
issues: `ChatController.orchestrator` assigns the job's generic runtime protocol to
a concrete orchestrator annotation, and persisted `Message.content` narrows mutable
`LLMMessage.content`. These predate this story; the repository's configured backend
typecheck command (compileall), frontend TypeScript, and focused static checks above
pass. No full-repository basedpyright pass is claimed.

### US-29.2 — Chat model selection and model provenance

As a user, I want to choose the model used for each chat while keeping my main-agent behavior.

**Estimate:** 2–3 person-days. **Dependencies:** US-29.1.
- [x] US-29.2-T1: Define the available chat-model API from the existing provider/model catalog with enabled/authorized status, display identity, and relevant capabilities; return a clear state when no model is available.
- [x] US-29.2-T2: Replace chat main-agent selection with persisted model selection, including draft/new chats and an explicit initialization policy; validate requested models server-side. Model changes apply on the next turn; reject changes during an active run.
- [x] US-29.2-T3: Pass the selected model separately from main-agent configuration through runtime construction, token/context estimates, streaming, attachment/vision handling, background/resumed jobs, and regeneration. Snapshot the actual model/provider and configuration revision per turn; distinguish replay of a recorded turn from regeneration using the current selection.
- [x] US-29.2-T4: Regenerate clients and test switching/reopen, concurrent update/send, unavailable or unauthorized models, model capability differences, retry/regeneration/replay, and sub-agents retaining their own fixed models. Never silently fall back to a different model.

**Acceptance:** Chat model changes preserve main-agent properties and history. The backend reports the selected and actually executed model; estimates and execution agree. Historical turns retain their model provenance, and an unavailable selection produces an actionable error.

US-29.2 implementation (2026-10-15): new chats require an explicit catalog model;
the user default is a picker prefill only. Existing chats use a persisted model ID,
metadata snapshot and guarded selection revision. Draft selection is optional until
send and uses an expected previous model ID. Send receipts replay accepted messages;
new sends require the observed revision. Model disablement/deletion remains visible
without a replacement or history rewrite.

The job records an execution/model/provider/capability and main-configuration revision
snapshot before generation. Resume reuses it; regeneration validates the current
choice before altering the branch, including assistant parents in multi-step turns.
Actual assistant output, cancellation and stream starts retain that snapshot. Pending
estimates use the recorded choice/configuration and report actionable replay failures.
Sub-agents retain their fixed models. Guards remain process-local, as the existing
job manager. Minimal picker/history integration is implemented; the broader US-27.5
workspace/model browser remains pending. The working database was retained and fresh
schema initialization is required.

Verification: 368 backend tests; 100 frontend tests; 6 auth-database checks; 29 root
configuration checks; backend/frontend lint, configured typechecks, focused backend
basedpyright, import-cycle checks and production build pass. The final isolated
Playwright run passed all 15 tests without retries, including real model picker,
history-label, unavailable-selection and retry controls with API mocks. Backend tests
cover model/draft validation, selection/send/run serialization, resume/regeneration,
capability changes, actual streamed/persisted provenance and fixed workers. Two
pre-existing broader chat typing errors (controller runtime annotation and persisted
content narrowing) remain as documented under US-29.1; no full basedpyright pass is
claimed. All 18 generated TypeScript files match freshly served OpenAPI after SDK whitespace
normalization; required choice/revision and provenance schemas were validated.
User confirmed completion on 2026-10-15 and authorized commit and merge into `main`.

### US-29.3 — Project-selected sub-agents

As a user, I want to choose which of my sub-agents may participate in a project.

**Estimate:** 2–3 person-days. **Dependencies:** US-29.1.
- [x] US-29.3-T1: Add unique, owner-consistent project/sub-agent memberships with database enforcement and atomic owner-scoped list/select/deselect APIs; new projects start with no selected sub-agents. Reject main-agent and foreign IDs.
- [x] US-29.3-T2: Derive eligible delegation targets only from the active project's selection; General chats never use sub-agents, even if the user has definitions. A model-supplied target must be in the current server-derived set.
- [x] US-29.3-T3: Increment project context revision on selection changes; clean references on sub-agent/project deletion, and cancel/reject affected delegation after deselection or revocation. Moves/deletion change eligible targets with the chat's next context; recheck authorization at invocation.
- [x] US-29.3-T4: Regenerate clients and test empty selection, select/deselect, duplicate batches, mixed-owner atomic rejection, two projects with distinct selections, General denial, deleted definitions, revocation during a run, and delegation depth/cycle limits.

**Acceptance:** A project can select any subset of the user's sub-agents. Unselected agents cannot be invoked; General has no delegation. Selection grants neither extra file access nor unrestricted recursive delegation.

US-29.3 implementation (2026-10-15): project selections start empty and use
owner/role-consistent composite foreign keys. Paginated list and atomic batch
select/deselect endpoints expose revision guards, deterministic deduplication,
fixed-model availability and whole-batch rejection for invalid targets. Definition
deletion advances every affected project revision and cascades selections.

The chat authorization boundary derives an immutable target ceiling; prompts only
advertise selected, available workers. General and forged/unselected targets fail
closed. Children inherit that ceiling, chat/file references, cycle and depth limits,
while retaining their own fixed models and explicit capabilities. Invocation and
streaming validate current project membership, context and definition revisions,
and model availability. Silent child generation is checked every 100 ms and canceled
on revocation, including pending tool work. Any project context revision change
invalidates existing delegation; the next turn resolves a fresh ceiling. Selection
adds no file access. Automatic enablement remains US-29.4 and selection UI remains
US-27.5. Fresh schema initialization is required; the working database was retained.

Verification: 382 backend tests; 100 frontend tests; 6 auth-database checks; 29 root
configuration checks; backend/frontend lint, configured typechecks, focused backend
basedpyright (zero errors/warnings), import-cycle checks, formatting and production
build pass. All 18 generated TypeScript files match regeneration from OpenAPI served
through ASGI with the application root path. The final isolated Playwright run
passed all 15 tests without retries. Earlier browser attempts encountered dependency
network/install and occupied-port setup failures; locked dependencies were restored
and the final run used `pnpm_config_verify_deps_before_run=false`. The existing
settings E2E fixture emits a duplicate React key warning; no browser test failed.
Runtime/API regressions cover role/owner DB enforcement, concurrent batches, empty
and distinct project selections, General denial, stale ceilings, deletion/moves,
unavailable models and revocation during silent generation and pending tools.
No live external-provider verification is claimed. User confirmed completion on
2026-10-15, authorizing commit and merge into `main` under AGENTS.md section 5.4.

### US-29.4 — Internal tools derived from context and settings

As a user, I want required orchestration tools to work automatically without manual tool switches.

**Estimate:** 2–3 person-days. **Dependencies:** US-29.2 and US-29.3.
- [ ] US-29.4-T1: Introduce explicit tool metadata/policy separating user-configurable tools from internal context-managed tools; exclude internal tools from user-facing selectable tool lists and reject attempts to override their state through user settings/chat payloads. Retain admin management, audit traces, and ordinary capability allowlists.
- [ ] US-29.4-T2: Automatically enable delegation for project execution when selected eligible sub-agents exist; omit it for empty selection and General. Expose only eligible target descriptions; preserve fixed sub-agent models and bounded recursion.
- [ ] US-29.4-T3: Automatically enable project-knowledge search when the current project has file memberships, with explicit pending/failed/unavailable extraction behavior; also support authorized General/project chat-local attachment retrieval when that scope has files. Empty file scope disables retrieval and fails closed if directly invoked.
- [ ] US-29.4-T4: Derive effective tools on the server from admin policy, settings, model capabilities, and authorized context; an internal tool cannot expand file scope or delegation targets. Recheck on invocation and after revocation. Automatic enablement means the runtime/model can use the tool when relevant, not a compulsory search/delegation on every turn.
- [ ] US-29.4-T5: Regenerate affected clients and test hidden metadata, forged toggles, General/project/empty states, admin-disabled capabilities, model tool support, unavailable artifacts, selection/membership revocation, and delegated scope narrowing.

**Acceptance:** Users do not toggle delegation or contextual retrieval. Project selections/files determine their availability, and calls obey the same server-side authorization as other tools. General never delegates, but can retrieve its own attachments. Internal tools remain traceable even though absent from user tool pickers.

## Shared definition of done

Complete only one story at a time, on its own feature branch. Run relevant lint, type checks, unit/integration tests, generated-client checks, and E2E for changed workflows. Record unrun gates accurately. Update todo/documentation; obtain user completion confirmation before merge. This plan does not authorize resetting the current database during planning.
