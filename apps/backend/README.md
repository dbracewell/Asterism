# Asterism Backend (FastAPI)

Requires Python 3.13+, uv, and SQLite 3.45+ for JSONB support.

## Configuration and development

Use only the shared repository-root `.env.example` / `.env`; app-local dotenv files
are rejected. See the root README for the strict portable syntax and initial database
setup. `PUBLIC_URL` controls the public auth identity. JWT issuer
and audience are derived from it. JWKS and webhook requests use loopback port 3000,
not the public hostname. API traffic uses loopback port 8000.

Storage defaults to `/storage`; set an absolute `STORAGE_ROOT` for local development.
`DB_URL` is an optional full SQLAlchemy URL override. `SYSTEM_KEY` must match the
frontend. No separate JWT or frontend URL environment variables are needed.

From the repository root:

```bash
pnpm --filter @asterism/backend sync
pnpm --filter @asterism/backend dev
```

Normally use `pnpm dev` to start both apps. The frontend proxies browser API requests
at `http://localhost:3000/api/py`. Schema: `/api/py/openapi.json`.

The root Dockerfile is the only supported container deployment. No standalone
backend image or per-app Docker configuration is maintained.

## LLM providers and discovery

The admin-only provider discovery endpoint supports canonical OpenAI and Generic
OpenAI-compatible providers. OpenAI always uses `https://api.openai.com/v1`;
Generic OpenAI requires a normalized HTTP(S) base URL. Discovery uses bounded
OpenAI SDK requests, blocks redirects, and returns nullable capability metadata
with field-level provenance. Compatible-provider metadata is best-effort and
unknown or conflicting values require manual administration. See
[LLM Providers and Model Capabilities](../../docs/architecture/llm-providers.md).

## File knowledge processing

An uploaded eligible `UserFile` receives a canonical, versioned
`FileKnowledgeArtifact` and is processed independently of knowledge-base
membership. Knowledge bases are ordered file collections; they neither own
vectors nor trigger repeat extraction. Retrieval first resolves the active
agent's assigned bases to allowed file IDs, then supplies both that set and the
authenticated owner to LanceDB.

The File API exposes artifact status plus retry/cancel processing and image
caption edit, clear, and regeneration actions. The versioned
`knowledge.processing` application setting is the canonical platform-wide policy;
typed processing and captioning endpoints both transition that one value and queue
replacement generations for the eligible library. Only a completed generation
becomes current, so a failed replacement does not replace a usable artifact. See
[Knowledge retrieval](../../docs/architecture/knowledge-retrieval.md) for lifecycle,
automatic embedding provisioning, provider disclosure, and operational details.

## Database initialization

On a fresh installation, from the repository root:

```bash
pnpm --filter @asterism/backend init:db
```

Initialization creates missing model tables, installs SQLite FTS5 search indexes
and triggers, and creates defaults. It can be run repeatedly on the current schema;
it does not upgrade older schemas. The container runs it on every startup before
launching the backend. To intentionally recreate the configured local SQLite database, run
`pnpm --filter @asterism/backend reset:db`, verify the displayed absolute target, and
type `RESET`. A noninteractive reset is canceled unless the internal confirmed command
is invoked through the root `pnpm reset:db -- --yes` workflow.

## Quality checks

From the repository root:

```bash
pnpm --filter @asterism/backend lint
pnpm --filter @asterism/backend typecheck
pnpm --filter @asterism/backend test
```

## Architecture documentation

Comprehensive system design guides and Mermaid sequence diagrams are available in the [`/architecture`](../../docs/architecture/README.md) directory:

- [System Overview](../../docs/architecture/overview.md) — Topology, technology stack, and request lifecycle
- [Tool Authorization & Approval](../../docs/architecture/tool-authorization.md) — Pluggable approval policies, WebSocket human-in-the-loop, and sub-agent sandboxing
- [Agent Runtime & Execution Loop](../../docs/architecture/agent-runtime.md) — Multi-step loops, dynamic system prompts, and streaming deltas
- [Chat & Real-Time WebSocket](../../docs/architecture/chat-and-websocket.md) — Concurrency, `ChatController`, `ChatOrchestrator`, and message queues
- [Data Model & Storage](../../docs/architecture/data-and-storage.md) — High-concurrency SQLite WAL, JSONB columns, and the message tree
- [Knowledge Retrieval](../../docs/architecture/knowledge-retrieval.md) — LanceDB lifecycle, offline model provisioning, and multimodal embedding benchmark
- [Authentication & Security](../../docs/architecture/auth-and-security.md) — BetterAuth, JWKS RS256 token verification, and tenancy


### Project schema (US-24.1)

