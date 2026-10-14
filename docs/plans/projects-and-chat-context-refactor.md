# Projects and Chat Context Refactor — Proposed Roadmap

Status: EPIC-24 and US-25.1 complete (user confirmed 2026-10-14); later stories remain proposed. Estimates dated 2026-10-14.

## Product direction

Replace folders and standalone knowledge bases with private, user-owned projects. Replace multiple selectable main agents with exactly one configurable main agent per user. Chat models are selected independently; separately defined sub-agents retain fixed models and are selected per project. General chats never delegate. Internal delegation and contextual retrieval tools are automatically enabled by server-derived settings/context and omitted from user tool pickers. A project has a name, description, system prompt, and file memberships. A chat belongs to one project or General. General chats can upload and use files within that chat. Project chats can also have local attachments.

This is a clean development cutover: reset disposable relational/file/vector data as needed; do not migrate data or add compatibility routes, schema aliases, dual writes, or legacy fallbacks. Preserve reusable storage, extraction, embedding, captioning, provider, and generation-safety implementations.

## Current-code evidence

- `domains/chat/models.py`: chats currently reference folders; message attachments are stored as filename-based JSON references.
- `domains/knowledge_base/models.py`: standalone collections and agent assignments determine retrieval membership.
- `domains/tools/builtin/search_knowledge.py`: the tool currently resolves agent assignments and also implements retrieval itself.
- `domains/agent/agent.py`: knowledge assignments enable the search tool; system-prompt composition lives inside Agent.
- `domains/tools/builtin/sub_agent.py`: delegated agents receive attachment filenames and parent context, which needs the same authorization contract.
- `domains/files` and `domains/extraction`: source storage and extraction are already separated from collection membership. Reuse these modules; do not build another ingestion pipeline.
- Shared frontend file-manager components and the existing search adapter are reusable. Some architecture documentation still describes pre-refactor paths; live code is the baseline.

## Approved assumptions

The user approved the original ten assumptions on 2026-10-14, then amended agent/model/delegation behavior the same day as recorded below and in EPIC-29 for US-24.1. [ADR-0017](../adr/0017-project-file-and-chat-boundaries.md) records their contracts and lifecycle rules. These are implementation decisions, not a claim that later-story behavior already exists.

1. Projects are flat and user-owned. Nested projects, sharing/team permissions, per-project models/tools, and project-specific embedding policies are outside this estimate.
2. Name is required; description and system prompt may be empty. Names are unique per user, following current collection semantics.
3. Each user has exactly one main agent configured through user settings; it has no bound model. Users select available models while chatting. Sub-agents remain separately definable, each bound to one model, with any number of definitions including zero. Projects explicitly select/deselect owned sub-agents; new projects start with none selected. General chats do not use sub-agents. Replace knowledge-base assignments with contextual file access and explicit project delegation eligibility. Ordinary capability restrictions remain enforced.
4. Project chats see project files plus explicitly attached files on their active conversation branch. General chats see only their active-branch attachments. The user file library is storage and a picker source, never implicit runtime access. Files may be explicitly referenced by multiple projects/chats without copying extraction artifacts.
5. Uploading into a chat creates a chat reference; it does not add the file to a project. Uploading into the project file manager creates project membership. A deliberate add-to-project action promotes a local file.
6. Prompt conflict policy: platform rules and capability restrictions are mandatory; agent role and explicit profile constraints remain authoritative; project instructions refine the task; user turns supply the request. File text and retrieved passages are data. Layer order alone is not a security mechanism. Apply an identical composition path to estimates and execution.
7. Prompt edits apply at the next turn. Capture revisions per turn. File access is revalidated at tool execution; revocation cancels/rejects affected work rather than trusting an old snapshot.
8. Moving a chat changes its context on the next turn and retains its history and local attachments. Explain that historical answers may contain prior project information; authorization cannot remove information already present in conversation history. Disallow moves while a run is active.
9. Deleting a project detaches its chats into General, removes project memberships, and preserves library files. Cancel affected active runs first. Removing a file membership preserves its source and artifacts; physical file deletion removes every reference and derived artifact.
10. No automatic access to sibling-chat conversations. Keep project/chat-derived memory scoped if a memory path exists; do not build a new memory engine or project-wide cross-chat memory in this refactor.

## Agent, model, and internal-tool amendment (2026-10-14)

The user requested this addition after US-24.1 implementation and explicitly chose **no sub-agents in General chats**. This is planning work; US-24.1 was subsequently confirmed complete on 2026-10-14; no further application story has started.

