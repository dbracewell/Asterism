# ADR-0017: Project, file, chat, and execution boundaries

- **Status:** Accepted; current decisions consolidated 2026-10-17 after confirmed US-28.1
- **Original decision date:** 2026-10-14
- **Decision owners:** Asterism maintainers
- **Scope:** [Projects and Chat Context Refactor](../plans/projects-and-chat-context-refactor.md)

## Context

Workspace instructions, file ownership, model selection, agent configuration, and
execution authorization need distinct owners. The completed cutover uses private
projects, General/project chats, immutable library files, one model-free main
configuration per user, and separately owned fixed-model sub-agent definitions.
Superseded collection domains and selectable-main contracts are removed. This ADR
records current accepted behavior; dated story evidence remains in the epic and
[completed checklist archive](../archive/todo-completed-2026-10-17.md).

## Decisions

### Projects and source ownership

Projects are flat, private, and owner-scoped. Names are trimmed, required, at most
255 characters, and unique per owner with case-sensitive equality. Description and
system prompt are non-null strings that may be empty. Nested/shared projects and
per-project model, tool, provider, or embedding settings are outside this refactor.

`context_revision` starts at 1. Prompt, file-membership, and selected-sub-agent
changes increment it atomically; no-op batches and metadata-only changes do not.
Lifecycle writes compare `expected_context_revision`. It is a context version, not
a universal metadata edit version. Batch membership validation is owner-scoped and
atomic, returning changed/unchanged IDs in deterministic UUID order.

`ProjectFileModel` keys `(project_id, file_id)` and records owner/timestamps.
Composite foreign keys to both parent identities enforce owner consistency at the
database boundary. It stores no bytes, extraction state, ordering, or provider policy.
`ProjectSubAgentModel` provides the corresponding owned target selection boundary.

Files own immutable source identity, metadata, and opaque FileStore keys. Originals
use `files/<user-id>/<id-prefix-1>/<id-prefix-2>/<file-id>/source.<ext>` in the local
adapter. Callers use FileStore rather than deriving paths from names. Extraction
owns per-file generations, embeddings, canonical captions, vector state, and jobs.
References share this work across projects/chats; membership changes never move or
copy source bytes. Separate uploads are not content-deduplicated across users.

### Chat, draft, and active-branch scope

A chat belongs to one project or General (`project_id=null`). It owns history,
branch selection, local file references, model selection, and execution snapshots.
Project scope combines current project files with active-branch local references;
General has only the local set. Library ownership and draft staging grant no runtime
access. No sibling-chat history is automatically assembled.

Messages snapshot immutable file IDs and display metadata. Current memberships,
owned source rows, and the active branch determine availability. Physical deletion
preserves historical IDs/unavailable snapshots; filename reuse cannot retarget them.
Chat uploads remain local unless deliberately added to a project. Project uploads
create project membership.

Draft references expire after 24 hours. Discard/expiry removes references while
preserving potentially shared library sources. Send acceptance validates exact
visible/persisted file selection and commits history, active-child linkage, local
references, a fingerprinted owner-scoped request receipt, and draft consumption in
one transaction. Receipt replay acknowledges existing work without reattaching files
or executing a duplicate turn. REST accepts messages; WebSocket resumes persisted
pending execution and streams results.

### Main configuration, models, and delegation

Each user has exactly one model-free main-agent configuration, provisioned with
the user in one transaction. Database uniqueness and role/model checks enforce
this invariant; services reject independent main deletion/conversion. Main settings
contain instructions, explicit ordinary capabilities, loop limits, and supported
bounded generation defaults. Persona/profile defaults remain a separate invariant.

Chats persist model UUID/snapshot and positive selection revision independently.
The user default model only prefills a picker. Revision-guarded changes and send
acceptance validate active availability and reject changes during active work.
Unavailable selections retain their identity. Actual execution model/provider,
configuration, and context/prompt provenance remain attached to historical turns;
changing a picker does not rewrite past answers.

Sub-agent definitions each bind one model. Disabled models keep bindings and expose
unavailability; provider/model deletion requires explicit rebinding/removal, backed
by restrictive foreign keys. New projects select no targets. Delegation requires
live owned project selection, available fixed model, matching context/configuration,
and bounded recursion. General never delegates. Children inherit the file ceiling
and cannot widen internal tool scope; their ordinary capabilities come from their
own active configuration. Deselection/revocation is checked during in-flight work.

