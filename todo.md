# Todo

Completed Projects/Chat Context and provider-settings work remains in the existing archives. This checklist tracks the findings from the [2026-10-17 review](docs/reviews/2026-10-17-codebase-review.md). See the [sequenced roadmap](docs/plans/post-refactor-quality-roadmap.md).

Archives: [2026-11-02](docs/archive/todo-completed-2026-11-02.md), [2026-11-01](docs/archive/todo-completed-2026-11-01.md), [2026-10-31](docs/archive/todo-completed-2026-10-31.md), [2026-10-14](docs/archive/todo-completed-2026-10-14.md), [2026-10-15](docs/archive/todo-completed-2026-10-15.md), [2026-10-16](docs/archive/todo-completed-2026-10-16.md), [2026-10-17](docs/archive/todo-completed-2026-10-17.md), [2026-10-18](docs/archive/todo-completed-2026-10-18.md), [2026-10-19](docs/archive/todo-completed-2026-10-19.md), [2026-10-23](docs/archive/todo-completed-2026-10-23.md), [2026-10-24](docs/archive/todo-completed-2026-10-24.md), [2026-10-25](docs/archive/todo-completed-2026-10-25.md), [2026-10-27](docs/archive/todo-completed-2026-10-27.md), [2026-10-28](docs/archive/todo-completed-2026-10-28.md), [2026-10-29](docs/archive/todo-completed-2026-10-29.md), [2026-10-30](docs/archive/todo-completed-2026-10-30.md), and [US-28.3 verification](docs/archive/us-28.3-verification-2026-10-17.md).

EPIC-31 and EPIC-32 are confirmed complete and archived above. US-38.1 through US-38.6 are confirmed complete and archived above. EPIC-33 (US-33.1 through US-33.3) is confirmed complete and archived above. EPIC-36 (US-36.1) and EPIC-37 (US-37.1) are complete; their already-merged implementation and completed checklists are reconciled and archived above. See the [2026-10-24 reassessment](docs/reviews/2026-10-24-open-epics-reassessment.md). EPIC-34 (US-34.1 through US-34.4) is confirmed complete and archived above, including finite chat admission and the current browser baseline; the old agent-selector repairs are already present. EPIC-35 (US-35.1 and US-35.2) is confirmed complete and archived above. Execute one story at a time; obtain completion confirmation before merge.

EPIC-39 and EPIC-40 are confirmed complete and archived in the
[2026-10-25 checklist](docs/archive/todo-completed-2026-10-25.md).
The 320px short-height composer clipping is fixed in US-40.4.

EPIC-56 (US-56.1 through US-56.6) and EPIC-54 (US-54.1 through US-54.6) are confirmed complete and archived in the [2026-11-02 checklist](docs/archive/todo-completed-2026-11-02.md); EPIC-55 is next. EPIC-62 (US-62.1 and US-62.2) is confirmed complete and archived in the [2026-11-01 checklist](docs/archive/todo-completed-2026-11-01.md). EPIC-53 (US-53.1 through US-53.6) is confirmed complete and archived in the [2026-11-01 checklist](docs/archive/todo-completed-2026-11-01.md). EPIC-61 (US-61.1 through US-61.5) and EPIC-52 (US-52.1 through US-52.5) are confirmed complete and archived in the [2026-11-01 checklist](docs/archive/todo-completed-2026-11-01.md). EPIC-51 (US-51.1 through US-51.7) is confirmed complete and archived in the [2026-10-31 checklist](docs/archive/todo-completed-2026-10-31.md). EPIC-49 (ChatGPT plan connection) and EPIC-50
(ChatGPT plan chat titles) are confirmed
complete and archived in the [2026-10-31 checklist](docs/archive/todo-completed-2026-10-31.md). EPIC-47 (quality baseline cleanup) and EPIC-48
(first-run provider setup) are confirmed complete and archived in the [2026-10-30 checklist](docs/archive/todo-completed-2026-10-30.md). Earlier verification
limits are recorded in the [US-40.4 verification record and admin-policy addendum](docs/reviews/us-40.4-slash-skills-verification-2026-10-25.md).

## Visual design epics (proposed)

Source: approved visual design audit (2026-10-26). Suggested order: EPIC-41 → 43 → 44 → 45 → 42 → 46. EPIC-41 is confirmed complete and archived in the
[2026-10-27 checklist](docs/archive/todo-completed-2026-10-27.md); EPIC-43 is confirmed complete and archived in the
[2026-10-28 checklist](docs/archive/todo-completed-2026-10-28.md); EPIC-44, EPIC-45 and EPIC-42 are confirmed complete and archived in the
[2026-10-29 checklist](docs/archive/todo-completed-2026-10-29.md); EPIC-46 is confirmed complete and archived in the
[2026-10-30 checklist](docs/archive/todo-completed-2026-10-30.md). All visual design epics are complete.

