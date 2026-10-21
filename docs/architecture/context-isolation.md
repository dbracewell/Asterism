# Context provenance and memory isolation (US-26.4)

Execution context is specific to a user, chat, active branch, and optional project.
Reusing a main agent or persona across chats does not grant access to the other
chat's files, history, prompts, or derived context.

## Content-free provenance

`ContextProvenance` records user/profile, chat/project, root execution/request,
project revision, the main/delegated configuration chain, the selected project
target set, selected model, and actual executing model/provider. `scope_revision`
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

Delegated audit records store task/context/result digests, message roles, timing,
step/token counts, prompt source digests, and context provenance. They no longer
store task text, caller notes, message bodies, tool results, or generated answers.
Agent diagnostics record event types and tool counts/names rather than arguments,
responses, or generated content. Normal chat history and authorized retrieval
responses still contain task data; those are distinct from content-free audit
metadata. The authenticated execution contract retains the existing configuration
snapshot for replay; provenance does not duplicate its instruction text.

## Audit of current reuse paths

| Path                                        | Existing boundary / outcome                                                                                                                                                              |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Conversation history and title generation   | Owner-checked chat load and active branch; title generation uses that chat only. No sibling-chat assembly.                                                                               |
| Private prompt and pending execution        | Stored on an owned message within one chat; project moves invalidate pending prompts. Resume retains recorded file/target ceilings; regeneration captures current scope.                 |
| In-process jobs and outbound queues         | Keyed by globally unique chat ID after owner authorization; bounded and retired on lifecycle changes/deletion. Queued/history content follows the chat on a move.                        |
| File conversion cache                       | Source-owned file ID; shared knowledge is a file artifact, not a conversation summary. Runtime reads check owner/live membership before and after processing and before provider calls. |
| Embeddings/captions and vector results      | Source file ID, owner, current artifact generation; authorized file filter precedes vector query, and generation/authorization are checked before release.                               |
| Web passage summarization/ranking           | Per-call inputs and local result lists; no persistent conversation cache or profile namespace.                                                                                           |
| User-existence/JWT caches                   | Authentication metadata only; no project/chat text.                                                                                                                                      |
| Long-term memory and conversation summaries | No active memory store, automatic memory writes/reads, persona-memory retrieval, or cross-chat conversation summary integration exists.                                                  |

## Typed future boundary

`MemoryNamespace.from_scope` partitions by user and optional profile plus **project
ID for project-derived memory**, or **chat ID for General-derived memory**. No
profile-only partition is offered. Project namespaces do not authorize automatic
history sharing; an actual future integration must define explicit write policy.

`DerivedContextKey.from_scope` additionally includes the source chat ID and scope
revision, so a summary/cache of local history cannot be reused by a sibling chat,
a different branch, a moved chat, or another configuration/model/target set.
These types implement no storage, retrieval, automatic writes, or new memory
engine. Keys are metadata, never capabilities. A future consumer must reauthorize
both writes and reads and recheck source artifact generations before release;
a matching key alone cannot make removed files or deleted projects readable.

## Moves and removal

Moving a chat is an explicit transfer of its existing history and local
attachments. Project deletion detaches its chats and cancels affected active
runs; it does not erase chat history. Neither moving a chat nor removing a file
can unlearn information already quoted, summarized, or generated in historical
messages. Later turns may therefore contain earlier project information through
the transferred history, while live file/retrieval access follows the new scope.
Future memory integration must retain the original namespace on existing entries;
moves must never relabel old project-derived memory as another project's memory.
