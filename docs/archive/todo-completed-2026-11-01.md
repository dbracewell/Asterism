# Completed checklist — 2026-11-01

The user confirmed US-52.5 completion and authorized a local merge on
2026-11-01. EPIC-52 (US-52.1 through US-52.5) is complete; each story was
confirmed and merged with `--no-ff` before the next began. See ADR-0028
through ADR-0031.

### [EPIC-52: Tutor mode and guided learning](../epics/EPIC-52-TUTOR-MODE-AND-GUIDED-LEARNING.md)

- [x] US-52.1: Learning mode foundation
  - [x] Write an ADR for the learning-mode layer, pinning and composition order.
  - [x] Implement mode definitions, branch pinning and provenance; regenerate the client.
  - [x] Build the composer picker and message chip.
  - [x] Test pinning, resume, regeneration and layering with personas and skills.
- [x] US-52.2: Socratic tutor with tiered hints
  - [x] Add branch hint state and the level-raising actions; regenerate the client.
  - [x] Write the tutor mode instructions for each level.
  - [x] Build the hint controls and answer-reveal confirmation.
  - [x] Add structural tests and tutor fixtures to the evaluation set.
- [x] US-52.3: Explain it back
  - [x] Write the mode instructions and a structured feedback format.
  - [x] Render the feedback sections; add evaluation fixtures.
- [x] US-52.4: Review my work
  - [x] Write the mode instructions and reuse the reveal action.
  - [x] Test attachment handling in Review mode; add evaluation fixtures.
- [x] US-52.5: Self-imposed mode lock
  - [x] Add the chat lock state and confirmation flow; test lock persistence and unlocking.

The user confirmed US-61.5 completion and authorized a local merge on
2026-11-01. EPIC-61 (US-61.1 through US-61.5) is complete; each story was
confirmed and merged with `--no-ff` before the next began. See ADR-0032.

### [EPIC-61: In-app help and guided onboarding](../epics/EPIC-61-IN-APP-HELP-AND-GUIDED-ONBOARDING.md)

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
- [x] US-61.5: Help center page
  - [x] Build the help center page with search and anchor links.
  - [x] Add a Playwright check that every "Learn more" link resolves to an entry.

The user confirmed US-53.6 completion and authorized a local merge on
2026-11-01. EPIC-53 (US-53.1 through US-53.6) is complete; each story was
confirmed and merged with `--no-ff` before the next began. See ADR-0033
through ADR-0037.

### [EPIC-53: Study tools from project files](../epics/EPIC-53-STUDY-TOOLS-FROM-PROJECT-FILES.md)

- [x] US-53.1: Study domain and decks
  - [x] Write an ADR for the study domain and the scheduling algorithm choice.
  - [x] Implement models, queries, service and router; regenerate the client.
  - [x] Test owner and project isolation and cascade deletion.
- [x] US-53.2: Generate flashcards from files
  - [x] Implement bounded generation through RetrievalService with citation capture.
  - [x] Build the draft review screen with accept/edit/discard.
  - [x] Test scope enforcement, limits, partial failure and citation links.
- [x] US-53.3: Spaced-repetition review
  - [x] Implement the scheduler interface, review log and due queries.
  - [x] Build the review session UI with keyboard shortcuts.
  - [x] Test scheduling math, due ordering and accessibility.
- [x] US-53.4: Practice quizzes
  - [x] Implement quiz generation, attempts and grading.
  - [x] Build quiz-taking and results screens with citations.
  - [x] Test grading paths, citation scope and attempt history.
- [x] US-53.5: Adaptive follow-up
  - [x] Derive weak spots from attempts and review logs; build the practice entry point; add tests.
- [x] US-53.6: Summaries and study guides
  - [x] Implement depth-controlled summaries and study-guide generation.
  - [x] Build the save action; test citation scope and plan generation.
