# ADR-0028 — Learning modes as a pinned, server-owned prompt layer

Status: accepted for US-52.1 on 2026-10-31.

## Context

EPIC-52 lets a learner choose how the agent helps in a chat: Standard, Tutor,
Explain-back or Review my work. A mode changes response behavior only. It must be
reproducible like personas and skills, survive resume and replay, and compose
predictably with the persona, project and skill layers. Later stories add tiered
hint state (US-52.2) and a self-imposed lock (US-52.5) on top of it.

## Decision

**Modes are a server-owned, versioned catalog.** `domains/learning/catalog.py`
defines each mode's ID, name, description, `version` and instruction text. Users
cannot create or edit modes. `GET /learning-modes` returns identity, name,
description and version only; instruction text is never serialized. Typed prompt
inputs (`LearningModeId`, `LearningModeProvenance`, `LearningModeSnapshot`) live in
`domains/agent/learning_inputs.py`. The agent domain never imports the catalog.
Standard has empty instructions.

**Selection belongs to the chat; turns pin a snapshot.** This follows the persona
pattern in [ADR-0021](0021-personas-and-execution-binding.md). A chat stores its
current `learning_mode` and a `learning_mode_revision`. New chats take
`learning_mode` in the create request. Existing chats change it with
`PUT /chat/{id}/learning-mode`, which needs the expected revision and an idle
runtime guard. Reselecting the current mode does not bump the revision. Every
accepted user turn stores `accepted_learning_mode`: ID, name, version and the
instruction text at that moment. It is written in the same transaction as the
message and send receipt, and a SQLite trigger makes it immutable. Comparison
columns copy the source turn's snapshot, as they do for personas and skills.

**Execution.** A first run uses the turn's pinned snapshot, even if the catalog
has been revised since. Resume reuses the recorded execution and prompt.
Regeneration (`restart`) captures the chat's *current* selection at the current
catalog version. Each `MessageExecution` records public `learning_mode`
provenance (ID, name, version). The prompt snapshot must contain exactly one
`mode` layer matching it, or replay fails with 409. Messages expose `learning_mode`:
the producing execution's mode, or the accepted mode for user turns. The
composer renders it as a chip.

**Live recheck.** Pinned text is replayed as recorded. The mode ID must still be
offered by the catalog at first execution and at resume. A retired mode blocks
the run with 409 until the user regenerates with an offered mode. History stays
readable.

**Composition order.** The `mode` layer sits after `profile` and before `project`:

`platform → agent → profile → mode → project → skills → runtime`

Platform rules list the selected learning mode in the conflict order and state
that a user's request to skip the mode does not switch it off. The persona still
outranks the mode, so a persona's explicit constraints (such as "be brief") hold.
The mode outranks project task text and skills, so a skill that says "write the
full solution" cannot undo Tutor mode.

**No capabilities, no inheritance.** Mode text grants no tools, files or
delegation. Delegated sub-agents do not get the mode layer. They return work to
the main agent, which applies the mode to what the learner sees.

## Consequences

- Behavior is best effort at the prompt level; a model can still leak answers.
  Structural tests cover pinning, resume, regeneration, layering, retirement,
  immutability and delegation. Model-compliance fixtures arrive with US-52.2–52.4.
- Bumping a mode's `version` affects only newly accepted turns and regeneration.
- US-52.2 can put hint level in branch state and pass it to the mode layer
  without changing this selection model. US-52.5 can add a lock that gates
  `PUT /chat/{id}/learning-mode`.
- Schema changes use fresh initialization; existing development databases need
  the explicit reset. No migrations or compatibility paths.
