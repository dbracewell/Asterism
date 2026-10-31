# EPIC-53: Study tools from project files

Status: proposed. Source: product direction discussion (2026-10-31), learner track.

## Objective

Turn a learner's own course material (slides, readings, notes) into active study
tools: flashcards with spaced repetition, practice quizzes that adapt to
mistakes, and summaries at different depths. Every generated item cites the
file it came from.

## Ownership and delivery

- A new `study` backend domain owns decks, cards, review logs, quizzes and
  attempts. Records are owned by the user and scoped to a project. Queries
  follow the owner-scoped base-select pattern.
- Generation reads only the project's live file scope, through the
  `RetrievalService`. Generated cards and questions store citations (file ID
  plus chunk reference). They are untrusted text and render through
  `MarkdownViewer`.
- Generated items are drafts until the learner accepts them. Nothing is added
  silently.
- The scheduling algorithm (FSRS or SM-2) is decided in an ADR and kept behind
  a small interface.
- Review history is an explicit user-owned record, not agent memory. Agents do
  not read it automatically; see EPIC-58 for explicit use.

## US-53.1: Study domain and decks

As a learner, I want flashcard decks attached to a project.

Estimate: 2 days. Dependencies: none.

Acceptance: users can create, read, update and delete decks and cards within
their own projects. Cards have a front, a back and optional citations. Access to
foreign or missing projects returns the same 404. Deleting a project deletes its
decks.

- [ ] Write an ADR for the study domain and the scheduling algorithm choice.
- [ ] Implement models, queries, service and router; regenerate the client.
- [ ] Test owner and project isolation and cascade deletion.

## US-53.2: Generate flashcards from files

As a learner, I want cards drafted from my material.

Estimate: 2.5 days. Dependencies: US-53.1.

Acceptance: the learner picks files (or the whole project scope) and a card
count. Asterism drafts cards with citations. The learner reviews, edits, accepts
or discards each draft before it is saved. Generation is bounded (count, input
characters, time), and a failed file does not abort the batch.

- [ ] Implement bounded generation through RetrievalService with citation capture.
- [ ] Build the draft review screen with accept/edit/discard.
- [ ] Test scope enforcement, limits, partial failure and citation links.

## US-53.3: Spaced-repetition review

As a learner, I want to review the right cards at the right time.

Estimate: 2 days. Dependencies: US-53.1.

Acceptance: a review session shows due cards. The learner reveals each answer
and rates recall (Again, Hard, Good, Easy), and the scheduler sets the next due
date. The project page shows the number of due cards. The session works with
the keyboard alone.

- [ ] Implement the scheduler interface, review log and due queries.
- [ ] Build the review session UI with keyboard shortcuts.
- [ ] Test scheduling math, due ordering and accessibility.

## US-53.4: Practice quizzes

As a learner, I want to test myself on my material.

Estimate: 2.5 days. Dependencies: US-53.1.

Acceptance: the learner generates a quiz (multiple choice and short answer) from
selected files. Multiple-choice answers are graded exactly. Short answers are
graded by the model against a rubric, with an explanation. Each question cites
its source. Attempts are saved.

- [ ] Implement quiz generation, attempts and grading.
- [ ] Build quiz-taking and results screens with citations.
- [ ] Test grading paths, citation scope and attempt history.

## US-53.5: Adaptive follow-up

As a learner, I want extra practice where I'm weak.

Estimate: 1.5 days. Dependencies: US-53.3, US-53.4.

Acceptance: missed questions and cards rated "Again" feed a weak-spots set.
"Practice weak spots" builds a short quiz or card session focused on those
topics.

- [ ] Derive weak spots from attempts and review logs; build the practice entry point; add tests.

## US-53.6: Summaries and study guides

As a learner, I want material explained at my level, and a plan for the exam.

Estimate: 2 days. Dependencies: US-53.1. Saving as a file depends on EPIC-56.

Acceptance: the learner can ask for a summary of selected files at three depths
(simple, standard, expert), with citations. A study guide takes a target date
and produces a day-by-day plan linked to decks and quizzes. Both can be saved to
the project as a note, or as a file once EPIC-56 lands.

- [ ] Implement depth-controlled summaries and study-guide generation.
- [ ] Build the save action; test citation scope and plan generation.
