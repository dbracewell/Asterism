# ADR-0017: Project, file, and chat boundaries

- **Status:** Accepted; US-24.1 completion confirmed 2026-10-14
- **Date:** 2026-10-14
- **Decision owners:** Asterism maintainers
- **Scope:** [Projects and Chat Context Refactor](../plans/projects-and-chat-context-refactor.md)

## Context

Folders and standalone knowledge bases currently split workspace navigation from task instructions and file access. Projects will supply instructions and file memberships while existing file storage and extraction continue to own source bytes and reusable generations. This decision records the ten roadmap assumptions approved by the user on 2026-10-14 and the subsequent same-day agent/model/internal-tool amendment. The amendment is planned in EPIC-29 and US-27.4/27.5; it does not expand the implemented US-24.1 schema.

## Decisions and contracts

1. Projects are flat, private, and user-owned. Name is required, at most 255 characters, and unique per owner with case-sensitive equality. Services will trim names and reject whitespace-only input; the database rejects empty/space-only names and excessive length. Description and system prompt are non-null strings that may be empty. Nested projects, sharing, and per-project model/tool/provider configuration are excluded.
2. `ProjectModel` owns UUID identity, `user_id`, name, description, system prompt, a positive `context_revision` starting at 1, and existing integer timestamp conventions. Prompt and membership changes increment the revision atomically in later lifecycle services; clients do not set it. US-24.2 requires expected_context_revision on PATCH and DELETE and uses atomic revision comparisons. Prompt changes advance it; unchanged prompts and metadata-only edits do not. It is a context revision, not a general metadata edit version. US-24.3 will commit actual membership changes and the transaction-local revision operation together; no-op batches do not advance it.
3. `ProjectFileModel` is an unordered association keyed by `(project_id, file_id)`, with a required owner and timestamps. Composite foreign keys to `(id, user_id)` on both projects and files make cross-owner links impossible even in direct database writes. Parent candidate keys are explicitly unique. No extraction state, bytes, ordering, agent assignments, or generic container abstraction belongs on this association.
4. Files own source metadata and bytes through FileStore; extraction owns per-file generations, chunks, embeddings, captions, and jobs. One file can belong to several projects/chats without another source write or generation. Membership changes do not move source bytes. US-24.3 stores originals under user-scoped, file-ID-sharded FileStore keys, persisted on source rows and hidden from public schemas. Names are metadata; all source consumers resolve opaque keys through FileStore. Membership APIs require an expected context revision, validate whole owner-scoped batches, and return UUID-sorted changed/unchanged IDs. No-op batches retain their revision; stale requests fail.
5. Chats belong to zero or one project; null means General. Chats own local file associations and message-to-file provenance by stable ID. Runtime scope is project files plus explicit local attachments on the active branch, or only active-branch attachments in General. A library listing never grants runtime access. Chat uploads remain local unless deliberately added to a project; project uploads create project membership.
6. Each user has exactly one main-agent configuration edited in user settings, independent of model choice. Chats select their main model; sub-agent definitions each bind one model. Projects explicitly select eligible owned sub-agents, while General never delegates. This replaces the earlier assumption that all agents retain a model binding and that no project-agent selections exist. Remove knowledge-base assignments; keep capability restrictions and derive internal delegation/retrieval tools from authorized context and settings. Project sub-agent selection does not grant wider file access or arbitrary tool access. Runtime consumes injected project/chat readers and composed scope rather than querying their membership tables directly.
7. Prompt composition preserves mandatory platform rules/capability restrictions, authoritative agent role and explicit profile constraints, project task refinement, and user requests. File text is data. Estimates, execution, delegation, and replay share the composer. Layer order is insufficient for security. Prompt changes apply next turn with source/revision provenance; file access is revalidated for each tool call, and revocation cancels/rejects affected work.
8. Moving a chat retains history and local attachments, changes project context next turn, and is rejected during an active run. The UI must explain that past answers can retain prior project information. No authorization check can erase that historical information.
9. Project deletion cancels affected runs, detaches chats to General, and removes memberships while preserving source files/extraction. Removing a membership preserves all other references and generations. Physical-file deletion removes all memberships and derived artifacts through the existing file-service lifecycle. Database cascades enforce reference cleanup; they do not perform filesystem/vector cleanup. Chat detachment/run cancellation arrives with chat/runtime integration, not this schema story.
10. No implicit access to sibling-chat history. Existing memory paths must scope project-derived data by project and General-derived data by chat; if no active path exists, define the boundary without building a memory engine or project conversational memory.

