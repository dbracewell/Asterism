# Data Model & Storage Architecture

Asterism's persistence layer is engineered for high-concurrency local development and production deployments while maintaining clean abstraction boundaries for future database engine swaps.

---

## Storage Engine Architecture

The backend database system is managed by [`DatabaseSessionManager`](../apps/backend/asterism/db/database.py) using SQLAlchemy 2.0 Asyncio.

```mermaid
flowchart TD
    FastAPIRoute["FastAPI Route / Service"]
    Dep["DBSessionDep / get_async_db_session()"]
    Mgr["DatabaseSessionManager"]
    Engine["AsyncEngine (SQLAlchemy 2.0)"]
    SQLite["SQLite File (WAL Mode)"]

    FastAPIRoute --> Dep
    Dep --> Mgr
    Mgr --> Engine
    Engine --> SQLite

    subgraph PragmaSettings["SQLite PRAGMA Optimizations"]
        WAL["PRAGMA journal_mode = WAL"]
        Sync["PRAGMA synchronous = NORMAL"]
        FK["PRAGMA foreign_keys = ON"]
        Timeout["PRAGMA busy_timeout = 5000"]
        Cache["PRAGMA cache_size = -64000 (64MB)"]
    end

    Engine -.-> PragmaSettings
```

### High-Concurrency SQLite Configuration

Asterism applies production-grade PRAGMA settings upon establishing every raw connection:

1. **Write-Ahead Logging (`WAL`)**: Allows concurrent readers without blocking writers, and writers without blocking readers.
2. **Synchronous Normal (`NORMAL`)**: Drastically reduces filesystem sync operations without risking database corruption in WAL mode.
3. **Foreign Keys Enforcement (`foreign_keys = ON`)**: Ensures cascade deletions (`ondelete="CASCADE"`) work reliably at the SQLite engine level.
4. **Busy Timeout (`busy_timeout = 5000`)**: Waits up to 5 seconds during lock contention rather than immediately failing with `database is locked`.
5. **Memory Cache (`cache_size = -64000`)**: Allocates 64MB of in-memory page cache for lightning-fast queries.

---

## Entity Relationship Diagram (ERD)

```mermaid
erDiagram
    users ||--o{ chats : "owns"
    users ||--o{ folders : "organizes"
    users ||--o{ agent_profiles : "creates"
    users ||--o{ user_settings : "has"
    users ||--o{ sub_agent_traces : "owns"
    users ||--o{ user_files : "owns"
    users ||--o{ knowledge_bases : "owns"
    users ||--o{ file_knowledge_artifacts : "owns"

    folders ||--o{ folders : "parent_of"
    users ||--o{ projects : "owns"
    projects |o--o{ chats : "provides context"
    projects ||--o{ project_files : "references"
    user_files ||--o{ project_files : "is referenced by"
    chats ||--o{ chat_files : "references locally"
    user_files ||--o{ chat_files : "is referenced by"

    agent_profiles ||--o{ chats : "bound to"
    chats ||--o{ messages : "contains"

    messages ||--o| messages : "parent_of"
    messages ||--o| messages : "active_child"
    messages ||--o{ sub_agent_traces : "triggers"

    providers ||--o{ models : "provides"
    models ||--o{ agent_profiles : "assigned_to"
    agent_profiles ||--o{ sub_agent_traces : "executes"
    agent_profiles ||--o{ agent_knowledge_base_assignments : "is assigned"
    knowledge_bases ||--o{ knowledge_base_files : "contains"
    user_files ||--o{ knowledge_base_files : "is referenced by"
    user_files ||--o{ file_knowledge_artifacts : "produces"
    knowledge_bases ||--o{ agent_knowledge_base_assignments : "is assigned"

    users {
        string id PK
    }

    chats {
        uuid id PK
        string user_id FK
        uuid project_id FK
        uuid agent_id FK
        string title
        json allowed_tools
        datetime created_at
        datetime updated_at
    }

    projects {
        uuid id PK
        string user_id FK
        string name
        text description
        text system_prompt
        int context_revision
    }

    project_files {
        uuid project_id PK,FK
        uuid file_id PK,FK
        string user_id FK
    }

    chat_files {
        uuid chat_id PK,FK
        uuid file_id PK,FK
        string user_id FK
    }

    messages {
        uuid id PK
        string user_id FK
        uuid chat_id FK
        uuid model_id
        string status
        uuid parent_message_id FK
        uuid active_child_id FK
        string role
        text content
        text thinking
        json files
        json tool_calls
        json tool_call_results
        int input_tokens
        int output_tokens
        int total_tokens
        int generation_duration_ms
        datetime created_at
    }

    folders {
        uuid id PK
        string user_id FK
        string title
        uuid parent_id FK
    }

    agent_profiles {
        uuid id PK
        string user_id FK
        uuid model_id FK
        bool sub_agent
        string name
        string description
        text system_prompt
        int max_steps
        json chat_parameters
        json tools
    }

    providers {
        uuid id PK
        string name UK
        string base_url
        string api_key
    }

    models {
        uuid id PK
        string name
        bool is_active
        uuid provider_id FK
    }

    user_files {
        uuid id PK
        string user_id FK
        string filename
        string original_name
        int size
        string mime_type
        string kind
        string sha256
        string content_status
        string content_error
        text content_cache
        datetime created_at
        datetime updated_at
    }

    knowledge_bases {
        uuid id PK
        string user_id FK
        string name
        string description
    }

    knowledge_base_files {
        uuid id PK
        uuid knowledge_base_id FK
        uuid file_id FK
        int position
    }

    file_knowledge_artifacts {
        uuid id PK
        string user_id FK
        uuid file_id FK
        int generation
        int processing_profile_generation
        string status
        bool is_current
        int chunk_count
        string caption_status
        text caption_text
    }

    agent_knowledge_base_assignments {
        uuid id PK
        string user_id FK
        uuid agent_id FK
        uuid knowledge_base_id FK
        int position
    }

    user_settings {
        string user_id PK
        string key PK
        json value
    }

    app_settings {
        string key PK
        json value
    }

    tools {
        uuid id PK
        string name
        string description
        text content
    }

    sub_agent_traces {
        uuid id PK
        string user_id FK
        uuid parent_message_id FK
        uuid sub_agent_id FK
        string sub_agent_name
        text prompt
        text caller_context
        json messages
        text result
        int step_count
        int total_tokens
        int elapsed_ms
        int depth
        datetime created_at
    }
```

