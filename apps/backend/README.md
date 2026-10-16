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
execution context to live project/chat file IDs, then supplies both that set and the
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

| Method | Path                            | Behavior                                                                  |
| ------ | ------------------------------- | ------------------------------------------------------------------------- |
| POST   | `/api/py/projects/`             | Create; returns 201 and the project                                       |
| GET    | `/api/py/projects/`             | List with page/page_size, sort_by, and query                              |
| GET    | `/api/py/projects/{project_id}` | Read an owned project                                                     |
| PATCH  | `/api/py/projects/{project_id}` | Update supplied fields; expected_context_revision is required in the body |
| DELETE | `/api/py/projects/{project_id}` | Delete; expected_context_revision is required in the query                |

Pagination starts at page 1, defaults to 50 rows, and permits up to 100 per page.
`sort_by` accepts `name` (ascending, default), `created`, or `updated` (newest first),
with UUID tie breaking. `query` searches literal substrings of name/description,
case-insensitively using the relational adapter's comparison semantics; `%` and `_`
are literal characters. Responses include projects, total, page, and page_size.

Prompt changes advance context_revision atomically; unchanged prompts and metadata-only
edits do not. A no-op patch preserves timestamps. This revision tracks runtime context,
not a general metadata edit version. Stale updates/deletes and duplicate names return 409. Reload after a conflict; do not blindly retry using the newer revision.
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
small project-owned reader. `chat/scope.py` exposes it with a chat reader as two injected
snapshot readers (`read_chat_scope_snapshot`, `read_project_scope_snapshot`).

`agent/execution_scope.py` defines the immutable `ExecutionScope`: user, agent (main or
sub-agent), chat, project, selected and executed model identity, eligible project
sub-agent IDs, effective internal tools, active branch, configuration/prompt revisions,
allowed file IDs and file provenance. `resolve_execution_scope` composes the injected
readers (the Agent never queries domain tables). The orchestrator resolves it at turn
start; internal tool calls are clamped to it and still re-check live authorization.
`ExecutionScope.narrow_for_sub_agent` derives a child scope that can only keep the parent's
files and eligible targets and cannot add internal tools. Deleting a project first retires
active runs of its chats (outside the write transaction), then detaches the chats.

`GET /chat/{chat_id}/files/{file_id}/info` and `GET /chat/{chat_id}/files/{file_id}`
recheck that scope and resolve metadata/original bytes by immutable ID through the file
service and FileStore. Runtime attachment assembly uses the same branch/membership
reader before reading cached document content or images. Ownership is checked in both
services and composite database foreign keys. General scope contains no project prompt.

US-25.1 supplies the binding/scope foundation. US-25.2 implements guarded moves,
scoped chat lists, project search, and explicit deletion coordination. US-25.3 implements
draft handling, idempotent acceptance and attachment removal. Project prompt composition and
contextual tool/retrieval/delegation authorization are implemented through
US-26.1/26.2/26.3 and EPIC-29. Agent knowledge-base assignments are removed.
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
Prompt composition and contextual retrieval/delegation are implemented through EPIC-26/29.

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

### Chat drafts, send acceptance and attachment removal (US-25.3)

