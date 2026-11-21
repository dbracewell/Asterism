# ADR-0037 — Study notes, summaries and study guides

Status: accepted for US-53.6 on 2026-11-01.

## Context

US-53.6 lets a learner summarize selected files at three depths (simple,
standard, expert) with citations, and ask for a day-by-day plan up to an exam
date that links to the project's decks and quizzes. Both can be saved to the
project "as a note, or as a file once EPIC-56 lands". Projects had no note
record, and generated items stay drafts until the learner accepts them
([ADR-0033](0033-study-domain-and-scheduling.md)).

## Decision

**A note record in the study domain.** `study_notes` belongs to one user and
project (composite foreign key, `ON DELETE CASCADE`) and holds a `kind`
(`summary` or `study_guide`), a title (1–120 characters), a Markdown body (up to
100,000 characters), up to 50 citations and the writing model's id and name.
Notes are created only by an explicit save (`POST …/study/notes`); the learner
can edit the title and body and delete the note. Citations are checked against
the live project scope on save and marked available or unavailable on read, as
on cards. The model id is accepted only for a model the learner can see, and the
server records its name. Saving as a file stays with EPIC-56.

Notes are study records, not execution context: no agent, prompt layer or
retrieval path reads them.

**Summaries are drafts from the shared pipeline.** `POST …/study/summaries`
takes `{model_id, depth, file_ids}` and runs one model call per file through
`study/drafting.py` with the ADR-0034 limits, so a failed file fails alone.
Depth changes only the instructions (audience, vocabulary and length; 2–8
sections). Each section lists the source labels it draws on; known labels become
chunk citations (up to 4 per section), and a section with none cites its file.
The response carries the sections for review, plus the Markdown `body` and
deduplicated `citations` that a save stores. Nothing is persisted.

**Study guides plan from names and counts, not contents.** `POST
…/study/study-guides` takes `{model_id, start_date, exam_date, minutes_per_day}`
(1–60 days inclusive, 10–480 minutes; the client sends its local dates). One
model call (90 seconds) receives deck names with card and due counts, quiz
titles with question counts and best scores, the weak-spot count and file
names. It does not receive file contents or review details. Names are sent as
JSON strings on labelled lines (`[D1]`, `[Q1]`) and the prompt treats them as
data. The reply is parsed leniently:

- days outside the range, duplicate dates and unreadable dates are dropped;
- tasks are capped at 8 per day and minutes at 1–480;
- only labels that were sent become links to that deck or quiz; anything else is
  plain text.

No usable day, an unreadable reply or a model error is a 502; a timeout is a
504. Days the model leaves out are rest days. The response is the structured
plan plus a Markdown `body` whose links point at the project's deck and quiz
pages, with link text escaped. Nothing is persisted.

## Consequences

- A saved note is a snapshot: later changes to decks, quizzes or files do not
  update it, and links to deleted decks or quizzes simply 404.
- Summaries cover the start of long files, as with card drafts.
- When EPIC-56 adds produced files, "save as file" can reuse the same draft
  `body`.
