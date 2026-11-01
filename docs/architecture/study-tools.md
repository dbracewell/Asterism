# Study tools (EPIC-53)

The `study` backend domain turns project material into study records. Decisions
are recorded in [ADR-0033](../adr/0033-study-domain-and-scheduling.md).

## Decks and cards (US-53.1)

Decks belong to one user and one project; cards belong to one deck. Composite
foreign keys pin each row to its owner, and deleting a project (or its user)
deletes its decks and cards.

| Route                                                               | Behavior                                                |
| ------------------------------------------------------------------- | ------------------------------------------------------- |
| `GET /projects/{project_id}/study/decks`                            | Deck page with `card_count`; newest update first        |
| `POST /projects/{project_id}/study/decks`                           | Create (`name` 1–120, `description` ≤ 2,000)            |
| `GET`/`PATCH`/`DELETE /projects/{project_id}/study/decks/{deck_id}` | Read, partial update (no nulls), delete with its cards  |
| `GET /projects/{project_id}/study/decks/{deck_id}/cards`            | Card page in creation order, citations resolved         |
| `POST /projects/{project_id}/study/decks/{deck_id}/cards`           | Create (`front`, `back` 1–4,000; up to 8 `citations`)   |
| `GET`/`PATCH`/`DELETE …/cards/{card_id}`                            | Read, partial update (an empty `citations` list clears) |

A foreign or missing project, a deck reached through another project and a card
reached through another deck all return 404.

A citation is `{file_id, chunk_id?, artifact_generation?, excerpt?}`. Writes
require every cited file to be a live member of the project (400 otherwise).
Reads add `available` and `file_name`; a file that left the project or was
deleted stays listed as unavailable. Card text and excerpts are untrusted and
render through `MarkdownViewer`.

The project overview lists decks under **Study decks**. Each deck opens at
`/projects/{projectId}/study/{deckId}`, where the learner edits the deck and
adds, edits and deletes cards. Editing a card keeps its citations.

## Card drafts (US-53.2)

`POST /projects/{project_id}/study/decks/{deck_id}/card-drafts` takes
`{model_id, count, file_ids}` and returns `{drafts, files}` with
`Cache-Control: no-store`. Nothing is saved. `file_ids: null` uses the whole
project scope (at most 10 files, in file-name order). Limits, the per-file
model call and failure handling are recorded in
[ADR-0034](../adr/0034-bounded-flashcard-draft-generation.md).

Files are read through `retrieval.sources.SourceReader`, which re-checks the
live project scope before and after each chunk read. Each draft cites the chunk
it came from (`chunk_id`, `artifact_generation`, a short `excerpt`), or the file
alone if the model cited an unknown label. Each entry in `files` is `used` or
`failed` with a reason, so one bad file never aborts the batch.

The deck page's **Draft from files** action opens
`/projects/{projectId}/study/{deckId}/drafts`. The learner chooses all project
files or up to 10 files, a card count and a model, then accepts, edits or
discards each draft. **Accept all** saves the remaining drafts. Accepting uses
the ordinary card create route, so citations are checked again on save.
Drafting again with unaccepted drafts asks for confirmation first.
