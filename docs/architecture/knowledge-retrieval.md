# Knowledge retrieval

This guide explains how a turn uses the user's processed files: how
`search_knowledge` finds passages, how attached files are read into the prompt,
how features that work through a whole file read it in order, and the checks that
keep every one of these inside the turn's allowed files. Read it before changing
retrieval, file reads at run time, or anything that returns file content to a model.
[File knowledge processing](file-knowledge-processing.md) explains how files become
searchable in the first place.

## Concepts

- **The execution file scope** is the set of files a turn may read, fixed when the
  turn starts ([execution context](execution-context.md#which-files-a-turn-may-use)).
- **The live scope** is the set of files the chat could use right now: the project's
  current files and the active branch's attachments. A read must be allowed by both
  the stored scope and the live one.
- **`RetrievalService`** searches processed files. It doesn't know about chats,
  projects or tools; the chat code gives it a reader for the live scope, an
  embedding provider and a vector store.
- **`RuntimeFileReader`** reads whole files into the prompt, under the same checks.
- **A hit** is one passage returned by a search, with the file, chunk and
  generation it came from.

## How it works

### Searching with `search_knowledge`

When the model calls `search_knowledge`, the tool validates its arguments and
passes the query to the `RetrievalService`
([`retrieval/service.py`](../../apps/backend/asterism/domains/retrieval/service.py))
with the turn's `ExecutionScope`. The tool has no database access of its own. The
service then:

1. **Works out which files to search.** It intersects the stored scope with the live
   scope and keeps only files whose current generation is ready and has text
   embeddings. An empty set returns no results, and a scope of more than
   `MAX_KNOWLEDGE_ALLOWED_FILES` (1,000) files is refused.
2. **Embeds the query** with the same CLIP model used for the files.
3. **Searches LanceDB filtered by user and by those file IDs.** The vector store has
   no search without both filters, so it is never searched globally and filtered
   afterwards.
4. **Checks again before releasing anything.** Every hit must belong to the user,
   to a file still in scope, and to a generation that was ready when searched and is
   still current now. A hit from a generation replaced during the search is dropped.
5. **Returns bounded results:** at most `MAX_KNOWLEDGE_QUERY_TOP_K` (10) hits, with
   excerpts sharing `MAX_KNOWLEDGE_RESULT_BYTES` (16 KiB), cut on UTF-8 boundaries.
   The limits hold even if the vector store returns too many.

Each hit names the file, chunk and generation, whether it matched the text or a
caption, and how the file reached the turn (project file or attachment, with the
message). The response also records the chat, project, agent and model, and both
the context revision the turn started with and the current one.

If embedding or the vector store fails, the service still checks access again and
returns "unavailable", so an outage can never hide a revocation.

Hits feed claim citations: the model can cite a passage it retrieved with an
`asterism-cite:` token, and the server resolves it only against that run's hits
([agent runtime](agent-runtime.md#grounded-answers)).

### Reading attached files into the prompt

Attachments and project files are also included directly, as text or images, when
a turn starts. `RuntimeFileReader`
([`files/runtime_access.py`](../../apps/backend/asterism/domains/files/runtime_access.py))
does these reads through the same live-scope reader as retrieval
([`chat/runtime_files.py`](../../apps/backend/asterism/domains/chat/runtime_files.py)):

- It checks the agent and model, the project, the active branch, that the turn
  hasn't been cancelled or replaced, and, for a sub-agent, its selection and
  configuration.
- It checks before converting or reading bytes, and again after, so a file removed
  during a slow conversion isn't sent.
- Content prepared earlier is checked again before every model request.
- Image bytes are bounded by both the file's recorded size and the bytes actually
  read, and are sent only to models marked as supporting vision. Other models get a
  short note instead ([LLM providers](llm-providers.md#file-input-capability-gating)).

File content always goes into the user or tool part of the conversation, as data,
never into the system prompt.

### Reading a file in order

Some features work through a whole file rather than searching it, such as drafting
flashcards from a chapter. `SourceReader`
([`retrieval/sources.py`](../../apps/backend/asterism/domains/retrieval/sources.py))
reads a file's opening chunks in document order through
`VectorStore.get_file_chunks`. Like `RetrievalService`, it takes a live-scope reader,
and stops with "unavailable" if the scope, the file's readiness or its generation
changes during the read ([ADR-0034](../adr/0034-bounded-flashcard-draft-generation.md)).

### Revocation

Because every read checks the live scope, access ends as soon as it is removed:

- Removing a file from a project, or the attachment's message from the active
  branch, stops later searches and reads in a running turn.
- Deleting a file removes its vectors, so there is nothing left to find.
- Changing the chat's project, or a sub-agent's selection, fails the identity
  checks.

What a model has already been sent can't be taken back. Earlier answers keep
whatever they quoted.

## Rules

- Every search and every file read must be allowed by both the turn's stored scope
  and the chat's live scope.
- The vector store is only ever searched with a user filter and a file filter.
- Results are checked again before release, and limited in number and size.
- Only the current, ready generation of a file is searched.
- A failure never widens access or skips a check.
- Owning a file grants nothing at run time; the library and background processing
  are owner-scoped management, not turn reads.

## Where the code lives

1. [`retrieval/service.py`](../../apps/backend/asterism/domains/retrieval/service.py):
   search, checks and limits.
2. [`chat/retrieval.py`](../../apps/backend/asterism/domains/chat/retrieval.py): builds
   the service for a turn, with its limits and live-scope reader.
3. [`chat/runtime_files.py`](../../apps/backend/asterism/domains/chat/runtime_files.py):
   the live-scope checks shared by search and file reads.
4. [`files/runtime_access.py`](../../apps/backend/asterism/domains/files/runtime_access.py):
   `RuntimeFileReader`.
5. [`retrieval/sources.py`](../../apps/backend/asterism/domains/retrieval/sources.py):
   ordered reads.
6. [`tools/builtin/search_knowledge.py`](../../apps/backend/asterism/domains/tools/builtin/search_knowledge.py):
   the tool, a thin adapter.

## Related

- [File knowledge processing](file-knowledge-processing.md)
- [Execution context](execution-context.md)
- [Tool authorization](tool-authorization.md)
- [ADR-0017](../adr/0017-project-file-and-chat-boundaries.md): project, file and chat
  boundaries
