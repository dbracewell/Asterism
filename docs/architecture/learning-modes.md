# Learning modes

This guide explains learning modes: the server-owned instructions that change
how Asterism helps someone, from giving direct answers to tutoring with hints or
reviewing a draft against a rubric. It covers how a mode reaches the model, how
hint levels and answer reveals work, and how a learner's own lock and an
educator's course policy restrict modes. Read it before adding a mode or changing
how one behaves.

## Concepts

- **A learning mode** is a fixed block of instructions, written and versioned in
  the server's catalog. A chat has one selected mode at a time. Users choose a
  mode; they can't edit its text.
- **The mode layer** is the mode's instructions placed in the system prompt, after
  the user's About you text and before project instructions
  ([execution context](execution-context.md#what-a-turn-is-made-of)).
- **A hint level** is how much help a mode may give on the current question, from
  none up to the answer. Each branch of a chat has its own level.
- **Mode policy** is the set of modes a chat may use and whether it may reveal
  answers. It combines the learner's own lock and, for a course, the educator's
  rules.

## The modes

| Mode               | ID               | What it does                                                                                       | Special behavior                                           |
| ------------------ | ---------------- | -------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| Standard           | `standard`       | Answers directly                                                                                   | No mode layer at all                                       |
| Tutor              | `tutor`          | Guides with questions instead of answers                                                           | Hint levels: none, nudge, hint, worked example, answer     |
| Explain-back       | `explain_back`   | The learner explains; the reply says what was right, what was missing and what to think about next | Three fixed feedback sections                              |
| Review my work     | `review`         | Points out the first mistake or weakest point in the learner's attempt                             | One reveal level: the corrected solution                   |
| Spot the error     | `spot_the_error` | Answers with one deliberate mistake for the learner to find                                        | A hidden record of the error, graded guesses               |
| Draft feedback     | `draft_feedback` | Assesses a draft against a rubric without rewriting it                                             | Takes a rubric; per-criterion feedback and inline comments |
| Research assistant | `research`       | Suggests search angles, judges sources and builds outlines, but writes no prose                    | Fixed formats for source evaluations and outlines          |

The catalog is [`learning/catalog.py`](../../apps/backend/asterism/domains/learning/catalog.py).
`GET /learning-modes` serves each mode's ID, name, description, version, hint
levels and feedback headings, but never its instruction text.

## How it works

### A mode on a turn

When a user sends a message, the server copies the chat's selected mode onto the
message: its ID, name, version and instruction text, plus the branch's hint level.
This copy is _pinned_, so the turn keeps the mode it was sent with:

- **The first run and resume** use the pinned copy.
- **Regenerate** uses the chat's current mode, so a learner can switch mode and
  ask again.
- **Sub-agents** never receive the mode layer.

Before any run starts, the mode must still be in the catalog. A retired mode stops
the run with a 409 asking the user to choose another, rather than replaying text
the server no longer offers. Execution records keep the mode's ID, name and version,
never its text.

A mode is instructions and nothing more. It grants no tools, files or sub-agents;
the Research assistant can search the web only if the agent already has web search.

### Hint levels and Show answer

Tutor and Review my work offer _tiered help_. Each user message records the
branch's hint level (`none`, `nudge`, `hint`, `worked_example`, `answer`), and the
latest user message on the active branch sets the current level. Branches keep
separate levels, so regenerating on one branch doesn't raise the level on another
([ADR-0029](../adr/0029-branch-local-hint-levels.md)).

- **Raising the level** takes an explicit `hint` request on a send, and the mode
  must offer the requested level. Asking a question never raises it by itself.
- **The answer level** (Show answer) also needs `confirm_reveal`, so the answer is
  never revealed by accident. Mode policy may forbid it or require an override.
- **The mode layer includes the level's instructions,** and the turn records the
  level that was applied.

Tutor offers every level. Review my work offers only `answer`, which reveals the
corrected solution.

### Mode policy: the learner's lock and course rules

One effective policy per chat decides which modes it may use and whether it may
reveal answers ([ADR-0068](../adr/0068-effective-mode-policy.md)). It combines two
sources, read live on every check, and the stricter rule wins:

- **The learner's lock** (`chats.learning_mode_locked`,
  [ADR-0031](../adr/0031-self-imposed-mode-lock.md)). A learner can lock a chat to
  keep themselves from taking the easy route: every mode except Standard stays
  allowed, and revealing an answer needs an explicit override. The learner can
  lift the lock, after a five-second confirmation in the chat header.
- **The course policy** (`classes.allowed_modes` and `classes.answer_reveal`,
  [ADR-0055](../adr/0055-class-mode-policy.md)). It applies to a student's copy of
  a course project while they are in the class, and only the educator can change it.

The allowed modes are the catalog, narrowed by each source; the result may be
empty. Reveal is the strictest of `forbidden`, `override_required` and `allowed`.

[`chat/mode_policy.py`](../../apps/backend/asterism/domains/chat/mode_policy.py)
builds the policy and holds the single check that sends, mode changes, hint
requests and every run call. Some details:

- **Runs check with the learner's lock lifted.** The lock was checked when the
  message was accepted and isn't pinned on the turn, so a run started before the
  lock isn't stopped by it.
- **`override_lock` lifts only the learner's lock,** never the course policy.
- **Selecting Standard releases the lock,** and is refused when the course forbids
  Standard. A lock that would leave no mode at all is refused.
- **Refusals are 409** with `reason: "mode_policy"` and name each source that
  refused.

The policy reaches the browser on each chat (`ChatInfo.mode_policy`), and for a
new chat from `GET /chat/mode-policy?project_id=`. The mode picker disables modes
that only the course refuses, and Show answer is hidden, delayed or shown according
to the reveal rule.

### Explain-back: fixed feedback sections

Explain-back replies use three Markdown headings, in order: "What you got right",
"What was missing or wrong" and "Follow-up questions". The mode text tells the
model to use them only after the learner has explained something. The catalog
serves the headings, so the interface renders each section from the catalog
rather than a copy of it. A reply that doesn't start with the first heading
renders as ordinary Markdown. Because the `start` packet carries the mode, the
sections render while the reply streams
([ADR-0030](../adr/0030-structured-feedback-sections.md)).

### Review my work: the attempt is ordinary attachments

Review mode has no attachment path of its own. The learner's attempt arrives as
message text or attached files, through the usual chat attachment rules: text
inline under an `Attached file:` heading, images as image parts on vision models,
and a short note for a file that can't be included. The mode text tells the model
to review that content as the learner's work, and the platform rules already treat
file content as data, not instructions.

### Spot the error: a hidden, graded mistake

In Spot the error, the model answers normally but includes exactly one specific,
checkable, harmless factual error, and ends its reply with a record block naming
the quoted error, the correction and, if possible, a source from the user's files
([ADR-0043](../adr/0043-spot-the-error-exercise.md)).

- **The record never reaches the browser during the run.** While the reply streams,
  text is cut at the record's marker. When the reply is saved, the record moves to
  `messages.exercise_record` and only the visible answer is stored as content.
- **The record is checked.** It is valid only if its quote appears in the visible
  answer. An invalid record still marks the answer as an exercise, but it can't be
  graded.
- **The learner guesses** with `POST …/exercise/attempts`, up to 20 times, and can
  give up with `POST …/exercise/reveal`. The API leaves out the quote, correction
  and source until the exercise is revealed.
- **An exercise is always labeled as one,** in the transcript, when copied, in the
  AI-use log and to the model in later turns, so a deliberately wrong answer is
  never mistaken for a real one.

The record is hidden from the interface and the API, not from the model provider.

### Draft feedback: rubrics and inline comments

Draft feedback assesses the learner's own writing against a rubric
([ADR-0044](../adr/0044-rubric-draft-feedback.md)). A send in this mode names one of
the bundled rubrics or one the user owns. The server pins a copy of the rubric on
the user message (`accepted_rubric`), and the model reads it after the learner's
message. Resume, regeneration and later turns use that copy even if the rubric is
edited. A rubric adds no prompt layer and grants nothing.

The reply has one section per rubric criterion, each with an `Estimated level:`
line, and a closing `Overall` section, which the interface renders as cards. Each
quoted passage from the draft is followed by a note, and a section may end with a
`Next step:` line ([ADR-0045](../adr/0045-inline-draft-comments.md)). When the
learner opens the review, each quote and note becomes an inline comment anchored to
the quoted text:

- `GET /chat/{chat_id}/messages/{message_id}/draft-review` returns the documents
  the message sent (its text and attached text files, rechecked against the chat's
  current files) and the comments.
- `PUT …/draft-review/comments/{comment_id}` marks a comment resolved.

Rubrics are stored with prompt templates; see [prompt templates](prompt-templates.md#rubrics).

### Research assistant: sources and outlines, no prose

The Research assistant suggests search angles, evaluates sources and builds
outlines in fixed formats:

- a source evaluation is a `### Source:` heading with Credibility, Relevance and
  Bias bullets, and "Use it for";
- an outline is `### Outline: …`, a numbered list of short phrases each labeled
  `[S<n>]` or `[needs source]`, then a `### Sources` section defining each label.

It declines to write introductions, paragraphs or conclusions, and says why. It may
use only sources from the run's own searches, sources the learner shares and
attached files, and must not invent any.

## Testing a mode

Each mode with special behavior has a fixture file in
[`learning/evals/`](../../apps/backend/asterism/domains/learning/evals/) with sample
conversations and checks on the reply: required headings, an outline's labels, a
limit on running prose, a valid exercise record, and so on.
[`scripts/evaluate_learning_modes.py`](../../apps/backend/scripts/evaluate_learning_modes.py)
runs them against a live model, using the checks in
[`learning/evaluation.py`](../../apps/backend/asterism/domains/learning/evaluation.py).
These checks measure how well a model follows a mode and never gate CI. Ordinary
tests cover what must hold regardless of the model: pinning, hint state and
policy. When you change a mode's instructions, raise its `version` in the catalog
and rerun its fixtures.

## Rules

- Mode text is server-owned and versioned. Users choose a mode, never its text.
- A mode grants no tools, files or sub-agents, and sub-agents don't receive it.
- A turn keeps the mode, hint level and rubric it was sent with; only regeneration
  picks up the current mode.
- Mode policy is read live, and the stricter source always wins.
- Answers are revealed only with an explicit confirmation, and never when the
  policy forbids it.
- A Spot the error answer is always labeled as an exercise.

## Where the code lives

1. [`learning/catalog.py`](../../apps/backend/asterism/domains/learning/catalog.py):
   the modes, their instructions, hint levels and feedback formats.
2. [`chat/learning_modes.py`](../../apps/backend/asterism/domains/chat/learning_modes.py):
   changing a chat's mode and pinning it on a turn.
3. [`chat/mode_policy.py`](../../apps/backend/asterism/domains/chat/mode_policy.py):
   the effective policy and its single check.
4. [`chat/exercises.py`](../../apps/backend/asterism/domains/chat/exercises.py):
   Spot the error records, guesses and reveals.
5. [`chat/draft_comments.py`](../../apps/backend/asterism/domains/chat/draft_comments.py)
   and [`learning/rubric_replies.py`](../../apps/backend/asterism/domains/learning/rubric_replies.py):
   rubric replies and inline comments.

## Related

- [ADR-0028](../adr/0028-learning-mode-layer.md): the mode layer
- [ADR-0068](../adr/0068-effective-mode-policy.md): the effective mode policy
- [Execution context](execution-context.md): where the mode layer sits in the prompt
- [Prompt templates](prompt-templates.md): rubrics and templates
