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

## Weak spots (US-53.5)

Decisions are recorded in [ADR-0036](../adr/0036-weak-spots-and-practice.md).

| Route                                           | Behavior                                                             |
| ----------------------------------------------- | -------------------------------------------------------------------- |
| `GET /projects/{project_id}/study/weak-spots`   | Up to `limit` (1–50, default 20) weak spots, newest miss first      |
| `POST /projects/{project_id}/study/weak-spots/practice` | `{question_count}` (1–20, default 10); saves and returns a quiz (201) |

A question or card is a weak spot when its latest outcome in the project was a
miss: an incorrect or partly correct quiz answer, or an Again rating. Any later
success clears it, and ungraded answers are ignored. Each item names its
original (`root_*`), the question or card last answered (`source_*`), and that
source's quiz or deck (`container_*`). Nothing is stored.

Practice copies the most recent weak spots into a quiz with `origin:
"weak_spots"` and no model: missed questions keep their answer key (options
reshuffled), and weak cards become short-answer questions graded against the
card's back. Answering a copy counts towards its original. With no weak spots
the route returns 400.

The project page shows **Weak spots** once there are any: the five most recent,
each linked to its quiz or deck, and **Practice weak spots**, which builds a
quiz of up to 10 questions and opens it for taking. Practice quizzes are listed
with the other quizzes and described as built from weak spots.

## Summaries, study guides and notes (US-53.6)

Decisions are recorded in [ADR-0037](../adr/0037-study-notes-summaries-and-guides.md).

| Route                                                 | Behavior                                                                  |
| ----------------------------------------------------- | ------------------------------------------------------------------------- |
| `POST /projects/{project_id}/study/summaries`         | Draft `{sections, body, citations, files}`; `no-store`, nothing saved     |
| `POST /projects/{project_id}/study/study-guides`      | Draft day plan `{days, body}` linked to decks and quizzes; nothing saved  |
| `GET`/`POST /projects/{project_id}/study/notes`       | Note page (newest update first, no bodies) / save a draft (201)          |
| `GET`/`PATCH`/`DELETE …/notes/{note_id}`              | Read with live citations, edit title and body, delete                     |

Summaries take `{model_id, depth: simple|standard|expert, file_ids}` and use the
card-draft pipeline and limits; each section cites the chunks it draws on and
each file reports `used` or `failed`. Study guides take `{model_id, start_date,
exam_date, minutes_per_day}` (1–60 days, 10–480 minutes). The model sees deck,
quiz and file names with counts and scores, never file contents; only deck and
quiz labels it was given become links. An unusable plan is a 502 and a timeout a
504. Notes take `{kind, title, body, citations, model_id?}`; citations must be
in the project's live scope and the model must be one the learner can see.

The project page lists **Study notes** with **Summarize files**
(`/projects/{projectId}/study/summaries/new`) and **Plan for an exam**
(`…/study/guides/new`). Both pages show the draft, then **Save as note** with an
editable title, which opens the note at `…/study/notes/{noteId}`. The note page
renders the body through `MarkdownViewer`, lists its sources, and offers edit
(title and Markdown body) and delete. Generating again with an unsaved draft
asks for confirmation.

## Topics and mastery (US-58.3)

Decisions are recorded in [ADR-0049](../adr/0049-topic-mastery.md).

Decks and quizzes have `tags` (up to 8, each 1–40 characters, single line).
Tags are trimmed, inner whitespace is collapsed, and case-insensitive repeats
are dropped, keeping the first spelling. Deck create and update, quiz
generation and quiz update (`{title?, tags?}`; explicit null is a 422) accept
them.

| Route                                           | Behavior                                                         |
| ----------------------------------------------- | ---------------------------------------------------------------- |
| `GET /projects/{project_id}/study/topics`       | Mastery per topic, by label; `no-store`; nothing stored          |
| `POST /projects/{project_id}/study/topics/practice` | `{topic, question_count}` (1–20, default 10); saves a quiz (201) |

A topic is a case-folded tag. Its items are the cards of decks with the tag and
the original questions of quizzes with it; weak-spot and topic practice copies
count towards the item they re-ask, never as items of their own. Each item's
latest graded outcome is scored 0–1: quiz answers correct 1, partial 0.5,
incorrect 0 (ungraded ignored); card ratings Again 0, Hard 0.6, Good 0.9,
Easy 1. `score` is the mean over practiced items; `practiced`/`total` give
coverage. `level` is `not_started` (nothing practiced), `needs_work` (< 50%),
`mastered` (≥ 80% with ≥ 80% coverage) or `developing`. `trend` has 8 weekly
points ending now, each computed from events up to that time.

Practice orders the topic's items weakest first (latest score below 1, lowest
then oldest), then unpracticed items, then the rest by oldest practice, and
copies them into a quiz with `origin: "topic"`, the topic as its tag and no
model, exactly like weak-spot practice. An unknown topic is 404 and a topic
without items is 400.

The project page shows **Topic mastery** once any deck or quiz has a topic:
each topic's level, score, coverage, a weekly sparkline with a text summary,
and **Practice**, which opens the new quiz for taking. Deck forms and the quiz
**Edit details** dialog edit topics as comma-separated text.

## Unclear items (US-58.4)

Decisions are recorded in [ADR-0050](../adr/0050-unclear-items-feed-review.md).

| Route                                              | Behavior                                                                     |
| -------------------------------------------------- | ---------------------------------------------------------------------------- |
| `POST /projects/{project_id}/study/unclear-cards`  | `{reflection_id, deck_id?, front, back, weak_spot}`; one card (201), 409 if repeated |

**Practice unclear items** on a project reflection lists each "still unclear"
line. The learner edits the question, writes the answer and adds each card
separately, into a chosen deck or the "Unclear items" deck. With **Also add to
weak spots** (on by default) the card appears under weak spots as "Flagged as
unclear" until it is recalled. The flag is not a review, so it changes neither
scheduling nor mastery.