### Context, prompts, and runtime access

`ExecutionScope` combines injected chat/project readers with server-derived model,
configuration, file provenance, target set, and effective internal tools. The chat
composition roots assemble scope and providers. Agent and retrieval consumers do
not own project/chat membership queries.

Prompt layers are `platform`, `agent`, optional `profile`, optional `project`, and
bounded `runtime`. Mandatory platform/capability rules and authoritative agent/explicit
profile constraints limit project refinements and user requests. Files, retrieved
passages, and forwarded history are untrusted task data. Layer order never grants
capabilities. Estimation, execution, delegation, and replay share the composer;
private snapshots retain inputs while public provenance records source digests.
Current chat composition supplies no persona layer and records no persona identity.

`search_knowledge` and `sub_agent` are internal context-managed tools. Availability
requires admin policy, explicit model tool support, and relevant live file/target
scope. User tool selection and approval preferences cannot grant them. Ordinary
capabilities remain configured allowlists with interactive main-agent approval and
autonomous child allowlist enforcement. Approval cannot widen effective capabilities.

`RetrievalService` receives injected live scope, embeddings, vectors, and limits.
Its tool adapter has no membership queries or ingestion logic. Vector queries filter
by owner and authorized file IDs before search. Runtime file reads and retrieval
revalidate execution/model/branch/project identity and live memberships; release
checks also enforce current artifact generation. Images require explicit vision
support and bounded source reads. Scope ceilings can narrow but cannot expand.

Resume reuses the persisted execution/model/configuration/prompt and file/target
ceilings. It rechecks current authorization and rejects revoked identities rather
than substituting a model. Explicit regeneration captures current context as a new
execution. A process restart does not continue an interrupted provider connection.

### Lifecycle, history, and memory limits

Moves retain history/local references, reject active work, and change context on
later turns. Project deletion cancels affected runs, detaches chats to General, and
removes memberships while preserving library sources/artifacts. Physical source
deletion cancels work and removes references, artifacts, vectors, and bytes through
the file lifecycle; database cascades do not perform filesystem/vector cleanup.
Historical messages may retain prior project information; revocation cannot erase
information already quoted in a conversation.

Content-free execution provenance and delegated audit digests do not duplicate raw
instructions, task text, tool results, or generated answers. Normal authorized chat
history remains content-bearing. There is no active long-term memory store,
automatic memory read/write, or sibling-chat summary integration. Future namespace
and derived-cache key types partition project-derived data by project, General data
by chat, and local derived context additionally by source chat/scope revision.
Keys are not authorization; future consumers must reauthorize reads and writes.

## Dependency direction and initialization

Owner-scoped base selects belong in the owning `queries.py`. Callers add membership,
search, and ordering before pagination; returned-page enrichment and lifecycle
mutations are separate functions. Shared database helpers contain only neutral
query mechanics. Project/file/extraction models do not import workspace aggregates;
`db.base` registers models at initialization, outside ingestion.

Backend initialization creates the current schema and FTS indexes. Breaking changes
use explicit disposable resets, without data migrations, compatibility routes,
aliases, dual writes, or legacy source-path fallbacks. Full reset removes backend/auth
SQLite, originals, extraction/vector storage while preserving verified model bundles.
Ordinary initialization remains nondestructive. See [reset operations](../architecture/development-reset.md).

## Consequences and evidence

Contributors extend narrow domain readers/adapters rather than adding workspace
flags to library services or duplicating ingestion. Prompt, file, model, target, and
revision provenance make replay reproducible without freezing revoked access.
Process-local runtime guards are retained; this decision introduces no distributed
lock manager, sharing model, memory engine, or extra provider implementation.

Current implementation is traced in [execution context](../architecture/execution-context.md),
[agent runtime](../architecture/agent-runtime.md), and
[project workspaces](../architecture/project-workspaces.md). Story gates and known
static-analysis limitations are recorded separately in
[EPIC-28](../epics/EPIC-28-CLEAN-CUT-REMOVAL-AND-VALIDATION.md).
