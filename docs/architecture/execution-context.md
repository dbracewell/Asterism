# Execution context

This guide explains what one turn is allowed to use, and where each part comes
from: the prompt's layers, the files it may read, the sub-agents it may call. It
also explains why a turn's access is fixed when it starts and checked again at
every use. Read it before changing anything that feeds a run: prompts, project or
chat files, delegation, or the code that reads them.

## Concepts

- **An execution** is one run of the main agent or of a sub-agent. Each has its
  own UUID and a private, immutable record of its inputs (`chat_executions`).
- **The execution file scope** is the set of files an execution may read. It is
  worked out when the execution starts and stored with it, so it acts as a
  ceiling: later checks can remove files from it, but nothing can add to it.
- **The delegation set** is the list of sub-agents a turn may call: the project's
  selected sub-agents in a project chat, or the General chat set on the main agent
  in a General chat ([ADR-0059](../adr/0059-general-chat-delegation.md)).
- **A prompt layer** is one labeled part of the system prompt, such as the agent's
  instructions or the project's instructions.
- **Pinned** means copied onto the user's message when it is accepted, so that
  later edits don't change it: About you text, the learning mode, skills and a
  rubric are pinned.
- **A live check** rereads current data at the moment of use, on top of the stored
  ceiling.

## How it works

### What a turn is made of

The `PromptComposer`
([`agent/prompts.py`](../../apps/backend/asterism/domains/agent/prompts.py)) builds
the system prompt from these layers, in this order:

| Layer           | Contains                                                                                                                 | Comes from                                                  |
| --------------- | ------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------- |
| `platform`      | Fixed platform rules, including that user content is data                                                                | The server                                                  |
| `agent`         | The main agent's or sub-agent's instructions                                                                             | User settings, by revision                                  |
| `profile`       | The user's About you text, framed as information about them; left out when empty                                         | Pinned on the message                                       |
| `mode`          | The learning mode's instructions and hint level; main agent only                                                         | Pinned on the message ([learning modes](learning-modes.md)) |
| `task`          | Server-owned text for a special-purpose chat; today only skill drafting ([ADR-0061](../adr/0061-skill-drafting-runs.md)) | The server                                                  |
| `project`       | The project's instructions                                                                                               | The project, by revision                                    |
| `skills`        | The skills the user switched on with `/`; main agent only                                                                | Pinned on the message ([skills](skills.md))                 |
| `skill_catalog` | The names of a sub-agent's assigned skills, which it can open with `load_skill`                                          | The sub-agent's assignments                                 |
| `runtime`       | The tools this run may use and the sub-agents it may call, up to 8,000 characters                                        | Worked out for this run                                     |

Order sets precedence: the agent's role and what the user says about themselves
come first, and project text refines the task within them. Everything the user
types, every file and every search result is task data, which the platform rules
tell the model to treat as content, not instructions.

No layer grants anything. What the model can actually do is decided by the
effective tool set and the execution file scope, which are enforced in code, not
by the prompt ([tool authorization](tool-authorization.md)).

The same composition is used for the context-usage estimate, the main run,
sub-agents and replays, so they never disagree about what a turn contains.

### Which files a turn may use

A turn's files are worked out on the server from where the chat is:

- **In a project chat:** the project's current files, plus the files attached to
  messages on the chat's active branch.
- **In a General chat:** only the files attached on the active branch.

Each file must also still belong to the user and still exist. Files staged in an
unsent draft give no access. Owning a file in the library gives no access either:
a file is available to a turn only through a project or an attachment.

Attachments are recorded on messages by file ID, which never changes. If a file is
deleted and another is uploaded with the same name, old messages don't start
pointing at the new one.

### Which sub-agents a turn may call

The delegation set comes from where the chat is, read live: a project chat uses
the project's selected sub-agents, and any other chat uses the General chat set.
Both start empty. Each target must still be owned by the user and have its fixed
model available. A sub-agent called during the turn inherits the caller's file
scope and delegation set, or a narrower one, never a wider one.

Moving a chat into or out of a project changes its delegation set, so delegation
is refused until a new turn records the new one.

### Tracing one turn

