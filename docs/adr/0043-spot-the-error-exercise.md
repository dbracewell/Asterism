# ADR-0043 — Spot-the-error exercise

Status: accepted and implemented for US-55.4 on 2026-11-02
([EPIC-55](../epics/EPIC-55-GROUNDED-ANSWERS-AND-CLAIM-VERIFICATION.md)).

## Context

Learners should practise catching AI mistakes. An exercise answer must contain
exactly one deliberate error that the server knows about, so it can grade the
learner's guess and later show the error with a source. The error must not be
visible before the learner asks, and an exercise answer must never pass for an
ordinary answer: not in the transcript, not when copied, not in exports, and not
to the model in later turns.

## Decision

### 1. Mode

`spot_the_error` ("Spot the error") is a server-owned learning mode (US-52.1).
Like other modes it is a pinned prompt layer and grants nothing. Its
instructions ask for a normal answer with exactly one specific, checkable,
harmless factual error. The answer must not hint at the error or put a citation
link on it, and should prefer an error that a retrieved passage disproves. The
reply ends with a record block:

````
```asterism-exercise
{"quote": "...", "correction": "...", "source": "asterism-cite:<key> or null"}
```
````

### 2. Hiding the record

- **Streaming.** While a run in this mode streams, each delta's cumulative text
  is cut at the marker, and a trailing partial marker is held back. The block
  never reaches the client during the run.
- **Saving.** `add_message` splits the final step (no tool calls) into the
  visible answer and the record. Only the visible answer is stored in `content`.
  Intermediate steps simply drop any block. Other modes are untouched.
- **Storage.** `messages.exercise_record` (`ExerciseRecord`) keeps `valid`,
  `quote`, `correction`, `source`, the attempts, `found` and `revealed_at`. The
  API only returns `ExerciseView`, which leaves out `quote`, `correction` and
  `source` until the exercise is revealed.

This hides the record from the UI and API. It is not a secret from the model
provider. Thinking text, if the model writes it and the user shows it, may
mention the error.

### 3. Validity and source

The record is valid when its quote occurs in the visible answer, ignoring
Markdown marks, whitespace and case. A missing, unreadable or non-matching
record is stored as `valid = false`: the answer is still an exercise and is
labelled as one, but cannot be checked.

`source` resolves like a claim citation ([ADR-0040](0040-claim-level-citations.md)).
It must be a chunk this run retrieved, from a file in the run's ceiling and the
live chat scope. Otherwise it is a bare unavailable entry. On read, a revealed
source is rechecked against the live scope.

### 4. Checking and revealing

- `POST …/messages/{id}/exercise/attempts` (`chatExerciseAttempt`) takes a
  selection (text the learner selected in the answer, or typed). The grading
  needs no model call. Both texts are normalized; the selection must occur in
  the answer (400 otherwise).
  - **found:** it overlaps the error and covers most of the selection or half the
    quote.
  - **too_broad:** it contains the error among too much other text (longer
    than twice the quote, or quote + 40 characters).
  - **not_it:** otherwise.

  Feedback never reveals the error. At most 20 attempts. No attempts after a
  reveal or on an invalid record (409).
- `POST …/messages/{id}/exercise/reveal` (`chatExerciseReveal`) records the reveal
  and returns the full view. It is idempotent.

Both are owner only.

### 5. Labelling everywhere

- **Transcript.** Every exercise answer shows an "Exercise" group: "This answer
  contains one deliberate error", the check controls (selection or typed
  words), feedback, and Reveal (with a confirmation unless the error was
  already found). After reveal it shows the error, the correction and the source
  chip, and highlights the error in the answer (CSS Custom Highlight API, visual
  only). This covers the chat, comparisons and run views, which all render
  messages the same way. The user turn also carries the mode chip.
- **Copy.** Copying an exercise answer prefixes
  `[Exercise: this answer contains one deliberate error.]`.
- **Model history.** In any later turn, in any mode, an exercise answer reaches
  the model with a note that it contains a deliberate error.
- **Exports.** No chat export exists yet. `Message.exercise` is the provenance
  flag; any export, including the planned AI-use log (EPIC-57), must label
  messages that have it.

### 6. Evaluation

`learning/evals/spot_the_error.json` checks that a reply ends with exactly one
record, has no hints in the answer, and points to Reveal when asked for the
error. It runs with the other learning-mode fixtures and does not gate CI.

## Consequences

- `messages` gains `exercise_record`; `SpanCitation` moved to
  `chat/citation_schemas.py`; `span_citations.run_hits` is shared with exercises.
- Grading by overlap is lenient within the error's quote (selecting a correct
  word inside the wrong sentence counts). That is intended: the quote is the
  model's shortest statement of the error.
- A model may still produce an answer with an accidental second error. The
  feedback says "not the deliberate error", never "correct".
