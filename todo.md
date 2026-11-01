# Todo

Completed Projects/Chat Context and provider-settings work remains in the existing archives. This checklist tracks the findings from the [2026-10-17 review](docs/reviews/2026-10-17-codebase-review.md). See the [sequenced roadmap](docs/plans/post-refactor-quality-roadmap.md).

Archives: [2026-11-01](docs/archive/todo-completed-2026-11-01.md), [2026-10-31](docs/archive/todo-completed-2026-10-31.md), [2026-10-14](docs/archive/todo-completed-2026-10-14.md), [2026-10-15](docs/archive/todo-completed-2026-10-15.md), [2026-10-16](docs/archive/todo-completed-2026-10-16.md), [2026-10-17](docs/archive/todo-completed-2026-10-17.md), [2026-10-18](docs/archive/todo-completed-2026-10-18.md), [2026-10-19](docs/archive/todo-completed-2026-10-19.md), [2026-10-23](docs/archive/todo-completed-2026-10-23.md), [2026-10-24](docs/archive/todo-completed-2026-10-24.md), [2026-10-25](docs/archive/todo-completed-2026-10-25.md), [2026-10-27](docs/archive/todo-completed-2026-10-27.md), [2026-10-28](docs/archive/todo-completed-2026-10-28.md), [2026-10-29](docs/archive/todo-completed-2026-10-29.md), [2026-10-30](docs/archive/todo-completed-2026-10-30.md), and [US-28.3 verification](docs/archive/us-28.3-verification-2026-10-17.md).

EPIC-31 and EPIC-32 are confirmed complete and archived above. US-38.1 through US-38.6 are confirmed complete and archived above. EPIC-33 (US-33.1 through US-33.3) is confirmed complete and archived above. EPIC-36 (US-36.1) and EPIC-37 (US-37.1) are complete; their already-merged implementation and completed checklists are reconciled and archived above. See the [2026-10-24 reassessment](docs/reviews/2026-10-24-open-epics-reassessment.md). EPIC-34 (US-34.1 through US-34.4) is confirmed complete and archived above, including finite chat admission and the current browser baseline; the old agent-selector repairs are already present. EPIC-35 (US-35.1 and US-35.2) is confirmed complete and archived above. Execute one story at a time; obtain completion confirmation before merge.

EPIC-39 and EPIC-40 are confirmed complete and archived in the
[2026-10-25 checklist](docs/archive/todo-completed-2026-10-25.md).
The 320px short-height composer clipping is fixed in US-40.4.

US-61.4 is implemented on `feature/us-61.4-guided-first-chat-tour` and awaits confirmation; US-61.1 through US-61.3 are complete and US-61.5 is next. EPIC-52 (US-52.1 through US-52.5) is confirmed complete and archived in the [2026-11-01 checklist](docs/archive/todo-completed-2026-11-01.md); EPIC-61 (in-app help) is next, followed by EPIC-53. EPIC-51 (US-51.1 through US-51.7) is confirmed complete and archived in the [2026-10-31 checklist](docs/archive/todo-completed-2026-10-31.md). US-54.4 (pulled ahead of EPIC-52 to unblock US-51.7) is also complete. EPIC-49 (ChatGPT plan connection) and EPIC-50
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

Source: product direction discussion (2026-10-31). Suggested order: EPIC-51 → 52 → 61 → 53 → 54 → 56 → 55 → 57 → 58 → 59. EPIC-60 is deferred until the multi-user web vs. single-user desktop decision. EPIC-51 is complete and archived; EPIC-52 is complete and archived; EPIC-61 is next (added 2026-11-01), then EPIC-53.

### [EPIC-61: In-app help and guided onboarding](docs/epics/EPIC-61-IN-APP-HELP-AND-GUIDED-ONBOARDING.md)

Confirmed (2026-11-01) to run next, before EPIC-53, so learners can understand personas, skills, learning modes and other composer concepts. The tour is built on existing shadcn/ui primitives (no tour library).

- [x] US-61.1: Help content foundation
  - [x] Write an ADR for help content ownership, the registry shape and the accuracy rules.
  - [x] Implement the typed registry, glossary entries and the help popover component.
  - [x] Migrate existing `HelpIcon` uses where appropriate; document the convention for new features.
  - [x] Test registry completeness, admin-only filtering, keyboard and touch access, and contrast.
- [x] US-61.2: Composer help
  - [x] Add help triggers and mode descriptions to the composer controls.
  - [x] Verify layout at narrow and short viewports; update composer tests.
- [x] US-61.3: Page help panel
  - [x] Implement the page help sheet, route mapping and the keyboard shortcut.
  - [x] Write the page guides and update the empty states.
  - [x] Test route coverage, the shortcut's focus rules and admin-only sections.
- [x] US-61.4: Guided first-chat tour
  - [x] Add per-user onboarding state to the user preferences API; regenerate the client.
  - [x] Build the tour on existing shadcn/ui primitives, with skip, back and restart.
  - [x] Test first-visit behavior, persistence, restart, skipped steps and accessibility.
- [ ] US-61.5: Help center page
  - [ ] Build the help center page with search and anchor links.
  - [ ] Add a Playwright check that every "Learn more" link resolves to an entry.

