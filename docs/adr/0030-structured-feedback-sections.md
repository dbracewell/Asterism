# ADR-0030 — Structured feedback sections for learning modes

Status: accepted for US-52.3 on 2026-11-01.

## Context

In Explain-back mode the learner explains a topic, and the agent replies with
what was correct, what was missing or wrong, and one or two follow-up
questions. The UI should show these parts as distinct sections. Model output is
free text, and a reply can stream for some time before it is complete.

## Decision

**Fixed Markdown headings, not a tool call or JSON.** A
`LearningModeDefinition` may list `feedback_sections`: ordered `(id, heading)`
pairs. Explain-back (version 2) defines `correct` / "What you got right",
`gaps` / "What was missing or wrong" and `follow_up` / "Follow-up questions".
Its instruction text is built from the same constants and tells the model to use
the headings, in order, only for feedback on an explanation. Headings work with
every provider, stream naturally, and degrade to readable Markdown when a model
ignores them. Structured output or a tool call would need provider support the
mode layer cannot assume.

**The catalog is the contract.** `GET /learning-modes` returns each mode's
`feedback_sections` (IDs and headings only; instruction text stays private). The
UI parses a reply against the catalog headings for the reply's mode, so the
headings are not copied into frontend code.

**Lenient parsing, plain fallback.** A heading line may use any level, bold or a
trailing colon, and matches case-insensitively. A reply is structured only if
the first section's heading is present and the found headings are in order;
otherwise it renders as plain Markdown. That covers the opening request to
explain, an explicitly requested model answer (which the mode text says to give
without headings), and models that do not comply. Later sections may be missing
while streaming. The streaming `start` event's execution supplies the mode so
the sections render live.

**Evaluation.** Fixture cases may set `feedback: structured` (headings present,
in order, one or two questions in the follow-up section) or `free_form` (no
headings). Like the tutor fixtures, they never gate CI.

## Consequences

- Changing a heading needs a mode `version` bump. Replies pinned under an older
  heading render as plain Markdown, which stays readable.
- US-52.4 can give Review mode its own sections without frontend changes.
- No schema change and no reset needed.
