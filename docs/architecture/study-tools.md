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

## Spaced-repetition review (US-53.3)

| Route                                            | Behavior                                                         |
| ------------------------------------------------ | ---------------------------------------------------------------- |
| `GET /projects/{project_id}/study/summary`       | `{deck_count, card_count, due_count}` for the project            |
| `GET …/decks/{deck_id}/review?limit=`            | Due cards (`due_at <= now`), most overdue first, with `previews` |
| `POST …/decks/{deck_id}/cards/{card_id}/reviews` | `{rating, expected_reps}`; 409 if the card was already rated     |

Decks report `due_count` and cards report `state`, `due_at`, `reps` and
`lapses`. `previews` gives the next due time for each rating, so the review
buttons can show the wait (for example "10m" or "8d"). New cards are due as soon
as they are created.

The project page shows the project's due total and a **Review** link for each
deck with due cards. The deck page shows **Review (N due)** and each card's next
review date. The session at `/projects/{projectId}/study/{deckId}/review`
loads up to 100 due cards. Space or Enter shows the answer, and 1–4 rate it
(Again, Hard, Good, Easy). Held keys and modified keys are ignored. Focus moves
to **Good** after the answer is shown, back to **Show answer** for the next
card, and to the summary at the end, and a status region announces each step.
Cards still in a short learning step (due within 20 minutes) come back later in
the same session. Only an explicit **Review more due cards** starts a new
session; background refetches never reset one.

## Practice quizzes (US-53.4)

Decisions are recorded in [ADR-0035](../adr/0035-practice-quizzes-and-grading.md).

| Route                                                     | Behavior                                                                  |
| --------------------------------------------------------- | ------------------------------------------------------------------------- |
| `GET /projects/{project_id}/study/quizzes`                | Quiz page, newest first, with counts and last and best score (0–1)       |
| `POST /projects/{project_id}/study/quizzes`               | Generate and save; `{quiz, files}`, `quiz` null if nothing was usable    |
| `GET`/`PATCH`/`DELETE …/quizzes/{quiz_id}`                | Read without answer key, rename (`title` only), delete with attempts     |
| `GET …/quizzes/{quiz_id}/attempts`                        | Attempt page, newest first                                                |
| `POST …/quizzes/{quiz_id}/attempts`                       | `{answers, model_id?}`; grades, saves and returns the results (201)       |
| `GET …/quizzes/{quiz_id}/attempts/{attempt_id}`           | One attempt's results with answer key, feedback and live citations       |

Generation takes `{model_id, question_count (1–20), kinds, file_ids, title?}`
and uses the card-draft pipeline and limits (`study/drafting.py`). Each question
cites the chunk it came from. Multiple-choice answers (`choice`, an option
index) are graded exactly. Non-blank short answers (`text`, up to 2,000
characters) are graded by `model_id` against the question's rubric, with a
verdict (correct, partial or incorrect) and an explanation; a partial answer
earns half a point. A grading failure marks only that answer `ungraded`. An
answer for another quiz's question, a choice out of range or the wrong answer
type is a 400; short answers without `model_id` are a 400; an unavailable model
is a 409.

The project page lists quizzes under **Practice quizzes** with **New quiz**.
`/projects/{projectId}/study/quizzes/new` chooses files, question count, types
and a model, then links to the saved quiz. The quiz page
(`…/quizzes/{quizId}`) shows the best and last scores, the attempt history, and
rename and delete actions. `…/take` shows each question (radio options or a
short-answer box) and, when the quiz has short answers, a grading model that
defaults to the generating model. Submitting opens the results at
`…/attempts/{attemptId}`: the score, each answer's verdict, the correct option,
rubric, explanation, feedback and source citations. Question, option, rubric
and feedback text are untrusted and render through `MarkdownViewer`.