```mermaid
sequenceDiagram
    participant UI as Browser
    participant Send as Sending (REST)
    participant Run as Chat execution
    participant Scope as Project and chat readers
    participant Agent
    participant Retrieval as RetrievalService
    participant Vector as Vector store

    UI->>Send: Message, model revision, draft, file IDs
    Send->>Send: Check ownership; store message and receipt
    UI->>Run: WebSocket: resume
    Run->>Scope: Read active branch, project, files, delegation set
    Scope-->>Run: File scope and sub-agent targets
    Run->>Run: Compose prompt; record the execution
    Run->>Agent: Run with scope, model, file reader, retrieval
    Agent->>Retrieval: search_knowledge within the scope
    Retrieval->>Scope: Recheck files and their processing
    Retrieval->>Vector: Search, filtered by user and allowed file IDs
    Vector-->>Retrieval: Candidate passages
    Retrieval->>Scope: Recheck again before release
    Retrieval-->>Agent: Bounded passages with citations
```

A worked example: Sam asks a question in their _Biology 101_ project chat, with a
lab report attached to the message.

1. **Sending** checks that Sam owns the chat, the project and the lab report, and
   stores the message with the report attached and the current About you text,
   learning mode and skills pinned.
2. **The execution** reads the active branch and the project. The file scope is the
   project's three lecture notes plus the lab report. The delegation set is the
   project's selected _Citation checker_ sub-agent.
3. **The prompt** is composed from Sam's main-agent instructions, About you, the
   Tutor mode, the project's instructions and a runtime layer listing
   `search_knowledge` and `sub_agent`. The execution, with its file scope, is
   stored before the model is called.
4. **The model asks to search.** `search_knowledge` passes the query to the
   retrieval service, which checks that the four files are still in the chat's
   scope, searches only those four, and checks again before returning passages.
5. **Meanwhile, Sam removes a lecture note from the project** in another tab. The
   next search, and the release of any passage from that note, fail the live check.
   The note can't come back into this turn, even if Sam adds it again: the
   execution's ceiling is fixed.
6. **The model calls _Citation checker_.** The sub-agent runs with the same four
   files (now three), its own fixed model and its own tools, and no learning mode.

To follow this in the code, read these in order:

1. [`chat/sending.py`](../../apps/backend/asterism/domains/chat/sending.py): accepts
   the message, its receipt and its draft in one transaction.
2. [`chat/execution.py`](../../apps/backend/asterism/domains/chat/execution.py),
   [`chat/execution_context.py`](../../apps/backend/asterism/domains/chat/execution_context.py)
   and [`chat/prompt_composition.py`](../../apps/backend/asterism/domains/chat/prompt_composition.py):
   assemble the model, configuration, prompt and recorded context.
3. [`chat/scope.py`](../../apps/backend/asterism/domains/chat/scope.py): the readers
   that return `ChatScopeSnapshot` and `ProjectScopeSnapshot`.
   [`agent/execution_scope.py`](../../apps/backend/asterism/domains/agent/execution_scope.py)
   combines them without importing any storage code.
4. [`chat/tool_policy.py`](../../apps/backend/asterism/domains/chat/tool_policy.py)
   and [`chat/delegation.py`](../../apps/backend/asterism/domains/chat/delegation.py):
   the effective tools and the delegation set.
5. [`agent/agent.py`](../../apps/backend/asterism/domains/agent/agent.py): the loop,
   which receives `ExecutionScope`, a `RuntimeFileReader` and a `RetrievalService`
   rather than querying projects or chats itself.
6. [`chat/retrieval.py`](../../apps/backend/asterism/domains/chat/retrieval.py) and
   [`chat/runtime_files.py`](../../apps/backend/asterism/domains/chat/runtime_files.py):
   wire live file checks into
   [`retrieval/service.py`](../../apps/backend/asterism/domains/retrieval/service.py)
   and [`files/runtime_access.py`](../../apps/backend/asterism/domains/files/runtime_access.py).

### Resume, regenerate and revocation

The stored execution decides what a replay may use:

- **Resume** continues a turn with its recorded model, configuration, prompt,
  file scope and delegation set. It can lose access that was revoked meanwhile; it
  can never gain files or sub-agents added since.
- **Regenerate** records a new execution under the chat's current settings, files
  and mode. Earlier turns keep their own records.
- **Every read rechecks.** `read_execution_files` checks the user, the model and
  provider, the request and execution, the active branch, the chat's project and,
  for a sub-agent, its configuration and selection, then intersects the current
  files with the ceiling. Retrieval checks again after searching and releases only
  passages from current, authorized processing results.

An empty scope, a changed identity, a revoked sub-agent or failed processing each
produce an explicit "unavailable" or error state. Nothing falls back to a wider
scope or another model.

