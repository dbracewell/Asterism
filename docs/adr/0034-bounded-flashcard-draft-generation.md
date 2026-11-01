# ADR-0034 — Bounded flashcard draft generation

Status: accepted for US-53.2 on 2026-11-01.

## Context

US-53.2 drafts flashcards from a learner's project files. Every draft must cite
where it came from, generation must stay inside the project's live file scope,
and the work must be bounded. One bad file must not sink the batch. Nothing may
be saved until the learner accepts it ([ADR-0033](0033-study-domain-and-scheduling.md)).

`RetrievalService.search` answers similarity queries for a chat execution scope.
Drafting needs something different: the opening chunks of each chosen file, in
document order, with the same live-scope checks.

## Decision

**A source reader beside the retrieval service.** `retrieval/sources.py` adds
`SourceReader`. Like `RetrievalService`, it receives an injected `read_snapshot`
reader that returns a `RetrievalSnapshot` (authorized files plus artifact
states) and a `VectorStore`. It never touches the database. `read_file(file_id,
max_chars)` re-reads the snapshot before and after reading chunks. It fails that
file (`SourceUnavailable`) when the file has left scope, its artifact is not
ready, its generation changed mid-read, or the vector store errors. Chunks come
from a new `VectorStore.get_file_chunks` call, filtered by owner, file,
generation and ordinal, and are returned in ordinal order up to the character
budget.

**Study composes the reader.** `study/sources.py` builds the snapshot from the
project's live membership (`projects.scope.read_project_context`) and the
current knowledge artifacts. A deleted or foreign project raises 404 on every
read, so revoking a project mid-generation fails closed.

**One model call per file.** `POST
/projects/{project_id}/study/decks/{deck_id}/card-drafts` takes a `model_id`, a
`count` and either `file_ids` or `null` for the whole project scope. The service:

1. checks the model is visible and available to the caller (409 otherwise);
2. reads every chosen file concurrently, each with a fair share of the input
   budget;
3. spreads `count` across the readable files and asks the model for each file's
   share, citing a source label such as `S3` per card;
4. maps labels back to `{file_id, chunk_id, artifact_generation, excerpt}`. An
   unknown label falls back to a file-only citation, so no draft is uncited.

Each file reports `used` or `failed` with a short reason. A failed read, model
error, unreadable reply or timeout affects only that file.

**Limits.** These are module constants, enforced by schema and service:

| Limit                       | Value                                          |
| --------------------------- | ---------------------------------------------- |
| Cards per request           | 1–30                                           |
| Files per request           | 1–10 (whole-project requests over 10 are 400s) |
| Input characters, all files | 60,000, shared equally between files           |
| Chunks read per file        | 200                                            |
| One model call              | 60 seconds                                     |
| Whole request               | 150 seconds; unfinished files fail as timeouts |
| Concurrent model calls      | 3                                              |

**Drafts stay ephemeral.** The response is `Cache-Control: no-store` and nothing
is persisted or logged except counts. Source text and model output are
untrusted: the prompt tells the model to ignore instructions inside sources,
replies are parsed leniently with each field length-checked, and the UI renders
drafts through `MarkdownViewer`. Accepting a draft uses the ordinary card create
route, which re-checks every citation against the live project scope.

## Consequences

- Drafts cover the start of long files; the learner chooses fewer files for
  deeper coverage. Smarter chunk selection can replace the ordinal prefix later
  without changing the API.
- The model is the learner's choice from the chat model list, so plan usage and
  provider costs follow that choice.
- `VectorStore` implementations must provide `get_file_chunks`.