Fresh initialization includes `projects` and `project_files`. Memberships use composite
owner foreign keys and a unique project/file pair; sources and extraction generations
remain independent. Project lifecycle and owner-consistent chat bindings are available as described below.
See [ADR-0017](../../docs/adr/0017-project-file-and-chat-boundaries.md) for the approved
contracts. Existing databases are disposable: use the verified-target reset workflow
above to recreate them rather than relying on `create_all` to alter existing tables.


### Project lifecycle API (US-24.2)

All project endpoints use the existing JWT/user dependency and owner scope. A foreign
ID returns the same 404 as a missing ID. Project names are trimmed, required, at most
255 characters, and unique per owner with case-sensitive equality. Description and
system prompt default to empty strings (limits: 10,000 and 100,000 characters).
Explicit nulls and unrecognized request-body fields are rejected with 422.

| Method | Path | Behavior |
| --- | --- | --- |
| POST | `/api/py/projects/` | Create; returns 201 and the project |
| GET | `/api/py/projects/` | List with page/page_size, sort_by, and query |
| GET | `/api/py/projects/{project_id}` | Read an owned project |
| PATCH | `/api/py/projects/{project_id}` | Update supplied fields; expected_context_revision is required in the body |
| DELETE | `/api/py/projects/{project_id}` | Delete; expected_context_revision is required in the query |

Pagination starts at page 1, defaults to 50 rows, and permits up to 100 per page.
`sort_by` accepts `name` (ascending, default), `created`, or `updated` (newest first),
with UUID tie breaking. `query` searches literal substrings of name/description,
case-insensitively using the relational adapter's comparison semantics; `%` and `_`
are literal characters. Responses include projects, total, page, and page_size.

Prompt changes advance context_revision atomically; unchanged prompts and metadata-only
edits do not. A no-op patch preserves timestamps. This revision tracks runtime context,
not a general metadata edit version. Stale updates/deletes and duplicate names return
409. Reload after a conflict; do not blindly retry using the newer revision.
`advance_context_revision` is a transaction-local service operation for subsequent
membership changes: call it for a real change, commit memberships and revision together,
and roll the whole transaction back on failure. Bulk no-ops must not advance it.

Deletion removes project metadata and memberships through database cascades and retains
source bytes, extraction generations, and references in other projects. US-25.1
project foreign keys detach chats to General while preserving history/local references.
US-25.2 coordinates explicit detachment in the deletion transaction; US-26.1 adds affected-run
cancellation before project deletion. No current development database was reset. The generated Hey API SDK, schemas, and TanStack Query operations
are synchronized; project UI arrives in EPIC-27.


### Project file membership and original storage (US-24.3)

`GET /projects/{project_id}/files` lists project files through the file service with
`page`, `page_size` (1–100), `sort_by` (`name`, `kind`, `date`, `size`), and literal
filename search in `query`. Database membership filters are applied before pagination.

`POST` and `DELETE /projects/{project_id}/files` accept
`{ "expected_context_revision": 1, "file_ids": ["<uuid>"] }` (1–1000 input IDs).
Both operations validate the entire owner-scoped batch and commit atomically.
Repeated IDs are deduplicated; response `changed_file_ids` and `unchanged_file_ids`
are sorted by UUID. On add, unchanged means already present; on remove, it means
already absent. Actual changes advance the context revision once; no-op batches
preserve it. A stale revision returns 409, including for no-ops. Missing or foreign
projects/files return 404 without partial writes.

File list/detail responses include `projects` summaries (`id`, `name`,
`context_revision`) for removal impact and future file UI. Membership removal keeps
source bytes, extraction, and other references. Physical deletion removes all project
references and advances affected project revisions in the deletion transaction.
Project rename, deletion, and membership changes never copy or move source bytes.

Originals are stored by FileStore under
`files/<encoded-user-id>/<uuid-prefix-1>/<uuid-prefix-2>/<file-id>/source.<ext>`.
Names remain metadata; `storage_key` is an internal opaque key persisted on the file
row and omitted from API schemas. Consumers resolve keys through FileStore, including
downloads, text/document processing, extraction/captioning, and chat vision.
File listings query the database rather than scanning source directories.

This schema/storage change requires a clean development reset of disposable data.
The verified-target `pnpm reset:db` workflow deletes both databases plus source
`files/` and extraction `knowledge/`, while preserving provider bundles in `models/`.
Backend-only reset also clears its source/extraction storage. Ordinary initialization
preserves storage and does not migrate old schemas or paths. No existing development
data was reset while implementing this story.


### Composable list queries

Keep query construction separate from execution, pagination, response enrichment,
and mutations. `domains/files/queries.py::select_owned_files` supplies source ownership,
literal name search, and deterministic file ordering. Project/library callers compose
their membership predicates on that select before executing it. Project scopes do not
add parameters to the library listing service.

