# Context provenance and isolation

This guide explains what Asterism records about each run without recording its
content, why nothing from one chat leaks into another, and the boundary that a
memory store keeps ([ADR-0078](../adr/0078-long-term-memory.md)). Read it before adding anything that stores,
caches or reuses information across turns or chats.

Execution context is specific to a user, chat, active branch, and optional project.
Reusing a main agent or About you text across chats does not grant access to the other
chat's files, history, prompts, or derived context.

## Content-free provenance

`ContextProvenance` records the user and About you revision, chat/project, root execution/request,
project revision, the main/delegated configuration chain, the selected target set
(project or General, see [ADR-0059](../adr/0059-general-chat-delegation.md)),
selected model, and actual executing model/provider. `scope_revision`
is a deterministic SHA-256 identity over those source identifiers, active branch,
file membership/provenance, and effective internal tools. It contains no file
bodies, instruction text, tool arguments, excerpts, or generated answers.

The main turn stores its source provenance atomically with its private prompt and
configuration snapshot. Reopening/resuming uses that recorded source ceiling;
new files and newly selected delegation targets require a new turn or explicit
regeneration. Live checks still remove revoked access. Regeneration creates a new
execution ID and captures the current context. Delegation preserves the root
identity, selected model/target set, and configuration chain while recording the
child's actual fixed model/provider at client binding. Retrieval responses carry
the same typed provenance alongside their authorized, bounded citations; their
existing `scope.context_revision` describes the live project revision at release.
The execution source revision and live retrieval revision can differ after edits.

A General chat has no project files: its children receive the chat's own
attachments on the active branch, or fewer, never project files.

Delegated audit records store task/context/result digests, message roles, timing,
step/token counts, prompt source digests, and context provenance. They never
store task text, caller notes, message bodies, tool results, or generated answers.
Agent diagnostics record event types and tool counts/names rather than arguments,
responses, or generated content. Normal chat history and authorized retrieval
responses still contain task data; those are distinct from content-free audit
metadata. The authenticated execution contract retains the existing configuration
snapshot for replay; provenance does not duplicate its instruction text.

## Audit of current reuse paths

| Path                                      | Existing boundary / outcome                                                                                                                                                                                                                                                                                                                            |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Conversation history and title generation | Owner-checked chat load and active branch; title generation uses that chat only. No sibling-chat assembly.                                                                                                                                                                                                                                             |
| Private prompt and pending execution      | Stored on an owned message within one chat; project moves invalidate pending prompts. Resume retains recorded file/target ceilings; regeneration captures current scope.                                                                                                                                                                               |
| In-process jobs and outbound queues       | Keyed by globally unique chat ID after owner authorization; bounded and retired on lifecycle changes/deletion. Queued/history content follows the chat on a move.                                                                                                                                                                                      |
| File conversion cache                     | Source-owned file ID; shared knowledge is a file artifact, not a conversation summary. Runtime reads check owner/live membership before and after processing and before provider calls.                                                                                                                                                                |
| Embeddings/captions and vector results    | Source file ID, owner, current artifact generation; authorized file filter precedes vector query, and generation/authorization are checked before release.                                                                                                                                                                                             |
| Web passage summarization/ranking         | Per-call inputs and local result lists; no persistent conversation cache or user namespace.                                                                                                                                                                                                                                                            |
| User-existence/JWT caches                 | Authentication metadata only; no project/chat text.                                                                                                                                                                                                                                                                                                    |
| Long-term memory                          | `memories` rows owned by one user, of kind `user` (about the person, never project content) or `project` (one owned project); vectors in their own `memory_vectors` table. Only the owner reads them. Turns pin the chosen memories (`message_memories`), deleted with the memory; recorded runs keep ids only. Nothing writes memories automatically. |
| Conversation summaries                    | No cross-chat conversation summary integration exists, and About you is never edited by the agent.                                                                                                                                                                                                                                                     |

## Memory boundary

`MemoryNamespace` has three kinds ([ADR-0078](../adr/0078-long-term-memory.md)):

- **`user`** (`MemoryNamespace.for_user`), keyed by the user alone, holds user
  memory only: information about the person (how they learn, accessibility needs
  they shared, background) that applies in every chat and project. It never holds
  project content (facts, files, tasks, answers or decisions from a project), so
  nothing from one project reaches another through the person.
- **`project`**, keyed by user and project, holds that project's memory, used only
  in its chats.
- **`chat`**, keyed by user and a General chat, keys derived caches only
  (`DerivedContextKey`) and no memory: General chats read user memory.

About you edits do not change any namespace. Project namespaces do not authorize
automatic history sharing: a memory is saved only by the person, or by a proposal
they confirm (US-93.4).

`DerivedContextKey.from_scope` additionally includes the source chat ID and scope
revision, so a summary/cache of local history cannot be reused by a sibling chat,
a different branch, a moved chat, or another configuration/model/target set.
Keys are metadata, never capabilities. A future consumer must reauthorize
both writes and reads and recheck source artifact generations before release;
a matching key alone cannot make removed files or deleted projects readable.

## Moves and removal

Moving a chat is an explicit transfer of its existing history and local
attachments. Project deletion detaches its chats and cancels affected active
runs; it does not erase chat history. Neither moving a chat nor removing a file
can unlearn information already quoted, summarized, or generated in historical
messages. Later turns may therefore contain earlier project information through
the transferred history, while live file/retrieval access follows the new scope.
A project memory keeps its project when a chat moves: moves never relabel old
project memory as another project's. Deleting a project deletes its memories;
deleting a chat keeps memories saved from it, whose source then reads "chat
deleted".

The About you revision is captured in execution provenance and the recorded layer
is inherited by children. About you text cannot grant file, tool, delegation or
memory access. Edits preserve accepted inputs; only regeneration picks up the
current text. See [About you](../adr/0066-about-you.md).