---

## Search indexes

SQLite FTS5 virtual tables, `chat_search` and `project_search`, provide
owner-scoped keyword search over chat titles/persisted message text and project
names/descriptions. Project prompts, attachments and extracted file content are not
indexed. Fresh initialization installs indexes and insert/update/delete triggers.
The adapter accepts up to ten quoted word terms joined with `AND`; user input is
never passed through as FTS syntax. The search service rechecks owner predicates,
filters General/project chat scope before database pagination, sorts mixed results
by updated time/kind/UUID, and enriches only the selected page with current project
identity and snippets. Project search replaces folder search and ancestor traversal.

## Chat binding, context, and message tree

Each chat stores an `agent_id` foreign key to the main profile selected at creation.
The service rejects sub-agent bindings and uses the user's valid default only when
the client did not select one. Existing chats retain their binding, and a main
agent cannot be deleted or converted to a sub-agent while a chat references it.

Messages retain provider-reported `input_tokens`, `output_tokens`, `total_tokens`,
and `generation_duration_ms`. The UI's preflight context meter is not persisted
usage: it is an estimate assembled from the active thread, system prompt, tool
schemas, text attachments, and accepted images.

## The Message Tree Model

Asterism models conversation history as a **directed acyclic tree** rather than a flat linear list.

```mermaid
graph TD
    User1["User Msg 1 (id: M1)"]
    Assistant1["Assistant Msg 1 (id: M2, parent: M1)"]

    User2["User Msg 2 (id: M3, parent: M2)"]

    Assistant2A["Assistant 2 (Attempt A) (id: M4, parent: M3)"]
    Assistant2B["Assistant 2 (Attempt B - Regenerated) (id: M5, parent: M3)"]

    User1 --> Assistant1
    Assistant1 --> User2
    User2 --> Assistant2A
    User2 -->|active_child_id points here| Assistant2B
```

### Tree Capabilities

- **Regeneration without Data Loss**: When the user requests regeneration, the original assistant response is kept in the database with its tool calls and reasoning. The parent message's `active_child_id` is simply pointed to the newly generated child message.
- **Cancellation without Data Loss**: Explicit cancellation marks the active user message cancelled. If output had already streamed, a cancelled assistant child retains that partial content and thinking.
- **Branch Traversal**: Clients can inspect siblings (`has_siblings`, `sibling_count`, `current_sibling_index`) and switch branches without destroying alternate histories.

---

## JSONB Columns & Serialization

Asterism provides type-safe JSON serialization directly into SQLite columns using [`JSONB_COLUMN`](../apps/backend/asterism/db/columns.py):

- Supports SQLite 3.45+ native `JSONB` binary formats where supported, falling back cleanly to text JSON.
- Built-in integration with **Pydantic `TypeAdapter`**, ensuring stored JSON is validated and deserialized directly into strong domain types (such as `list[ToolCall]`, `list[ToolResult]`, and `ChatCompletionParams`).

---

## User file storage and model input

