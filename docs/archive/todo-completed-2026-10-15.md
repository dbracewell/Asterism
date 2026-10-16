# Completed work — 2026-10-15

## US-29.2 — Chat model selection and model provenance

User confirmed completion on 2026-10-15 and authorized commit and merge into `main`.

- [x] US-29.2: Chat model selection and model provenance — confirmed complete 2026-10-15.
  - [x] US-29.2-T1: Define the available chat-model API from the existing provider/model catalog with enabled/authorized status, display identity, and relevant capabilities; return a clear state when no model is available.
  - [x] US-29.2-T2: Replace chat main-agent selection with persisted model selection, including draft/new chats and an explicit initialization policy; validate requested models server-side. Model changes apply on the next turn; reject changes during an active run.
  - [x] US-29.2-T3: Pass the selected model separately from main-agent configuration through runtime construction, token/context estimates, streaming, attachment/vision handling, background/resumed jobs, and regeneration. Snapshot the actual model/provider and configuration revision per turn; distinguish replay of a recorded turn from regeneration using the current selection.
  - [x] US-29.2-T4: Regenerate clients and test switching/reopen, concurrent update/send, unavailable or unauthorized models, model capability differences, retry/regeneration/replay, and sub-agents retaining their own fixed models. Never silently fall back to a different model.

Verification: 368 backend tests, 100 frontend tests, 15 isolated browser tests without retries, 6 auth database checks, and 29 root configuration tests passed. Backend/frontend lint, configured type checks, production build, dependency-cycle checks, and fresh OpenAPI client consistency passed. Focused backend static typing passed; a broader chat probe retains two pre-existing typing errors in controller.py and schemas.py.

The working database was retained; schema changes require a fresh development database.

Next recommended story: US-29.3 — Project-selected sub-agents.

## US-29.3 — Project-selected sub-agents

User confirmed completion on 2026-10-15 and authorized commit and merge into `main`.

- [x] US-29.3: Project-selected sub-agents.
  - [x] US-29.3-T1: Add unique, owner-consistent project/sub-agent memberships with database enforcement and atomic owner-scoped list/select/deselect APIs; new projects start with no selected sub-agents. Reject main-agent and foreign IDs.
  - [x] US-29.3-T2: Derive eligible delegation targets only from the active project's selection; General chats never use sub-agents, even if the user has definitions. A model-supplied target must be in the current server-derived set.
  - [x] US-29.3-T3: Increment project context revision on selection changes; clean references on sub-agent/project deletion, and cancel/reject affected delegation after deselection or revocation. Moves/deletion change eligible targets with the chat's next context; recheck authorization at invocation.
  - [x] US-29.3-T4: Regenerate clients and test empty selection, select/deselect, duplicate batches, mixed-owner atomic rejection, two projects with distinct selections, General denial, deleted definitions, revocation during a run, and delegation depth/cycle limits.

Verification: 382 backend tests, 100 frontend tests, 6 auth-database checks, 29 root configuration checks, and a final isolated Playwright run with all 15 tests passing without retries. Lint, formatting, configured type checks, focused backend basedpyright, import-cycle checks, production build, and generated-client consistency passed. Initial browser setup failures and the existing settings fixture duplicate-key warning are documented in EPIC-29. No live external-provider check is claimed.

The working database was retained. Fresh schema initialization is required.

Next recommended story: US-29.4 — Internal tools derived from context and settings.

## US-29.4 — Internal tools derived from context and settings

User confirmed completion on 2026-10-15 and authorized commit and merge into `main`.

- [x] US-29.4: Internal tools derived from context and settings.
  - [x] US-29.4-T1: Introduce explicit tool metadata/policy separating user-configurable tools from internal context-managed tools; exclude internal tools from user-facing selectable tool lists and reject attempts to override their state through user settings/chat payloads. Retain admin management, audit traces, and ordinary capability allowlists.
  - [x] US-29.4-T2: Automatically enable delegation for project execution when selected eligible sub-agents exist; omit it for empty selection and General. Expose only eligible target descriptions; preserve fixed sub-agent models and bounded recursion.
  - [x] US-29.4-T3: Automatically enable project-knowledge search when the current project has file memberships, with explicit pending/failed/unavailable extraction behavior; also support authorized General/project chat-local attachment retrieval when that scope has files. Empty file scope disables retrieval and fails closed if directly invoked.
  - [x] US-29.4-T4: Derive effective tools on the server from admin policy, settings, model capabilities, and authorized context; an internal tool cannot expand file scope or delegation targets. Recheck on invocation and after revocation. Automatic enablement means the runtime/model can use the tool when relevant, not a compulsory search/delegation on every turn.
  - [x] US-29.4-T5: Regenerate affected clients and test hidden metadata, forged toggles, General/project/empty states, admin-disabled capabilities, model tool support, unavailable artifacts, selection/membership revocation, and delegated scope narrowing.

Verification: 396 backend tests, 101 frontend tests, 6 auth-database checks, 29 root configuration checks, and all 16 isolated Playwright tests passed without browser test retries. Lint, formatting, configured type checks, focused backend basedpyright, import-cycle checks, production build, and regenerated-client consistency passed. The existing settings fixture duplicate-key warning and external-provider verification limits are recorded in EPIC-29.

The working database was retained; fresh schema initialization is required.

EPIC-29 is complete: all four stories and 17 tasks have been implemented and user-confirmed. US-29.1 is archived under 2026-10-14; US-29.2 through US-29.4 are archived here.

Next recommended epic: EPIC-26 — Composable execution context. Begin with US-26.1 — Execution scope resolver.

## US-26.1 — Execution scope resolver

User confirmed completion on 2026-10-15 and authorized merge into `main`.

- [x] US-26.1: Execution scope resolver.
  - [x] US-26.1-T1: Implement a server-derived context with user/profile/main-agent-or-sub-agent/chat/project IDs, selected and executed model identity, eligible project sub-agent IDs, effective internal tools, active branch, configuration/prompt revision, allowed file IDs, and file provenance. (`user_profile_id` is typed but unpopulated: no active-profile concept exists in the runtime yet.)
  - [x] US-26.1-T2: Inject small project and chat scope readers into the resolver rather than letting Agent query domain tables.
  - [x] US-26.1-T3: Resolve scope at turn start and recheck authorization before each file/retrieval tool call; reject canceled or revoked execution contexts. Connect project deletion to cancellation of affected active runs before deleting project context.
  - [x] US-26.1-T4: Pass narrowed context to delegated agents and background/restarted jobs without granting new tools or wider files.
  - [x] US-26.1-T5: Test empty scope, cross-user IDs, same-agent different-chat isolation, delegation, and revocation races.

Verification: 402 backend tests passed; ruff check and format clean; basedpyright reports 11 pre-existing errors in unrelated web-search components (unchanged by this story). Frontend gates and OpenAPI regeneration were not run because no frontend or API contract changed.

Next recommended story: US-26.2 — Composable project prompts.