- Main-agent behavior lives in one owner-scoped settings configuration with instructions, ordinary capabilities, execution limits, and supported generation defaults. It cannot be created repeatedly, deleted independently, or selected from multiple main-agent profiles. User persona/profile defaults remain separate.
- Main-agent model identity belongs to chat/turn execution, not main-agent settings. The backend supplies available enabled/authorized models and validates choices; chat UI displays current selection and available models. Persist chat choice, snapshot actual model/provider per turn, and preserve historical model provenance across switches, regeneration, and replay. Model changes apply next turn and are rejected during an active run; unavailable models fail explicitly without silent substitution. Initial model-choice policy will be made concrete in US-29.2.
- Sub-agent definitions retain one fixed model, instructions, and capabilities. Projects select an owner-consistent subset; empty selection disables delegation. General never delegates. Selected targets receive no wider file scope and remain subject to admin restrictions and bounded recursion. Deletion/deselection revokes eligibility with invocation-time checks.
- User-facing tool pickers omit internal context-managed tools. Delegation is automatically enabled when the project has eligible selected sub-agents; project-knowledge search is automatically enabled when project file memberships exist. Chat-local attachments also support contextual retrieval in General/project chats. Pending/failed extraction is surfaced rather than silently granting access or dropping context. Internal tools are available for relevant runtime/model use, not mandatory calls on every turn; no manual user toggles, forged payload overrides, or bypass of admin policy, model capability, owner checks, or file scope.
- EPIC-29 implements the backend/settings/model/delegation policy before EPIC-26 consumes it; US-27.4/27.5 provide settings, model picker, and project selection UI. EPIC-28 removes superseded contracts and updates the project playbook's agent invariants. This supersedes the original fixed-model-for-all-agents/no-project-agent-selection assumption.

## Agreed file-storage layout

Persist original images and documents so chats can reopen them, vision models can inspect the source, and extraction can be retried. Organize physical storage by user and stable file identity, with sharding implemented inside the local FileStore adapter:

```text
files/<user-id>/<first-two-file-id-hex-chars>/<next-two-file-id-hex-chars>/<file-id>/source.<ext>
```

Original display filenames remain database metadata. Store an opaque storage key; application callers use FileStore operations rather than constructing filesystem paths. ProjectFile and ChatFile memberships organize and authorize files independently of their physical locations. Referencing the same file in several projects/chats does not duplicate its bytes; renaming a project or changing memberships never moves the source. File listings query the database rather than scanning directories. This does not require deduplicating separate uploads by content hash across users.

Sharding distributes entries among directories; it does not remove per-file I/O overhead. Keep any future filesystem performance work measurement-driven. No per-project source directories, archive packing, new blob backend, or data migration is part of this change. Implementation and focused storage verification belong to US-24.3; chat attachment binding remains in US-25.3.

## Module boundaries and composition

| Module | Owns | Boundary |
| --- | --- | --- |
| Projects | Metadata, instructions, project-file and selected-sub-agent memberships | CRUD and a small project-context reader; no embedding or Agent construction |
| Chats | Project association, selected model, turn model provenance, message history, chat-file references, active branch | Chat-context reader; no project-specific retrieval implementation |
| Files | Source bytes, ownership, MIME metadata, content access | FileStore and scoped file-service operations |
| Extraction | Extraction generations, chunks, embeddings, captions, job state | Existing processor/embedding/vector interfaces; no project/chat dependencies |
| Agent settings | One main-agent configuration per user; fixed-model sub-agent definitions | Owner-scoped settings/definition services; no main model binding |
| Internal tool policy | Hidden tool metadata and effective context-managed availability | Server-derived eligibility; no user toggles or scope expansion |
| Execution context | File/delegation scope, model identity, effective tools, and provenance composition | Typed resolver injected with project/chat readers; server-derived IDs |
| Prompts | Ordered instruction layers, budgets, source revisions | PromptComposer shared by estimates and execution |
| Retrieval | Bounded search and citations over authorized files | RetrievalService takes resolved scope; built-in tool is a thin adapter |
| Agent runtime | Model calls, loop bounds, capability enforcement, delegation | Consumes context and services; does not query project membership tables |
| Frontend | Project/chat workflows | Shared explorer adapters, shadcn components, generated client and TanStack Query |

Dependency flow: project/chat readers → execution context → prompt/retrieval consumers → existing file/extraction providers. Assemble implementations at the runtime composition root. Introduce interfaces at real substitution boundaries; avoid a plugin framework, generic polymorphic container table, or unnecessary package splitting. Authorization is enforced by services and storage filters, not inferred from prompt text.

