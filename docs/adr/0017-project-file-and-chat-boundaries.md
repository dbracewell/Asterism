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
references. US-25.2 adds explicit lifecycle coordination and guarded moves/search;
US-26 adds run cancellation and prompt/retrieval integration. Old folder-chat bindings
and their immediate callers are removed now, without compatibility adapters. Folder
entities/title search remain until their assigned cutover stories.
