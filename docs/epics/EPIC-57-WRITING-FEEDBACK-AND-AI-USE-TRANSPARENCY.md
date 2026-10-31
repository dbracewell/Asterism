# EPIC-57: Writing feedback and AI-use transparency

Status: proposed. Source: product direction discussion (2026-10-31), learner track.

## Objective

Support students' writing and research without writing for them, and let them
show honestly how they used AI. Feedback is tied to a rubric and anchored to the
student's own text. A research mode finds and evaluates sources and builds
outlines, but writes no prose. An exportable AI-use log documents the process.

## Ownership and delivery

- Rubrics reuse the EPIC-51 template domain as a "rubric" kind (criteria,
  levels, descriptors), with bundled examples.
- Feedback and research behavior are learning modes (EPIC-52 layer).
- The AI-use log is built from existing message provenance (models, modes,
  templates, skills, files, verification). The user chooses what to include.
  The log never claims to detect AI use; it only documents it.

## US-57.1: Rubric-based draft feedback

As a student, I want feedback on my draft against the assignment rubric.

Estimate: 2.5 days. Dependencies: US-51.1, US-52.1.

Acceptance: the student attaches or pastes a draft and picks a rubric. Feedback
is organized by criterion, gives an estimated level, and quotes the passages it
refers to. The draft is not rewritten unless the student explicitly asks for an
example rewrite of one passage.

- [ ] Add the rubric template kind and bundled rubrics.
- [ ] Add the feedback mode and structured output rendering; add tests and evaluation fixtures.

## US-57.2: Inline comments

As a student, I want feedback pinned to the sentences it's about.

Estimate: 2.5 days. Dependencies: US-57.1.

Acceptance: a draft view shows the student's text with comments anchored to
spans, like margin comments. Selecting a comment highlights its span. Comments
that can't be anchored are listed separately. The student can mark comments
resolved.

- [ ] Implement span anchoring with fallback; build the comment view.
- [ ] Test anchoring accuracy and resolution state.

## US-57.3: Research assistant mode

As a student, I want help finding and judging sources, not having my paper written.

Estimate: 2 days. Dependencies: US-52.1.

Acceptance: in Research mode the agent suggests search angles, evaluates sources
(credibility, relevance, bias), and builds outlines with citations. It declines
to draft prose paragraphs and explains why. Web access follows the agent's
normal capability rules.

- [ ] Write the mode instructions and an outline output format; add evaluation fixtures.

## US-57.4: AI-use log export

As a student, I want to show my teacher how I used AI on an assignment.

Estimate: 2 days. Dependencies: none. Better with EPIC-52 and EPIC-54.

Acceptance: from a chat or project, the student can export a log (Markdown or
PDF) listing their prompts, modes, models, templates, files used and
verification results, with timestamps. The student chooses which chats and
messages to include. Exercise content (US-55.4) is labelled.

- [ ] Build the log from recorded provenance; add selection and export.
- [ ] Test completeness, owner scoping and labelling.