## Dependency direction

Projects own metadata and memberships and expose a small context reader. Chats own history, branch provenance, and local references. Execution context composes injected readers; prompt/retrieval consumers use that scope and existing file/extraction providers. The composition root registers models and assembles services. Project models import only database primitives, with string foreign-key references; file and extraction models import no projects or chats. Extraction must not import the aggregate model registry (`db.base`), which would pull workspace models into ingestion.

Existing extraction captioning depends on a knowledge-base configuration schema, but no project/chat models. Removing the old knowledge-base configuration/module dependency is tracked in the later clean-cut story. Do not broaden this story into runtime restructuring.

## Fresh initialization and verification

Register the new models in `db.base`, used by initialization and isolated fixtures. `Base.metadata.create_all` creates project tables and ownership keys on a fresh database. Do not migrate or silently repair existing schemas: reset disposable databases explicitly when required, using the existing reset workflow. This story tests initialization/reset only in temporary storage and does not reset the working development database.

Schema tests exercise production SQLite foreign-key settings, direct invalid writes, duplicate memberships, shared files, membership/project deletion preserving generations, source/owner cascades, and the extraction import boundary. US-24.1 introduced no public API changes. US-24.2 registers owner-scoped lifecycle routes and regenerates OpenAPI-derived clients with required revision guards. API, chat binding, runtime, and UI work stay in their assigned stories; obsolete modules are removed in EPIC-28.

US-24.3 also makes explicit reset clear source and extraction storage together with the database, preserving provider model bundles. Ordinary initialization remains nondestructive. No legacy-path fallback or migration is supplied.

US-24.3 review amendment: compose owner-scoped source selects in the file domain's
`queries.py`, with project/library membership predicates supplied by their callers.
Share only domain-neutral count/pagination mechanics in `db/queries.py`. Query building,
page execution, enrichment, and lifecycle mutations have separate functions; adding a
new workspace scope must not expand the library listing function's parameter list.
This responsibility rule is recorded in AGENTS.md for subsequent stories.

US-25.1 implements owner-consistent ChatFile memberships and message snapshots with
required immutable file IDs. Message ownership/parent/active-child foreign keys share
the chat identity/owner; services validate that selected active children are direct
children. A shared deterministic branch reader supplies both presentation and file
provenance. Source deletion cascades memberships while historical JSON snapshots keep
the original IDs/metadata; filename reuse cannot retarget those snapshots.

The chat scope reader combines project source IDs with active-branch local snapshot IDs
intersected with current ChatFile memberships and owned sources. It exposes project
instructions/revision and per-source origin/message provenance to subsequent execution
context work. Scoped metadata/download endpoints and attachment assembly consume this
reader now. General has no project prompt or project file set. Legacy knowledge-base
tool authorization is replaced in EPIC-26/29, not by declaring this reader sufficient
for every existing runtime path.

Chat project binding uses a single project FK with SET NULL plus a composite owner FK,
so deleting a project detaches chat identity while preserving owner, history, and local
references. US-25.2 implements explicit transaction-local detachment and guarded moves/search;
US-26 adds run cancellation and prompt/retrieval integration. Old folder-chat bindings
and their immediate callers are removed now, without compatibility adapters. Folder
entities remain until their assigned cutover story; US-25.2 replaces title search with project name/description search.


US-25.2 serializes membership moves against process-local generation starts for the
entire relational transaction and rejects active runs/pending approvals. No persisted
or distributed run-lock abstraction is introduced ahead of runtime context work.
Owned base selects live in their domain queries.py; mixed indexed search filters and
paginates in SQL before page-only response enrichment. Current scope readers refresh
cached membership identity; a move changes the next resolved project context without
rewriting history or promoting local attachments. Project deletion checks its revision
under a write lock, detaches via the chat-owned boundary, and commits both changes
atomically. Runtime cancellation and project prompt composition remain US-26.1.


