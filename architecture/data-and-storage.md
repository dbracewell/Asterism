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

    folders ||--o{ folders : "parent_of"
    folders ||--o{ chats : "categorizes"

    chats ||--o{ messages : "contains"

    messages ||--o| messages : "parent_of"
    messages ||--o| messages : "active_child"
    messages ||--o{ sub_agent_traces : "triggers"

    providers ||--o{ models : "provides"
    models ||--o{ agent_profiles : "assigned_to"
    agent_profiles ||--o{ sub_agent_traces : "executes"

    users {
        string id PK
    }

    chats {
        uuid id PK
        string user_id FK
        uuid folder_id FK
        string title
        json allowed_tools
        datetime created_at
        datetime updated_at
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
        json tool_calls
        json tool_call_results
        int token_count
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
- **Branch Traversal**: Clients can inspect siblings (`has_siblings`, `sibling_count`, `current_sibling_index`) and switch branches without destroying alternate histories.

---

## JSONB Columns & Serialization

Asterism provides type-safe JSON serialization directly into SQLite columns using [`JSONB_COLUMN`](../apps/backend/asterism/db/columns.py):

- Supports SQLite 3.45+ native `JSONB` binary formats where supported, falling back cleanly to text JSON.
- Built-in integration with **Pydantic `TypeAdapter`**, ensuring stored JSON is validated and deserialized directly into strong domain types (such as `list[ToolCall]`, `list[ToolResult]`, and `ChatCompletionParams`).

---

## User file storage

Uploaded files are owned by one user and stored through the `FileStore` interface; the current `LocalFileStore` places bytes below `{storage_root}/files/{user_id}`. Metadata, ownership, hash, classification, and bounded processing cache live in `user_files`. `messages.files` stores only typed references, so deleting a file removes its bytes and row without rewriting history; affected historical attachments render as unavailable.

The upload API is authenticated and user-scoped (`POST`, `GET`, and `DELETE /files`). It sanitizes and deduplicates names, rejects configured executable extensions and oversized files, and never exposes another user's bytes or metadata. The repeatable schema migrations create `user_files` and add `messages.files` without modifying existing message content.

## Related Documentation

- [System Overview](README.md)
- [Chat & Real-Time WebSocket](chat-and-websocket.md)
- [Agent Runtime & Execution Loop](agent-runtime.md)
