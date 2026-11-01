# ADR-0035 — Practice quizzes, attempts and grading

Status: accepted for US-53.4 on 2026-11-01.

## Context

US-53.4 lets a learner generate a practice quiz (multiple choice and short
answer) from project files, take it, and keep the graded attempts. Each question
must cite its source. Multiple choice must be graded exactly; short answers are
graded by a model against a rubric, with an explanation.
[ADR-0033](0033-study-domain-and-scheduling.md) says generated items are drafts
until the learner accepts them, and
[ADR-0034](0034-bounded-flashcard-draft-generation.md) defines the bounded,
per-file drafting pipeline.

## Decision

**Generation reuses the card-draft pipeline.** The mechanics of ADR-0034 (live
file resolution, `SourceReader` reads with a shared input budget, one model call
per file with its share of the count, per-file failure, the request deadline)
move to `study/drafting.py`. Model resolution moves to `study/llm.py`. Card
drafts and quiz questions each supply only a prompt and a parser. Limits match
ADR-0034: 1–20 questions, 1–10 files, 60,000 input characters, 60 seconds per
call, 150 seconds per request and 3 concurrent calls.

**A generated quiz is saved at once.** Unlike flashcards, the learner does not
review questions before saving: seeing the answer key would spoil the quiz.
Generating is itself the explicit request, and the quiz goes nowhere else (no
deck, no agent context). The learner can rename or delete it. If no file
produces a usable question, nothing is saved and the response carries only the
per-file results. Before saving, cited files are re-checked against the live
project scope, and a file that left the project fails instead of being cited.

**Questions are fixed once generated.** Only the quiz title can change. Attempt
answers therefore reference question rows directly, and history never drifts
from the questions it graded. Multiple-choice options are shuffled after parsing,
because models tend to put the right answer first.

**Taking hides the answer key.** `GET …/quizzes/{quiz_id}` returns prompts and
options only, without the correct option, rubric, explanation or citations.
Results (from submitting an attempt or reading one) include all of them, with
citations resolved against the live project scope as on cards.

**Grading.**

- Multiple choice is exact: the chosen index equals the stored correct index.
- A non-blank short answer is sent to the learner's chosen model (`model_id` on
  the submission; the UI defaults to the generating model) with the question,
  the rubric and the answer in separate tags. The prompt treats the answer as
  text to grade, never as instructions. The reply is a verdict (`correct`,
  `partial`, `incorrect`) and an explanation.
- Blank and omitted answers are `incorrect` with no model call.
- Points: 1 for correct, 0.5 for partial, 0 otherwise. A failed, unreadable or
  timed-out grade (45 seconds per call, 120 per submission) marks only that
  answer `ungraded` (0 points, counted in `ungraded_count`). The attempt is
  still saved, and the learner can retake the quiz.
- An unavailable model is a 409 before any grading. A submission whose quiz is
  deleted during grading is a 404 and saves nothing.

**Records.** `study_quizzes`, `study_quiz_questions`, `study_quiz_attempts` and
`study_quiz_answers` follow ADR-0033: a denormalized `user_id` with composite
foreign keys to the owner's project, quiz, attempt and question, all `ON DELETE
CASCADE`. Quizzes and attempts store the model id and name as provenance, not as
foreign keys, so deleting a model keeps the history. Attempts are append-only,
user-owned records that no agent or prompt path reads.

## Consequences

- Quiz quality depends on the chosen model; the learner can delete a poor quiz
  and generate another.
- Ungraded answers are not regraded in place; a retake creates a new attempt.
  US-53.5 can derive weak spots from `incorrect` and `partial` answers.
- Card drafting now shares `drafting.py`; its failure messages say "items"
  rather than "cards" where the text is shared.
