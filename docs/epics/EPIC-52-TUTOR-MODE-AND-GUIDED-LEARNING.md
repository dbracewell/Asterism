# EPIC-52: Tutor mode and guided learning

Status: proposed. Source: product direction discussion (2026-10-31), learner track.

## Objective

Make Asterism a tool that builds the learner's own ability. Learning modes
change how the agent responds: it asks guiding questions, gives hints in tiers,
grades the learner's explanations, and reviews the learner's attempts instead of
handing over finished answers.

## Ownership and delivery

- A **learning mode** is a server-owned, versioned prompt layer, pinned to a chat
  branch when a message is accepted (the same pattern as skills, ADR-0023). It
  is rechecked on replay. Mode text grants no capabilities.
- Modes compose with the persona and skill layers. The composition order goes in
  `execution-context.md`.
- Hint state is stored per chat branch, so regenerating and branching behave
  predictably.
- Prompt-level behavior is best effort: a model can still leak an answer.
  Structural tests cover pinning, layering and hint state. A small fixture-based
  evaluation set tracks how well models comply; it does not gate CI.
- Locks set by an educator are out of scope here; see EPIC-60.

## US-52.1: Learning mode foundation

As a learner, I want to choose how the AI helps me in a chat.

Estimate: 2 days. Dependencies: none.

Acceptance: the composer offers a mode picker: Standard, Tutor, Explain-back and
Review my work. The chosen mode is pinned at acceptance, recorded in message
provenance, shown as a chip, and preserved on resume. Regeneration captures the
current selection.

- [ ] Write an ADR for the learning-mode layer, pinning and composition order.
- [ ] Implement mode definitions, branch pinning and provenance; regenerate the client.
- [ ] Build the composer picker and message chip.
- [ ] Test pinning, resume, regeneration and layering with personas and skills.

## US-52.2: Socratic tutor with tiered hints

As a learner, I want hints that get stronger only when I ask.

Estimate: 2.5 days. Dependencies: US-52.1.

Acceptance: in Tutor mode the agent answers with questions and guidance. The
learner can ask for "Nudge", "Hint" or "Worked example", which raises the hint
level for that branch. The full answer needs an explicit "Show answer" action
with a confirmation step. The current level appears in the UI and is passed to
the mode layer.

- [ ] Add branch hint state and the level-raising actions; regenerate the client.
- [ ] Write the tutor mode instructions for each level.
- [ ] Build the hint controls and answer-reveal confirmation.
- [ ] Add structural tests and tutor fixtures to the evaluation set.

## US-52.3: Explain it back

As a learner, I want to check my understanding by explaining a concept.

Estimate: 1.5 days. Dependencies: US-52.1.

Acceptance: in Explain-back mode the agent asks the learner to explain a topic,
then replies with what was correct, what was missing or wrong, and one or two
follow-up questions. It does not rewrite the learner's explanation unless asked.

- [ ] Write the mode instructions and a structured feedback format.
- [ ] Render the feedback sections; add evaluation fixtures.

## US-52.4: Review my work

As a learner, I want feedback on my attempt rather than a finished solution.

Estimate: 1.5 days. Dependencies: US-52.1.

Acceptance: in Review mode the learner pastes or attaches an attempt (math,
code, or an essay excerpt). The agent identifies the first error or weakest
point, explains why, and suggests a next step. A full corrected solution needs
the same explicit reveal action as US-52.2.

- [ ] Write the mode instructions and reuse the reveal action.
- [ ] Test attachment handling in Review mode; add evaluation fixtures.

## US-52.5: Self-imposed mode lock

As a learner, I want to commit to learning mode so I'm not tempted to skip ahead.

Estimate: 1 day. Dependencies: US-52.2.

Acceptance: the learner can lock a chat's mode. While locked, switching to
Standard or revealing answers requires a deliberate confirmation with a short
delay. The lock is recorded in the chat and visible in its header.

- [ ] Add the chat lock state and confirmation flow; test lock persistence and unlocking.
