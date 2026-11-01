# ADR-0036 — Weak spots and weak-spot practice

Status: accepted for US-53.5 on 2026-11-01.

## Context

US-53.5 turns missed quiz questions and cards rated Again into a weak-spots set,
and lets the learner practice it as a short quiz or card session. Quiz attempts
([ADR-0035](0035-practice-quizzes-and-grading.md)) and review logs
([ADR-0033](0033-study-domain-and-scheduling.md)) already record every outcome.
Review history must stay a user record, not agent memory.

## Decision

**Weak spots are derived on read, never stored.** An item is weak when its
latest outcome in the project was a miss:

| Outcome                                     | Counts as                  |
| ------------------------------------------- | -------------------------- |
| Quiz answer `incorrect` or `partial`        | Miss                       |
| Quiz answer `correct`                       | Success                    |
| Quiz answer `ungraded`                      | Ignored (says nothing)     |
| Card rating Again                           | Miss                       |
| Card rating Hard, Good or Easy              | Success                    |

One SQL query unions answer and rating events, ranks them per item by time and
keeps items whose newest event is a miss, most recent first. A later success
clears an item, so there is no separate "resolved" state to keep in sync.
Unanswered questions in a submitted attempt are misses, since they were graded
`incorrect`.

**Practice is a quiz built from copies, without a model.** `POST
…/weak-spots/practice` takes up to 20 of the most recent weak spots and saves a
quiz with `origin = weak_spots` and no model. Missed questions are copied with
their answer key and rubric, and multiple-choice options are reshuffled. Weak
cards become short-answer questions: the front is the prompt and the back is the
rubric. Copies keep only citations whose files are still in the project, as any
write must. We chose copies over a fresh model-generated quiz because they cost
nothing, keep the exact source citations, and test exactly what was missed. A
learner who wants new questions can generate a quiz from the cited files.

A quiz covers cards as well as questions, so we did not add a separate card
session. Reviewing cards early would also disturb the FSRS schedule.

**Copies resolve their originals.** A copied question records
`source_question_id` or `source_card_id`: the original item it re-asks,
propagated through copies of copies. Answers to a copy count towards that
original. Practising a weak card correctly in a quiz clears it, but does not
change its review schedule: only ratings do. These are plain ids, not foreign
keys, so deleting an original keeps its copies and their history.

**Quizzes gain an origin.** `study_quizzes.origin` is `generated` (with a
required model name) or `weak_spots` (no model). Question prompts and rubrics may
now hold a full card side (4,000 characters).

**Still not memory.** Only the owner's explicit requests read weak spots. No
agent, prompt layer or retrieval path uses them; EPIC-58 may add explicit,
opt-in use.

## Consequences

- Weak spots are always consistent with history and need no maintenance, at
  the cost of a query over all of a project's events. The query filters by owner
  and project in the database and returns a capped page.
- Practising a card in a quiz clears it as a weak spot but leaves its due date
  unchanged.
