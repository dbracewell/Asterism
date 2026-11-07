# Completed checklist — 2026-11-06

The user confirmed US-57.4 completion and authorized a local merge on
2026-11-06. EPIC-57 (US-57.1 through US-57.4) is complete; each story was
confirmed and merged with `--no-ff` before the next began. See ADR-0044
(rubrics and Draft feedback), ADR-0045 (inline draft comments) and ADR-0046
(AI-use log). US-57.3 (Research assistant mode) is prompt-only and documented
in the execution-context architecture note.

### [EPIC-57: Writing feedback and AI-use transparency](../epics/EPIC-57-WRITING-FEEDBACK-AND-AI-USE-TRANSPARENCY.md)

- [x] US-57.1: Rubric-based draft feedback (confirmed and merged 2026-11-03)
  - [x] Add the rubric template kind and bundled rubrics.
  - [x] Add the feedback mode and structured output rendering; add tests and evaluation fixtures.
- [x] US-57.2: Inline comments (confirmed and merged 2026-11-03)
  - [x] Implement span anchoring with fallback; build the comment view.
  - [x] Test anchoring accuracy and resolution state.
- [x] US-57.3: Research assistant mode (confirmed and merged 2026-11-03)
  - [x] Write the mode instructions and an outline output format; add evaluation fixtures.
- [x] US-57.4: AI-use log export (confirmed and merged 2026-11-06)
  - [x] Build the log from recorded provenance; add selection and export.
  - [x] Test completeness, owner scoping and labelling.

The user confirmed US-58.4 completion and authorized a local merge on
2026-11-06. EPIC-58 (US-58.1 through US-58.4) is complete; each story was
confirmed and merged with `--no-ff` before the next began. See ADR-0047
(project learning goals), ADR-0048 (session reflections), ADR-0049 (topic
mastery) and ADR-0050 (unclear items). US-58.2 also fixed AI-use log times from
US-57.4, which mixed seconds and milliseconds.

### [EPIC-58: Learning goals, reflection and progress](../epics/EPIC-58-LEARNING-GOALS-REFLECTION-AND-PROGRESS.md)

- [x] US-58.1: Project learning goals (confirmed and merged 2026-11-06)
  - [x] Add goal fields to projects and the explicit context inclusion; regenerate the client.
  - [x] Build goal editing and display; test inclusion and provenance.
- [x] US-58.2: Session reflections (confirmed and merged 2026-11-06)
  - [x] Implement the reflection records and the optional draft suggestion.
  - [x] Build the reflect flow and list; test owner and profile partitioning.
- [x] US-58.3: Topic mastery (confirmed and merged 2026-11-06)
  - [x] Implement mastery computation over study data; build the progress view; add tests.
- [x] US-58.4: Unclear items feed review (confirmed and merged 2026-11-06)
  - [x] Add the conversion action and confirmation; test it end to end.

The user confirmed US-59.4 completion and authorized a local merge on
2026-11-06. EPIC-59 (US-59.1 through US-59.4) is complete; each story was
confirmed and merged with `--no-ff` before the next began. See ADR-0051 (team
pack format, with addenda for export, import and starter packs). Packs cannot
carry a learning mode, so Study Buddy's Tutor uses its own instructions.

### [EPIC-59: Shareable team packs](../epics/EPIC-59-SHAREABLE-TEAM-PACKS.md)

- [x] US-59.1: Pack format and ADR (confirmed and merged 2026-11-06)
  - [x] Write the ADR and schema; implement the validator with tests.
- [x] US-59.2: Export (confirmed and merged 2026-11-06)
  - [x] Implement export selection and serialization; test the round trip and that no secrets are included.
- [x] US-59.3: Import with explicit review (confirmed and merged 2026-11-06)
  - [x] Implement the import review API and transactional creation.
  - [x] Build the review screen; test conflicts, model selection, policy limits and rollback.
- [x] US-59.4: Starter packs (confirmed and merged 2026-11-06)
  - [x] Author and validate the bundled packs; add install tests.