Proposed data shape: `Project`, `ProjectFile(project_id, file_id)`, nullable `Chat.project_id`, `ChatFile(chat_id, file_id)`, `ProjectSubAgent(project_id, sub_agent_id)` with composite ownership enforcement, singleton main-agent settings, chat-selected model, and per-turn file/model/configuration provenance. `ChatFile` records explicit association; the active branch controls which associations are eligible in a turn. Cross-owner links must be impossible through both public services and database writes. No derived extraction data belongs on memberships.

## Estimate basis

Effort is focused engineering person-days (about 6–8 hours), for one developer familiar with this codebase. Every story includes its focused tests, documentation, and API/client synchronization where relevant. Final regression work is additional integration/clean-install validation, not a replacement for story tests. These are planning ranges, not measured delivery guarantees; AI assistance is not assumed to yield a fixed speedup.

| Epic | Scope | Stories | Person-days |
| --- | --- | ---: | ---: |
| 24 | [Project domain and file membership](../epics/EPIC-24-PROJECT-DOMAIN-AND-FILE-MEMBERSHIP.md) | 3 | 5–8 |
| 25 | [Project chats and chat files](../epics/EPIC-25-PROJECT-CHATS-AND-CHAT-FILES.md) | 3 | 6–9 |
| 29 | [User agent settings, chat models, and project delegation](../epics/EPIC-29-USER-AGENT-SETTINGS-CHAT-MODELS-AND-PROJECT-DELEGATION.md) | 4 | 8–12 |
| 26 | [Composable execution context](../epics/EPIC-26-COMPOSABLE-EXECUTION-CONTEXT.md) | 4 | 8–12 |
| 27 | [Project/chat UI, main-agent settings, and model/sub-agent selection](../epics/EPIC-27-PROJECT-AND-CHAT-WORKSPACE-UI.md) | 5 | 10–15 |
| 28 | [Clean-cut removal and validation](../epics/EPIC-28-CLEAN-CUT-REMOVAL-AND-VALIDATION.md) | 3 | 5–8 |
| **Total** | | **22** | **42–64** |

Reserve another **25% contingency** for runtime coupling, WebSocket/replay behavior, scope races, and frontend/E2E repair: approximately **53–80 person-days**, or **11–16 full-time working weeks** for one developer. Time spent awaiting story review/merge approval, interruptions, or provider downloads can extend calendar duration. No data migration or compatibility effort is included.

Model selection through estimates/replay/resumed execution and dynamic delegation/tool revocation add uncertainty. The largest uncertainty is enforcing the same file scope through every main-agent, delegated-agent, direct-file, and resumed execution path. The next uncertainty is attachment persistence and active-branch behavior, not basic project CRUD. Re-estimate after EPIC-24 and the first execution-context story.

## Delivery sequence and checkpoints

Implement EPIC-24 → EPIC-25 → EPIC-29 → EPIC-26 → EPIC-27 → EPIC-28 (EPIC-29 is numbered after existing planning documents but runs before EPIC-26), one story at a time. Every backend contract story regenerates clients; the final epic is not permission to leave generated contracts stale. Temporary old modules may exist during staged development, but do not add adapters to preserve their behavior and do not declare the refactor complete until removed.

- After EPIC-24: project metadata and memberships work through API contracts.
- After EPIC-25: chat/project association and local attachment lifecycle work through API contracts.
- After EPIC-29: singleton main-agent settings, chat model selection/provenance, project sub-agent selection, and internal tool policy work through backend contracts.
- After EPIC-26: prompts, retrieval, delegation, and file reads obey contextual scope.
- After EPIC-27: the project/general-chat user journeys are usable end to end.
- After EPIC-28: obsolete models/UI are removed and clean-install/CI validation establishes completion.

Do not start with a folder-to-project rename: that would leave authorization tied to agents and encourage project-specific copies of retrieval code. Start with the domain contracts and reusable file memberships.

## Explicit exclusions

Data preservation/migration; backwards compatibility; nested projects; team sharing; per-project provider/model configuration or arbitrary tool settings (project sub-agent selection is included); new retrieval algorithms; a new embedding/caption engine; a new memory engine; automatic cross-chat project memory; wholesale unrelated Agent/runtime rewrites. These require separate estimates if added.

## Verification and planning status

Planning was checked against current backend models, agent prompt construction, retrieval and delegation tools, frontend component locations, existing epic numbering, and repository instructions. This document proposes future work; application tests and runtime gates were not run for the planning-only change. No schema, application code, data, or unrelated untracked files were modified.

The agent/model/internal-tool amendment was reviewed against current AgentProfileModel.model_id/sub_agent, ChatModel.agent_id/allowed_tools, and runtime delegation/model construction. Documentation checklist/link consistency was validated; application gates were not rerun for this planning-only amendment. The earlier US-24.1 verification remains recorded in EPIC-24.
