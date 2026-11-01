# Execution context and module boundaries

A project supplies task instructions, source references, and selected delegation
targets. A chat supplies history, an active branch, local attachments, and model
selection. The runtime composes these through domain readers; library ownership
alone never grants an execution access to a file.

## Ownership and dependencies

| Module      | Owns                                                                                                 | Consumer boundary                                                                                 |
| ----------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `projects`  | Private flat projects, context revision, file and sub-agent memberships                              | `queries.py`, lifecycle services, project scope reader                                            |
| `chat`      | Project binding, model selection, messages/branches, drafts, receipts, local references              | Owner-checked scope readers and runtime composition roots                                         |
| `files`     | Immutable sources, metadata, opaque storage keys, source reading for the knowledge domain            | `FileStore`, `RuntimeFileReader`, owned base selects, the source reader                           |
| `knowledge` | Derived generations, embeddings, captions, vector adapter, bounded jobs, the whole processing policy | Artifact queries, the published artifact service, embedding/vector interfaces, policy transitions |
| `agent`     | Main/sub configuration, immutable execution scope, prompts, bounded loop                             | Injected scope, client, file reader, retrieval service                                            |
| `retrieval` | Authorized bounded search and citations                                                              | `RetrievalService` with injected live scope, embeddings, vectors                                  |
| `tools`     | Registry, ordinary capability catalog, internal tool adapters                                        | Server-derived `ContextToolScope` and invocation checks                                           |

Build owner-scoped selects in the owning domain's `queries.py`. Apply membership,
search, and sort predicates before database pagination, then enrich the returned
page. Shared `db/queries.py` handles domain-neutral pagination only. Keep query
construction, execution/enrichment, and mutations separate. Do not add workspace
flags to the general library listing function.

Project/file/knowledge models do not import the aggregate model registry.
`db.model_registry` is the registration root used for fresh initialization. Agent scope and
prompt types do not query project tables. The chat composition roots inject
readers; domain policy stays at the storage/service boundary that owns it.

The knowledge and files domains depend on each other in one direction only. The
files domain consumes the knowledge domain's published artifact service
(`knowledge/artifacts.py`) and never reaches into the artifact model, the
artifact queries, or the ingestion runtime. The knowledge domain never imports
the files domain: it reads its sources through the narrow contract in
`knowledge/sources.py`, whose implementation the files domain provides and the
application installs at startup. An import-boundary test enforces both
directions.

## Skills execution

The [private skills domain](skills.md) owns document CRUD and explicit main-agent
assignments. Admin activation policy and owner/assignment checks govern eligible
metadata discovery and execution. Chat acceptance pins ordered branch-local skill
snapshots; composition injects them after project instructions. Resume and
regeneration preserve the source turn's snapshots with live eligibility checks.
The Agent consumes injected snapshots and named chat authorization readers rather
than querying skill tables/services/policy directly. Delegates do not inherit them.

## Trace one turn

```mermaid
sequenceDiagram
    participant UI as Browser
    participant Send as Chat REST acceptance
    participant Run as Chat execution root
    participant Scope as Project/chat readers
    participant Agent as Agent
    participant Retrieval as RetrievalService
    participant Vector as VectorStore
    UI->>Send: request_id, model revision, draft, file IDs
    Send->>Send: Owner-check; persist turn and receipt atomically
    UI->>Run: WebSocket resume
    Run->>Scope: Read active branch, project, memberships, model/configuration
    Scope-->>Run: Server-derived file and target ceiling
    Run->>Run: Compose prompt and execution provenance
    Run->>Agent: Inject scope, model, file reader, retrieval
    Agent->>Retrieval: Search within execution scope
    Retrieval->>Scope: Recheck live authorization and current artifacts
    Retrieval->>Vector: Query filtered by owner and allowed file IDs
    Vector-->>Retrieval: Candidate chunks
    Retrieval->>Scope: Recheck scope and generations before release
    Retrieval-->>Agent: Bounded excerpts and citations
```

Start with these files, in order:

1. [Sending](../../apps/backend/asterism/domains/chat/sending.py) accepts a
   fingerprinted, owner-scoped request and consumes its draft in the same
   transaction as messages, references, and receipt.
2. [Execution](../../apps/backend/asterism/domains/chat/execution.py),
   [execution provenance](../../apps/backend/asterism/domains/chat/execution_context.py),
   and [prompt composition](../../apps/backend/asterism/domains/chat/prompt_composition.py)
   assemble recorded model/configuration, instruction sources, and context identity.
3. [Scope readers](../../apps/backend/asterism/domains/chat/scope.py) expose
   `ChatScopeSnapshot` and `ProjectScopeSnapshot`.
   [resolve_execution_scope](../../apps/backend/asterism/domains/agent/execution_scope.py)
   combines their file provenance and eligible targets without storage imports.
4. [Tool policy](../../apps/backend/asterism/domains/chat/tool_policy.py) derives
   effective tools; [delegation](../../apps/backend/asterism/domains/chat/delegation.py)
   validates current project targets and fixed-model availability.
5. [Agent](../../apps/backend/asterism/domains/agent/agent.py) consumes injected
   `ExecutionScope`, `RuntimeFileReader`, and `RetrievalService`.
   [search_knowledge](../../apps/backend/asterism/domains/tools/builtin/search_knowledge.py)
   is a thin adapter, without membership queries or embedding logic.
