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