Uploaded bytes pass through the `FileStore` protocol; `LocalFileStore` currently
places them below `{storage_root}/files/{user_id}`. The `user_files` table records
ownership, sanitized and original names, MIME/kind classification, SHA-256, and a
bounded processing cache. `messages.files` stores typed snapshots/references rather
than a relational foreign key, so deleting a file removes its bytes and row without
rewriting history; affected historical attachments render as unavailable.

The authenticated, user-scoped API provides `POST /files`, paginated `GET /files`,
`GET /files/{filename}`, and `DELETE /files/{filename}`. Uploads sanitize names,
reject configured executable extensions and oversized input, and never expose
another user's bytes or metadata. An intact existing object with the same user,
sanitized filename, and SHA-256 is reused. Different bytes receive filename collision
suffixes; deduplication never crosses users or filenames.

On first attachment, `MarkItDownFileProcessor` reads text directly where possible
or converts supported documents in a worker thread. Processing is bounded by input
size, timeout, and converted-character limits; its status and safe error message are
stored on the file. Chat builds document/text cache into text parts. Image bytes are
included only for models whose `supports_vision` capability is explicitly `true` and
only below the configured vision limit; unknown capability is intentionally treated
as non-vision. See [LLM providers](llm-providers.md#file-input-capability-gating).

## File-owned knowledge artifacts

`file_knowledge_artifacts` holds the versioned derived state for an immutable
`user_files` revision: extraction cache, chunk/embedding readiness, canonical
caption metadata, safe error state, and whether the generation is current. The
database permits one current generation per file. A pending replacement cannot
displace a ready generation; it becomes current only after processing and its
vector writes complete.

`knowledge_base_files` is deliberately a small ordered membership table. It has
no processing state, vectors, or caption fields, so one library file can appear
in multiple private bases without repeat work. Agent assignments point to bases,
and retrieval resolves those memberships to allowed file IDs before issuing its
LanceDB query. File deletion explicitly cancels work and removes memberships and
artifacts before source bytes; membership deletion removes only the relationship.
See [Knowledge retrieval](knowledge-retrieval.md) for runtime and operator
behavior.

## Related Documentation

- [System Overview](overview.md)
- [Chat & Real-Time WebSocket](chat-and-websocket.md)
- [Agent Runtime & Execution Loop](agent-runtime.md)


## Project/chat source references (US-25.1)

Chats bind to zero or one owned project, with General represented by null. ProjectFile
and ChatFile are unique owner-consistent references to independent source rows; they do
not own bytes or extraction generations. Message JSON attachment snapshots include
immutable file IDs and metadata, so source deletion cannot make an old filename refer
to a later upload. Composite keys constrain message and branch-edge ownership.

The active branch is traversed once through shared chat-domain logic. Its local file
IDs must also appear in current ChatFile memberships and owned source rows; project
memberships supply the other allowed set. Sibling/inactive-branch/unselected library
files are excluded. The chat file scope API exposes source provenance and project
revision/instructions; scoped source downloads and attachment assembly use that reader.
Full prompt/tool/retrieval integration remains in EPIC-26/29.

Original bytes remain in user-scoped, file-ID-sharded FileStore storage. Organization is
relational; source consumers resolve opaque keys and listings query the database.
Deleting a source removes memberships while retaining message snapshots for unavailable
history. Project deletion sets chat project_id to null and preserves local references.
Guarded moves and explicit lifecycle coordination are implemented in US-25.2.


## Draft references and durable message acceptance

US-25.3 adds ChatDraft (owner, optional target chat, fixed 24-hour expiry and selected-ID
snapshot), ChatDraftFile (unique owner-consistent source membership) and ChatSendReceipt
(owner/request UUID, payload fingerprint and owner-consistent chat/message acknowledgement).
The draft snapshot is data, not an authorization grant: consumption validates all live
source owners and memberships again. It retains unavailable IDs after physical deletion,
so an incomplete draft cannot silently send a partial set. Draft discard/lazy expiry
cleans references, never source bytes/generations. Message/chat deletion cascades receipts;
target-chat deletion cascades its unsent drafts.

Source ingest commits before draft staging; cancellation/expiry between them can leave a
library source without granting any chat access. Message acceptance commits user history,
branch linkage, local references, receipt and draft consumption together. Request replay
returns that accepted message's current status/availability and cannot rebind revoked files
or switch branches. New-chat creation serializes owner writes for duplicate-request races;
follow-up acceptance/removal share the process-local idle-change gate with moves. The DB
write lock and explicit parent check detect concurrent branch changes before mutation.

Socket generation resumes persisted pending messages after reloading current history and
scope. Cancellation is terminal but preserves references; regeneration uses the current
persisted branch/memberships. Response-only file availability prevents historical snapshots
from authorizing removed/deleted files. Project membership is independent of local removal.
Extraction bytes/state remain owned by Files/Extraction. No migration or old API fallback
is added; full execution context/prompt/retrieval work remains EPIC-26/29.