| API                                      | Purpose                                                                                                                                 |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /chat/drafts`                      | Create an owner-scoped draft; optional `chat_id` binds it to an existing owned chat, otherwise it is for a new chat                     |
| `GET /chat/drafts/{draft_id}`            | Read staged source IDs, unavailable IDs and expiry                                                                                      |
| `POST /chat/drafts/{draft_id}/uploads`   | Ingest library sources and stage their immutable IDs                                                                                    |
| `POST /chat/drafts/{draft_id}/files`     | Stage explicitly selected owned library IDs                                                                                             |
| `DELETE /chat/drafts/{draft_id}/files`   | Remove selected draft references without deleting sources                                                                               |
| `DELETE /chat/drafts/{draft_id}`         | Discard an unsent draft and its references                                                                                              |
| `POST /chat/`                            | Accept a new chat/user message with required `request_id`, optional `draft_id`, and/or explicit `files`                                 |
| `POST /chat/{chat_id}/message`           | Accept a follow-up with required `request_id`, `user_prompt`, explicit nullable `parent_message_id`, optional `draft_id` and/or `files` |
| `DELETE /chat/{chat_id}/files/{file_id}` | Revoke chat-local membership without deleting sources, message snapshots or project memberships                                         |

Draft references grant no runtime access. Drafts expire after 24 hours; access to expired
drafts fails, and creating another draft lazily prunes that owner's expired references.
Discard/expiry preserves library files and extraction generations. Snapshots of selected
IDs survive physical source deletion within an unsent draft, so send rejects an incomplete
set instead of silently dropping a missing file or substituting a same-name replacement.
Remove unavailable selections explicitly before sending. Membership links use composite
owner foreign keys, and services validate the entire owned batch (at most 100 unique
sources across direct and staged selections).

Upload has two phases: source metadata/bytes commit in the existing file service, then
references are staged after rechecking draft ownership/expiry. An expired/discarded draft
or failed staging leaves durable library sources with no runtime grant. Upload failure or
cancellation before source commit rolls back metadata and removes uncommitted bytes.
A processing-dispatch failure after commit preserves the original source. Upload retries
reuse intact same-original-name/same-content IDs even after a display-name collision.

Message acceptance is one relational transaction: history, active-child linkage, local
ChatFile references, owner-scoped send receipt, and draft consumption commit together.
A request UUID identifies one immutable send payload per owner. Retry the same key/body
if acknowledgement is lost; it returns the existing accepted message with current status
and availability. A different payload using that key returns 409. Receipts last until the
chat/message is deleted. Replay does not restore revoked attachments, change branches,
or retroactively regenerate history. Stale parent/branch, an awaiting pending message,
active generation or approval causes a new send to fail with 409. New-chat acceptance
serializes owner writes so concurrent retries produce one chat/message/receipt.

Generation follows acceptance. WebSocket commands use `resume` to reload persisted
history/current scope and generate a pending turn; duplicate resume signals during an
active job do nothing. Reconnect and regeneration reload current persisted history.
Generation failure/cancellation retains accepted history and local memberships; canceled
turns have terminal status and are not restarted by receipt replay/reconnect. Provider
prompt/retrieval/delegation integration is implemented through US-26.1/26.2/26.3 and EPIC-29.

Removal is owner-scoped and rejected during an active run/approval. A no-op repeat is
safe. It revokes the local reference across branches while preserving historical stable-ID
snapshots; `MessageFileReference.available` is response-only current authorization, so
reopened/acknowledged history cannot link a revoked or deleted source. Independent
project membership can still authorize that source. A later deliberate new attachment
can establish a new local membership; receipt replay cannot do so.

Fresh initialization registers `chat_drafts`, `chat_draft_files` and
`chat_send_receipts`. No working database/source storage reset, data migration or
compatibility path was introduced.

### Agent configuration (US-29.1)

User creation atomically provisions one model-free main configuration. A partial
unique owner index and role/model check enforce singleton uniqueness and fixed
worker bindings. Authenticated lifecycle checks ensure existence without writing
when the configuration already exists. `GET/PUT /settings/user/main-agent` exposes
instructions, active registered tools, loop limits (1–100), and supported generation
defaults. Requests reject model/role selection and arbitrary provider overrides.
The user settings aggregate returns `main_agent` and `sub_agents`; there is no
`default_agent_id` or generic main-agent create/delete endpoint.

`GET/POST /agents/sub-agents`, `PUT/DELETE /agents/sub-agents/{id}` manage owned
fixed-model definitions without a product count limit. Creation and edits require
an active catalog model. Disablement preserves the binding and reports
`model_available: false`; runtime rechecks model availability even for cached clients.
Bound model deletion is restricted in storage, and provider deletion requires explicit
rebinding or definition deletion first. Persona/profile invariants are separate.

US-29.2 persists model selection on the chat, independently of main settings. The
user default model is only a new-chat picker prefill; it never retargets existing
chats. Chat creation binds the sole main configuration server-side and rejects
`agent_id` input. Historical message identities and model snapshots remain stable.

These are fresh-schema changes. Use the documented development reset for an existing
local database; no migration or legacy fallback is provided. Story verification uses
temporary databases and does not reset the working database.

### Chat model selection and execution provenance (US-29.2)

`GET /chat/models` exposes platform-catalog model/provider identity, `enabled`,
`authorized`, `available`, context-window provenance and vision capability. All
currently authenticated users share catalog visibility; no provider credentials
are exposed. An empty catalog returns an empty list; disabled entries are explicit.
`NewChatRequest.model_id` is required. There is no first-available selection or
runtime dependency on a user default model.

`PUT /chat/{id}/model` requires an owned chat, an active model and the observed
`expected_model_revision`. Actual changes increment the revision; same-model edits
are no-ops. Model changes, send acceptance and generation starts use the existing
process-local idle guard through transaction completion. Active runs and pending
approvals reject changes. Follow-up sends carry the observed model revision;
acknowledgement replay returns the already accepted message even after selection
changes. Selections retain their UUID and display snapshot after catalog deletion;
reopen reports unavailability without relabeling history or choosing a replacement.

New-chat drafts optionally persist `model_id`. `PUT /chat/drafts/{id}/model` uses
an expected previous model ID, including null. Acceptance validates the choice and
rejects a mismatch without consuming the draft or partially attaching files.
Follow-up drafts use the existing chat selection endpoint instead of another binding.

Before provider execution, the runtime atomically records an execution UUID,
model/provider and capability identity, selection revision, and a complete main
configuration snapshot with its revision on the pending message. Resume uses that
recorded snapshot; explicit regeneration records the current selection/configuration
before changing the active branch. Model identity/capability changes, disablement and
revoked configured tools reject replay with a regeneration action. File
memberships are still revalidated from current authorized scope. Assistant output,
cancelled partial output and stream-start packets carry the actual execution snapshot.
Historical metadata has no model/provider FK that could erase or relabel it.

Context reads expose a recorded pending execution and actionable resume errors;
replay estimates use that snapshot. New turns use the selected model's window/vision
properties and main generation defaults. Sub-agents keep their own required fixed
models; they cannot inherit or override them with the chat selection. These guards
remain single-process like the existing job manager; distributed run locks are outside
this story. Persisted execution snapshots are not durable tool/workflow checkpoints.

Project sub-agent selections use owner-scoped `GET`, `POST`, and `DELETE`
`/projects/{project_id}/sub-agents`. Writes take an atomic `agent_ids` batch and
`expected_context_revision`; General chats cannot delegate. See
[project-selected delegation](../../docs/architecture/agent-runtime.md#project-selected-delegation-us-293)
for runtime revocation, fixed-model and schema initialization behavior.

Delegation and contextual file search are internal tools derived by the server;
users cannot assign or toggle them. Admins retain global enable/disable controls.
Model settings include **Tool calls** support (`supports_tools`); unknown or false
support disables tool schemas. Generic discovery consumes explicit `supports_tools`
metadata and preserves manual overrides. No tool capability is inferred from a
model name. This schema change requires fresh initialization; no migration is run.

### Scoped retrieval and model file reads (US-26.3)

`domains/retrieval/service.py` composes injected scope/artifact, embedding, and vector
readers; `domains/chat/retrieval.py` wires live internal-tool authorization and
owner-scoped extraction selects. `search_knowledge` is a thin adapter. Results keep
file/generation/source citations and revision provenance; empty, revoked, canceled,
or replaced execution scopes fail closed. Authorization and current generation
are rechecked before vector queries and result release.

`RuntimeFileReader` shares the live reader with retrieval and checks converted text
and original image bytes before release. Inline attachment payloads are checked
again before provider calls. Owner-scoped File Manager access is separate from agent
execution access. Image input still requires explicit vision support and bounded
bytes. No new retrieval engine or model download is introduced.

Agent knowledge-base assignment table/API fields/endpoints and settings controls are
removed. Initialize a fresh disposable development database before using this
schema; the verified current database is not reset by the story workflow. Remaining
standalone knowledge-base removal is scheduled for EPIC-28.

Execution and retrieval provenance, resume ceilings, delegated trace privacy, and
future memory partitioning are documented in
[context isolation](../../docs/architecture/context-isolation.md). Project moves
retain chat history; removing source access cannot erase historical answers.