### About you on a turn

When a user sends a message, Asterism copies their current About you text onto it
(`accepted_about`). The copy cannot change afterwards: a database trigger refuses
updates. So editing About you never changes the context an earlier answer was
given ([ADR-0066](../adr/0066-about-you.md)).

- **Resume** continues an interrupted turn, so it uses the copy on that turn.
- **Regenerate** asks for a fresh answer, so it reads the user's current text.
- **A sub-agent** called during the turn receives the same text as the main agent,
  through `ExecutionScope.about_layer`, and gains no capabilities from it.

An empty About you adds nothing to the prompt. Execution records
(`MessageExecution.about`, `ContextProvenance.about_revision`) store only the
revision, never the text, and public chat responses never include it.

### Moving and deleting

- **Moving a chat** to another project, or to General, keeps its history and its
  attachments and changes the project files and delegation set of later turns. It
  is refused while a run or an approval is in progress.
- **Deleting a project** cancels its running work, moves its chats to General and
  removes its file and sub-agent selections. The library files stay.
- **Deleting a file** removes every reference to it, cancels its processing, and
  deletes its processed text, vectors and bytes.

None of these can erase what earlier answers already said. A moved chat's history
may contain information from its old project, even though later turns can no
longer search those files.

### Module boundaries

The turn's inputs come from several domains, and each owns its part:

| Domain               | Owns                                                                                                    | Others use it through                                                     |
| -------------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `projects`           | Projects, their revision, file and sub-agent selections                                                 | Its `queries.py`, lifecycle services and the project scope reader         |
| `chat`               | Chats, messages and branches, model selection, drafts, receipts, attachments, the execution composition | Owner-checked scope readers and the composition roots                     |
| `files`              | Uploaded files, their metadata and storage keys                                                         | `FileStore`, `RuntimeFileReader`, its owned queries and its source reader |
| `knowledge`          | Processing results, embeddings, captions, the vector store and processing policy                        | The published artifact service and the embedding and vector interfaces    |
| `agent`              | Main agent and sub-agent configuration, `ExecutionScope`, prompts, the loop                             | Injected scope, model client, file reader and retrieval service           |
| `retrieval`          | Bounded, authorized search with citations                                                               | `RetrievalService`, given a live scope                                    |
| `tools`              | The registry and tool catalog                                                                           | `ContextToolScope` and the checks at each call                            |
| `skills`, `learning` | Skill documents and assignments; the learning-mode catalog                                              | Pinned snapshots and named authorization readers                          |

Three rules keep these boundaries:

- **The agent never reads domain tables.** It receives readers and services from
  the chat composition roots. Policy stays with the domain that owns the data.
- **Queries are built where the data lives.** Each domain's `queries.py` builds
  owner-scoped selects; callers add filters before pagination. Shared
  `db/queries.py` holds only domain-neutral helpers such as pagination.
- **`files` and `knowledge` depend on each other in one direction only.** `files`
  uses the knowledge domain's published artifact service
  ([`knowledge/artifacts.py`](../../apps/backend/asterism/domains/knowledge/artifacts.py)).
  `knowledge` never imports `files`: it reads sources through the contract in
  [`knowledge/sources.py`](../../apps/backend/asterism/domains/knowledge/sources.py),
  which `files` implements and the application installs at startup. A test
  enforces both directions.

## Rules

- A turn's file scope and delegation set are worked out on the server and stored
  with the execution. Resume can shrink them, never grow them.
- Every read and every delegation rechecks access against current data.
- Owning a file grants nothing; only a project or an attachment does.
- A sub-agent's scope is its caller's or narrower.
- Prompt layers, pinned text and file content never grant tools, files or
  sub-agents.
- A matching record, key or cache entry is never treated as permission.

## Extending

A new consumer of turn context must accept injected, owner-scoped readers and keep
both the stored ceiling and the live checks. A new provider (of files, embeddings,
vectors or models) implements the existing interface rather than reading project or
chat membership itself.

## Related

- [Agent runtime](agent-runtime.md): the loop that uses this context
- [Tool authorization](tool-authorization.md): the effective tool set
- [Learning modes](learning-modes.md): the mode layer and mode policy
- [Context provenance and isolation](context-isolation.md): what is recorded and
  what stays private
- [ADR-0017](../adr/0017-project-file-and-chat-boundaries.md): the project, file and
  chat contracts