`db/queries.py::paginate_select` contains only generic count/page mechanics.
`domains/files/listing.py::list_file_page` enforces owner scope again at execution and
uses separate helpers to enrich only the selected page. The shared database helper
imports no domain models. Keep new domain-specific filters in their owning callers;
avoid a generic query hierarchy or accumulating mode flags in one service function.


### Chat project binding and active-branch files (US-25.1)

Chats use nullable `project_id` (null means General), replacing folder binding.
`POST /chat/` accepts an owned `project_id` and up to 100 stable UUIDs in `files`.
WebSocket `chat` commands also carry UUIDs in `files`; filenames are metadata only.
Missing/foreign files or duplicate attachment IDs reject the whole message/create
operation. Messages and unique owner-consistent `chat_files` references commit together.
No source copy or new extraction generation is created by attachment binding.

Each persisted message attachment includes `file_id` plus its original metadata snapshot.
Deleting a source removes local memberships but retains historical IDs/metadata; reopened
messages mark deleted references unavailable. A new upload with the same filename is a
new source and never replaces an old message's attachment. Parent/active-child edges
must stay within the same chat/owner; services also validate direct-child relationships.

`GET /chat/{chat_id}/files/context` returns the project identity/revision/instructions,
UUID-sorted `allowed_file_ids`, `files` provenance (`project`/`chat` and message IDs),
and `unavailable_file_ids` for active-branch local references without current membership
or source. Only current project memberships plus local references present on the active
message branch count. Inactive branches, sibling chats, unbound message snapshots, and
unselected library files grant no access. The source-ID queries do not load file bodies.
`branches.py` is shared by chat presentation and scope reads; `projects/scope.py` is the
small project-owned reader for future execution context integration.

`GET /chat/{chat_id}/files/{file_id}/info` and `GET /chat/{chat_id}/files/{file_id}`
recheck that scope and resolve metadata/original bytes by immutable ID through the file
service and FileStore. Runtime attachment assembly uses the same branch/membership
reader before reading cached document content or images. Ownership is checked in both
services and composite database foreign keys. General scope contains no project prompt.

US-25.1 supplies the binding/scope foundation. US-25.2 implements guarded moves,
scoped chat lists, project search, and explicit deletion coordination; draft handling,
retry/attachment removal lifecycle remain US-25.3. Project prompt composition and
contextual tool/retrieval/delegation authorization arrive in EPIC-26/29; existing
knowledge-base tool assignments are still present until the planned refactor cutover.
The new scope reader is not a claim that every legacy runtime tool already uses it.

Obsolete folder-chat routes, schemas, creation/list controls, and chat-derived folder
search paths were removed with the binding. US-25.2 replaces folder title search
with project name/description search. Folder entities remain until their later removal; project navigation remains EPIC-27. NewChatRequest rejects old
`folder_id` and filename attachments; PATCH currently edits title only, with project
moves exposed separately by US-25.2. Fresh initialization includes `chat_files`; reset disposable
local data before running this new schema against an older development database.
The current development database was not reset and no migration/fallback was added.


### Chat membership and search (US-25.2)

`PATCH /chat/{chat_id}/project` requires `{ "project_id": "<owned UUID>" }`
or `{ "project_id": null }` for General. Missing/foreign chats or projects return
404; active generation or pending approval returns 409. The process-local job manager
blocks turn starts and competing moves until the transaction commits or rolls back.
This uses the existing single-process runtime boundary, not a distributed run lock.
Moves retain every message, branch and chat-local membership; they never copy sources
or promote attachments into project files. The next scope read exposes the destination
project instructions/revision/files (or empty project context for General), even with a
cached SQLAlchemy chat. Historical answers may still contain prior project information.
Prompt composition and contextual retrieval/delegation remain EPIC-26/29.

`GET /chat/` lists General chats by default. Supply an owned `project_id` to list its
chats. It returns `chats`, `total`, `page` and `page_size` (default 50, maximum 100),
with database filtering before pagination and updated-time/UUID ordering.

`GET /chat/search?q=...` searches chat titles/messages and project names/descriptions
through the database-specific search adapter. `scope=general` returns only General
chats; `scope=project&project_id=...` returns only that owned project's chats. Default
`scope=all` returns chats and projects. Other scopes reject a project ID. Page size
is 20 by default and at most 100. Results expose current `project_id`/`project_name`,
use deterministic updated-time/kind/UUID ordering and enrich only the selected page.
Project system prompts, extracted files, and obsolete folder ancestry are not indexed.
Fresh initialization installs `chat_search`/`project_search` and update/delete triggers;
reset disposable older databases explicitly. No working database was reset for this story.
Project deletion detaches through a chat-owned transaction-local operation before
removing the project; failures/stale revisions roll back both operations.
