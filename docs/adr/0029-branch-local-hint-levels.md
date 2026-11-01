# ADR-0029 — Branch-local hint levels for learning modes

Status: accepted for US-52.2 on 2026-10-31.

## Context

In Tutor mode the learner asks for more help one step at a time: Nudge, Hint,
Worked example, and finally the answer, which needs an explicit confirmation.
The level must behave predictably when the learner regenerates, branches or
switches modes, and it must reach the pinned mode layer from
[ADR-0028](0028-learning-mode-layer.md) without making the mode text editable.

## Decision

**Levels.** `HintLevel` (`agent/learning_inputs.py`) is ordered
`none → nudge → hint → worked_example → answer`. A catalog definition lists the
levels it offers, each with its instruction text, starting with `none`. Tutor
offers all five; the other modes offer none for now. `GET /learning-modes`
returns each mode's raisable levels (`hint_levels`) but no instruction text.
Tutor's `version` went to 2 when its text changed.

**State lives on user turns.** Every user message has a `hint_level` column,
immutable through a SQLite trigger. The branch level is the `hint_level` of the
active branch's latest user turn (`ChatInfo.hint_level`), so switching branches
restores that branch's level, and an alternative reply to an earlier turn falls
back to that turn's level. A user turn added below an existing turn inherits its
nearest user ancestor's level. Comparison columns copy the source turn's level.
Hint state persists across mode changes; only modes that offer hints apply it.

**Raising is an explicit part of a send.** `ChatSendRequest.hint` and
`NewChatRequest.hint` take a `HintRequest`:

- No `hint`: the turn keeps the branch level. Message text cannot raise it.
- `level: none` resets the branch to `none`.
- Any other level must be offered by the chat's current mode (409 otherwise) and
  must be higher than the branch level (409 otherwise). With `reset: true` the
  comparison starts from `none`, so "New problem" and a raise can share one turn.
- `answer` needs `confirm_reveal: true` (400 otherwise). The UI shows a
  confirmation dialog before sending it.

The send fingerprint covers `hint`, so a retried raise acknowledges the original
turn instead of failing as "already at this level".

**Passing the level to the mode layer.** `LearningModeDefinition.snapshot(level)`
appends `Current hint level: <level>` and that level's text to the mode
instructions, and records the level actually applied in the snapshot and in
`LearningModeProvenance.hint_level`. A level the mode does not offer applies the
strongest offered level below it. Acceptance pins this snapshot. Resume replays
it. Regeneration captures the chat's current mode at the *turn's* hint level,
because the level was part of what the learner asked for on that turn.

**UI.** The chat shows hint controls above the composer when the current mode
offers hints: the current level, buttons for the stronger levels, "Show answer"
behind an `AlertDialog`, and "New problem", which resets the level with the next
message. Each raise sends a short fixed prompt such as "Give me a nudge." The
user message chip shows the level, for example "Tutor · Nudge".

## Consequences

- Leaking an answer is still possible; the level only shapes the prompt.
  `asterism/domains/learning/evals/` holds compliance fixtures, and
  `scripts/evaluate_learning_modes.py` runs them against a live model. They do
  not gate CI.
- US-52.4 reuses the reveal action: Review mode (version 2) offers
  `((none, …), (answer, …))`, so its only control is "Show solution" behind the
  same confirmation, and `answer` there means a corrected solution. The UI
  labels the levels per mode ("Feedback only", "Solution shown", "New
  attempt"). A Tutor level carried into Review applies `none`; a revealed
  Review branch carries `answer` into Tutor until "New problem" resets it.
- US-52.5 can gate `answer` requests and mode changes with its lock.
- Schema changes need the explicit development reset; no migrations.