6. [Retrieval composition](../../apps/backend/asterism/domains/chat/retrieval.py)
   injects [live execution file authorization](../../apps/backend/asterism/domains/chat/runtime_files.py)
   into [RetrievalService](../../apps/backend/asterism/domains/retrieval/service.py).
   Inline model-facing reads use [RuntimeFileReader](../../apps/backend/asterism/domains/files/runtime_access.py)
   with that same authorization boundary.

## Scope, replay, and revocation

Project chats see current project files plus local references on the active branch.
General sees only active-branch local references and has no delegation targets.
Draft references grant no runtime access. Stored message snapshots use immutable
file IDs; removing a source cannot retarget them to a newly uploaded filename.

An execution records a file/target ceiling, branch, model, configuration revision,
project revision, and instruction provenance. Resume uses that recorded execution;
it can lose revoked access but cannot acquire newly added files or targets.
Explicit regeneration captures a new execution under current selection and context.
Prompt edits apply to new execution snapshots; live authorization remains mandatory
for recorded snapshots too.

`read_execution_files` validates owner, model/provider identity, request/execution,
active branch, chat project, and delegated configuration/selection, then intersects
live references with the ceiling. Retrieval rechecks after embedding/vector work
and releases only current authorized generations. Empty scopes, changed identity,
revoked targets, and failed processing are explicit unavailable/error states.

Moves retain history and local references, change future project context, and are
blocked during active runs or approvals. Project deletion cancels affected work,
detaches chats to General, and removes memberships while preserving library files.
Physical deletion revokes all references, cancels jobs, and cleans artifacts,
vectors, and source bytes. Historical answers may still contain earlier quoted
information; revocation cannot erase that history.

## Extension constraints

A new consumer must accept injected owner-scoped readers and preserve the immutable
ceiling plus live rechecks. A new provider must implement existing file, embedding,
vector, or LLM interfaces rather than query workspace memberships itself. A matching
provenance or cache key is never an authorization grant.

See [agent runtime](agent-runtime.md), [tool authorization](tool-authorization.md),
[context and memory isolation](context-isolation.md), and
[ADR-0017](../adr/0017-project-file-and-chat-boundaries.md) for the remaining contracts.

## Persona binding

Each accepted user message captures an owned persona ID, name, revision and private
USER.md input. Chat selection is either a fixed owned persona or the current user
default. Resume uses captured inputs; regeneration captures current settings.
Immutable `chat_executions` records store private prompts and public metadata.
Messages separately reference their producing execution and any execution they
start, preserving both when an assistant response is regenerated. Owner/chat
composite foreign keys prevent cross-scope references. Public chat responses never
serialize USER.md. Deleting a recorded persona revokes pending/running access;
historical messages retain provenance. Children inherit the root persona without
expanding capabilities. No memory store is activated. See
[ADR-0021](../adr/0021-personas-and-execution-binding.md).

## Learning modes

A chat stores its current learning-mode selection and revision. Each accepted user
turn pins a snapshot of the selected server-owned mode: ID, name, version and
instruction text. Composition order is
`platform → agent → profile → mode → project → skills → runtime`. A first run uses
the pinned snapshot; resume reuses the recorded prompt; regeneration captures the
current selection. The mode ID must still be in the catalog when a run starts or
resumes. Execution provenance records the mode's ID, name and version, never its
text. Delegates do not inherit the mode, and mode text grants no capabilities. See
[ADR-0028](../adr/0028-learning-mode-layer.md).

### Hint levels

Each user turn records the branch hint level (`none`, `nudge`, `hint`,
`worked_example`, `answer`). The active branch's latest user turn sets the current
level, so branches keep separate levels. A send raises the level only through an
explicit `hint` request, which the current mode must offer; the answer level
needs `confirm_reveal`. The pinned mode snapshot includes the level's
instructions and records the applied level in provenance. Regeneration keeps the
turn's level under the current mode. Tutor offers every level; Review my work
offers only `answer`, its confirmed corrected-solution reveal. See
[ADR-0029](../adr/0029-branch-local-hint-levels.md).

### Attempts in Review my work

Review mode adds no attachment path of its own. Attached files reach the model
through the normal chat attachment flow: text inline under an `Attached file:`
heading, images as image parts on vision models, and a short notice when a
file is unavailable or not included. The mode text tells the model to review
that content as the learner's attempt and to treat it as work, not
instructions, in line with the platform rule that file contents are untrusted
task data.

### Structured feedback

A mode may define fixed feedback sections. Explain-back defines three, in order:
`correct` ("What you got right"), `gaps` ("What was missing or wrong") and
`follow_up` ("Follow-up questions"). The mode text tells the model to use these
exact Markdown headings after the learner explains, and not to use them
otherwise. `GET /learning-modes` serves the section IDs and headings (never the
instruction text), so the UI renders each section from the catalog rather than a
copy. Replies that do not start with the first heading render as plain Markdown.
The streaming `start` event's execution carries the mode, so sections render
while the reply streams. See [ADR-0030](../adr/0030-structured-feedback-sections.md).