### [EPIC-53: Study tools from project files](docs/epics/EPIC-53-STUDY-TOOLS-FROM-PROJECT-FILES.md)

- [ ] US-53.1: Study domain and decks
  - [ ] Write an ADR for the study domain and the scheduling algorithm choice.
  - [ ] Implement models, queries, service and router; regenerate the client.
  - [ ] Test owner and project isolation and cascade deletion.
- [ ] US-53.2: Generate flashcards from files
  - [ ] Implement bounded generation through RetrievalService with citation capture.
  - [ ] Build the draft review screen with accept/edit/discard.
  - [ ] Test scope enforcement, limits, partial failure and citation links.
- [ ] US-53.3: Spaced-repetition review
  - [ ] Implement the scheduler interface, review log and due queries.
  - [ ] Build the review session UI with keyboard shortcuts.
  - [ ] Test scheduling math, due ordering and accessibility.
- [ ] US-53.4: Practice quizzes
  - [ ] Implement quiz generation, attempts and grading.
  - [ ] Build quiz-taking and results screens with citations.
  - [ ] Test grading paths, citation scope and attempt history.
- [ ] US-53.5: Adaptive follow-up
  - [ ] Derive weak spots from attempts and review logs; build the practice entry point; add tests.
- [ ] US-53.6: Summaries and study guides
  - [ ] Implement depth-controlled summaries and study-guide generation.
  - [ ] Build the save action; test citation scope and plan generation.

### [EPIC-54: Run inspection, replay and comparison](docs/epics/EPIC-54-RUN-INSPECTION-REPLAY-AND-COMPARISON.md)

- [ ] US-54.1: Per-step usage and cost
  - [ ] Record per-step usage on delegation records and messages.
  - [ ] Add optional price metadata to model settings; regenerate the client.
  - [ ] Build the usage summary and breakdown; test totals, missing prices and plan runs.
- [ ] US-54.2: Capability manifest
  - [ ] Capture the effective capability set with grant reasons at execution time.
  - [ ] Build the manifest panel; test accuracy against authorization fixtures.
- [ ] US-54.3: Context inspector
  - [ ] Record a context manifest (layer IDs and revisions, chunk references, truncations).
  - [ ] Build the inspector; test owner-only access and the untrusted rendering path.
- [x] US-54.4: Side-by-side comparison
  - [x] Implement multi-target submission as sibling branches within chat admission limits.
  - [x] Build the comparison layout (columns that stack on narrow screens).
  - [x] Test admission limits, branch provenance and continuation.
- [ ] US-54.5: Fork from a step
  - [ ] Write an ADR for fork semantics (what is reused versus re-executed).
  - [ ] Implement the fork execution path; build the fork UI.
  - [ ] Test isolation of the original branch, scope inheritance and explicit-save behavior.
- [ ] US-54.6: Run diff
  - [ ] Build the diff view over recorded data; test it with fixture runs.

### [EPIC-55: Grounded answers and claim verification](docs/epics/EPIC-55-GROUNDED-ANSWERS-AND-CLAIM-VERIFICATION.md)

- [ ] US-55.1: Claim-level citations
  - [ ] Define the span-citation format in the model output contract and parse it at persistence.
  - [ ] Render span markers and previews; test parsing, scope and unavailable files.
- [ ] US-55.2: Verify pass
  - [ ] Implement claim extraction and per-claim retrieval checks with limits.
  - [ ] Store results with provenance and build the claim overlay.
  - [ ] Test scope narrowing, limits and label rendering; add evaluation fixtures.
- [ ] US-55.3: Disagreement display
  - [ ] Implement a bounded claim-comparison pass; build the summary; add tests.
- [ ] US-55.4: Spot-the-error exercise
  - [ ] Add the exercise mode with a recorded error and reveal flow.
  - [ ] Ensure exercise labelling in history and exports; add tests.

### [EPIC-56: Inline user files in Markdown output](docs/epics/EPIC-56-INLINE-USER-FILES-IN-MARKDOWN-OUTPUT.md)

- [ ] US-56.1: Reference contract and ADR
  - [ ] Write the ADR and update the Markdown trust documentation.
- [ ] US-56.2: Produced-file registration
  - [ ] Add the `origin` and provenance columns and the registration service in the files domain.
  - [ ] Enforce limits and content detection; return reference tokens in tool results.
  - [ ] Test limits, type detection, provenance, sub-agent ownership and scope membership.
- [ ] US-56.3: Reference resolution at save time
  - [ ] Implement parsing and resolution in the chat domain; expose resolved references.
  - [ ] Test foreign, missing, out-of-scope and deleted files, and identical 404 behavior.
- [ ] US-56.4: Inline images
  - [ ] Build `InlineFile` image rendering and the lightbox; implement SVG handling.
  - [ ] Add adversarial browser tests (foreign IDs, URL-shaped tokens, script-bearing SVG).
- [ ] US-56.5: Document cards and previews
  - [ ] Build the document card and preview using cached conversions.
  - [ ] Decide and document the thumbnail approach; test cards for each supported type.
- [ ] US-56.6: Model instructions and accessibility
  - [ ] Add the conditional prompt guidance and copy-text behavior.
  - [ ] Add accessibility and keyboard tests.

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