## Product direction epics (proposed)

Source: product direction discussion (2026-10-31). Suggested order: EPIC-51 → 52 → 61 → 53 → 54 → 56 → 55 → 57 → 58 → 59. EPIC-60 is deferred until the multi-user web vs. single-user desktop decision. EPIC-51, EPIC-52, EPIC-61, EPIC-53, EPIC-54 and EPIC-56 are complete and archived; EPIC-55 is next.

### [EPIC-55: Grounded answers and claim verification](docs/epics/EPIC-55-GROUNDED-ANSWERS-AND-CLAIM-VERIFICATION.md)

- [x] US-55.1: Claim-level citations (confirmed and merged 2026-11-02)
  - [x] Define the span-citation format in the model output contract and parse it at persistence.
  - [x] Render span markers and previews; test parsing, scope and unavailable files.
- [ ] US-55.2: Verify pass
  - [ ] Implement claim extraction and per-claim retrieval checks with limits.
  - [ ] Store results with provenance and build the claim overlay.
  - [ ] Test scope narrowing, limits and label rendering; add evaluation fixtures.
- [ ] US-55.3: Disagreement display
  - [ ] Implement a bounded claim-comparison pass; build the summary; add tests.
- [ ] US-55.4: Spot-the-error exercise
  - [ ] Add the exercise mode with a recorded error and reveal flow.
  - [ ] Ensure exercise labelling in history and exports; add tests.

### [EPIC-57: Writing feedback and AI-use transparency](docs/epics/EPIC-57-WRITING-FEEDBACK-AND-AI-USE-TRANSPARENCY.md)

- [ ] US-57.1: Rubric-based draft feedback
  - [ ] Add the rubric template kind and bundled rubrics.
  - [ ] Add the feedback mode and structured output rendering; add tests and evaluation fixtures.
- [ ] US-57.2: Inline comments
  - [ ] Implement span anchoring with fallback; build the comment view.
  - [ ] Test anchoring accuracy and resolution state.
- [ ] US-57.3: Research assistant mode
  - [ ] Write the mode instructions and an outline output format; add evaluation fixtures.
- [ ] US-57.4: AI-use log export
  - [ ] Build the log from recorded provenance; add selection and export.
  - [ ] Test completeness, owner scoping and labelling.

### [EPIC-58: Learning goals, reflection and progress](docs/epics/EPIC-58-LEARNING-GOALS-REFLECTION-AND-PROGRESS.md)

- [ ] US-58.1: Project learning goals
  - [ ] Add goal fields to projects and the explicit context inclusion; regenerate the client.
  - [ ] Build goal editing and display; test inclusion and provenance.
- [ ] US-58.2: Session reflections
  - [ ] Implement the reflection records and the optional draft suggestion.
  - [ ] Build the reflect flow and list; test owner and profile partitioning.
- [ ] US-58.3: Topic mastery
  - [ ] Implement mastery computation over study data; build the progress view; add tests.
- [ ] US-58.4: Unclear items feed review
  - [ ] Add the conversion action and confirmation; test it end to end.

### [EPIC-59: Shareable team packs](docs/epics/EPIC-59-SHAREABLE-TEAM-PACKS.md)

- [ ] US-59.1: Pack format and ADR
  - [ ] Write the ADR and schema; implement the validator with tests.
- [ ] US-59.2: Export
  - [ ] Implement export selection and serialization; test the round trip and that no secrets are included.
- [ ] US-59.3: Import with explicit review
  - [ ] Implement the import review API and transactional creation.
  - [ ] Build the review screen; test conflicts, model selection, policy limits and rollback.
- [ ] US-59.4: Starter packs
  - [ ] Author and validate the bundled packs; add install tests.

### [EPIC-60: Educator and class policy](docs/epics/EPIC-60-EDUCATOR-AND-CLASS-POLICY.md)

- [ ] US-60.1: Classes and the educator role
  - [ ] Write an ADR for classes, the educator role and the authorization model.
  - [ ] Implement the domain and membership; test isolation between classes and roles.
- [ ] US-60.2: Course packs
  - [ ] Implement publishing and student provisioning; test versioning and access.
- [ ] US-60.3: Class mode policy
  - [ ] Implement policy composition and live checks; build the policy display; test narrowing-only behavior.
- [ ] US-60.4: Aggregate misconception insights
  - [ ] Implement thresholded aggregation and consent; build the dashboard; test privacy limits.