### US-25.3 lifecycle decision

Draft staging and source ownership are separate. Uploads are durable owner-library sources;
unsent references expire after 24 hours and never grant runtime scope. Discard/expiry
removes references without deleting a potentially shared source. Keep selected-ID snapshots
alongside live draft memberships so physical source deletion is explicit at send rather
than silently omitting input. Composite foreign keys enforce reference ownership.

User sends require an owner-scoped request UUID and persist a fingerprinted receipt with
the accepted chat/message. Accept history, active-child linkage, local memberships, receipt
and draft consumption in one transaction; replay an acknowledgement without reattaching
files or executing the old turn. The socket handles generation of persisted pending turns
through resume, not unacknowledged message creation. Reload branch/memberships for reopen
and regeneration. Distinguish canceled terminal turns from retryable pending execution.
Removal revokes local access across branches, preserves immutable historical snapshots,
and leaves independent project memberships and original sources intact.

The current composer awaits persistence and retains successful upload IDs for failed-send
retry. Rich server-draft/picker/removal UI remains US-27.3. This provides lifecycle contracts
without starting that UI story or EPIC-26's prompt/tool/retrieval integration.

### US-29.1 singleton configuration boundary

Main and delegated configurations retain one storage identity table for existing
trace and knowledge-assignment references, with distinct public editing contracts.
A partial unique owner index permits one main row; a role/model check requires no
model for that row and exactly one model for each worker. User creation provisions
both rows in one transaction. Conflict-safe provisioning handles concurrent creation,
while existing-user checks avoid an unnecessary write lock. Services never delete
or convert the main configuration. Separate persona/profile defaults are unchanged.

Main settings accept only supported bounded generation fields and active registered
capability names. The tools domain exposes registration names through a dependency-free
catalog, so configuration validation does not import invocation/settings infrastructure.
Stored unavailable capability choices remain visible in settings; runtime filters active
capabilities and rejects chat/approval grants outside the configuration allowlist. Worker model disablement retains its UUID and exposes availability;
provider deletion requires explicit rebinding/removal, with restrictive model FKs as
backstop. There is no automatic worker model replacement or worker count limit.

Main runtime receives an explicitly selected user default model separately from its
configuration for this story. It refreshes instructions/limits before the next turn
and revalidates a model before using a cached client. Persisted chat model selection,
project-selected workers, and derived internal tools remain the subsequent EPIC-29
stories. Existing caller adjustments do not declare US-27.4/27.5 complete. Fresh-schema
verification uses disposable isolated databases; the working database is retained.

### US-29.2 chat selection and execution snapshots

Model choice belongs to the chat, with a positive selection revision and an explicit
new-chat model ID. The user default is a picker prefill only. Catalog visibility is
currently platform-wide for authenticated users; model availability checks stay at
execution/mutation boundaries. Removed/disabled selections retain identity and expose
an unavailable state. There is no implicit replacement, model FK that erases history,
or main-agent model binding.

Selection updates use expected revisions and the existing idle-change guard through
relational commit; send acceptance checks the observed revision. Provider execution
starts under the job guard and snapshots actual model/provider/capabilities, selection
revision and the versioned main configuration. A pending private execution record
survives reconnect/process restart. Resume reuses it; explicit regeneration validates
and stores a new snapshot before altering the branch. Revoked capabilities or changed
model identity/capabilities reject replay rather than silently substituting settings.
Current source/attachment authorization still applies to replay. Multi-step assistant
parents may be regenerated without changing their original executed-model metadata.

Every persisted assistant/partial answer and stream-start packet carries the actual
execution. Estimates for pending replay apply the recorded configuration/model, and
an unavailable replay has an explicit regeneration error. Sub-agent model bindings
remain distinct; project selection/internal-tool derivation are subsequent stories.
No distributed runtime-lock framework, migration, compatibility API, or working-data
reset is introduced. The present model controls are caller integration for US-29.2;
they do not mark the broader US-27.5 UI complete.
