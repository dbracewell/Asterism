# EPIC-29 — User agent settings, chat models, and project delegation

Status: Proposed / not started.

Part of the [Projects and Chat Context Refactor](../plans/projects-and-chat-context-refactor.md). Added from the user's 2026-10-14 product direction. Numbering is stable: implement this epic **after EPIC-25 and before EPIC-26**, despite its number. UI work belongs to US-27.4/27.5.

Estimated effort: **8–12 engineering person-days**, including story-level verification.

## User stories
### US-29.1 — One main agent configuration per user

As a user, I want one main agent whose behavior I configure in user settings.

**Estimate:** 2–3 person-days. **Dependencies:** EPIC-25.
- [ ] US-29.1-T1: Replace multiple selectable main-agent profiles/default-agent selection with exactly one user-owned main-agent configuration; provision it with the user and enforce uniqueness in the DB and existence in service lifecycle paths. Main-agent configuration has no bound model.
- [ ] US-29.1-T2: Expose owner-scoped read/update of main-agent instructions, ordinary capabilities, loop limits, and supported generation defaults through user settings; prevent deleting the sole main-agent configuration. Preserve separate user-profile/persona invariants.
- [ ] US-29.1-T3: Keep separately managed, owner-scoped sub-agent definitions with name, description, instructions, capabilities, and one fixed model per definition; permit zero or more without an arbitrary product count limit. Validate model availability and handle model deletion/disablement explicitly without silent replacement.
- [ ] US-29.1-T4: Update fresh initialization, user provisioning, schemas, and generated clients without migrations; test singleton creation/races, settings isolation, sub-agent CRUD, required model binding, and invalid capability/model references.

**Acceptance:** Every user has exactly one main agent edited in settings; users cannot create/select alternative main agents. Main-agent configuration is independent of chat model selection; sub-agents remain distinct definitions bound to a single model.

### US-29.2 — Chat model selection and model provenance

As a user, I want to choose the model used for each chat while keeping my main-agent behavior.

**Estimate:** 2–3 person-days. **Dependencies:** US-29.1.
- [ ] US-29.2-T1: Define the available chat-model API from the existing provider/model catalog with enabled/authorized status, display identity, and relevant capabilities; return a clear state when no model is available.
- [ ] US-29.2-T2: Replace chat main-agent selection with persisted model selection, including draft/new chats and an explicit initialization policy; validate requested models server-side. Model changes apply on the next turn; reject changes during an active run.
- [ ] US-29.2-T3: Pass the selected model separately from main-agent configuration through runtime construction, token/context estimates, streaming, attachment/vision handling, background/resumed jobs, and regeneration. Snapshot the actual model/provider and configuration revision per turn; distinguish replay of a recorded turn from regeneration using the current selection.
- [ ] US-29.2-T4: Regenerate clients and test switching/reopen, concurrent update/send, unavailable or unauthorized models, model capability differences, retry/regeneration/replay, and sub-agents retaining their own fixed models. Never silently fall back to a different model.

**Acceptance:** Chat model changes preserve main-agent properties and history. The backend reports the selected and actually executed model; estimates and execution agree. Historical turns retain their model provenance, and an unavailable selection produces an actionable error.

### US-29.3 — Project-selected sub-agents

As a user, I want to choose which of my sub-agents may participate in a project.

**Estimate:** 2–3 person-days. **Dependencies:** US-29.1.
- [ ] US-29.3-T1: Add unique, owner-consistent project/sub-agent memberships with database enforcement and atomic owner-scoped list/select/deselect APIs; new projects start with no selected sub-agents. Reject main-agent and foreign IDs.
- [ ] US-29.3-T2: Derive eligible delegation targets only from the active project's selection; General chats never use sub-agents, even if the user has definitions. A model-supplied target must be in the current server-derived set.
- [ ] US-29.3-T3: Increment project context revision on selection changes; clean references on sub-agent/project deletion, and cancel/reject affected delegation after deselection or revocation. Moves/deletion change eligible targets with the chat's next context; recheck authorization at invocation.
- [ ] US-29.3-T4: Regenerate clients and test empty selection, select/deselect, duplicate batches, mixed-owner atomic rejection, two projects with distinct selections, General denial, deleted definitions, revocation during a run, and delegation depth/cycle limits.

**Acceptance:** A project can select any subset of the user's sub-agents. Unselected agents cannot be invoked; General has no delegation. Selection grants neither extra file access nor unrestricted recursive delegation.

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
