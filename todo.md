# Todo

Completed Projects/Chat Context and provider-settings work remains in the existing archives. This checklist tracks the findings from the [2026-10-17 review](docs/reviews/2026-10-17-codebase-review.md). See the [sequenced roadmap](docs/plans/post-refactor-quality-roadmap.md).

Archives: [2026-10-14](docs/archive/todo-completed-2026-10-14.md), [2026-10-15](docs/archive/todo-completed-2026-10-15.md), [2026-10-16](docs/archive/todo-completed-2026-10-16.md), [2026-10-17](docs/archive/todo-completed-2026-10-17.md), [2026-10-18](docs/archive/todo-completed-2026-10-18.md), [2026-10-19](docs/archive/todo-completed-2026-10-19.md), [2026-10-23](docs/archive/todo-completed-2026-10-23.md), [2026-10-24](docs/archive/todo-completed-2026-10-24.md), [2026-10-25](docs/archive/todo-completed-2026-10-25.md), [2026-10-27](docs/archive/todo-completed-2026-10-27.md), [2026-10-28](docs/archive/todo-completed-2026-10-28.md), [2026-10-29](docs/archive/todo-completed-2026-10-29.md), [2026-10-30](docs/archive/todo-completed-2026-10-30.md), and [US-28.3 verification](docs/archive/us-28.3-verification-2026-10-17.md).

EPIC-31 and EPIC-32 are confirmed complete and archived above. US-38.1 through US-38.6 are confirmed complete and archived above. EPIC-33 (US-33.1 through US-33.3) is confirmed complete and archived above. EPIC-36 (US-36.1) and EPIC-37 (US-37.1) are complete; their already-merged implementation and completed checklists are reconciled and archived above. See the [2026-10-24 reassessment](docs/reviews/2026-10-24-open-epics-reassessment.md). EPIC-34 (US-34.1 through US-34.4) is confirmed complete and archived above, including finite chat admission and the current browser baseline; the old agent-selector repairs are already present. EPIC-35 (US-35.1 and US-35.2) is confirmed complete and archived above. Execute one story at a time; obtain completion confirmation before merge.

EPIC-39 and EPIC-40 are confirmed complete and archived in the
[2026-10-25 checklist](docs/archive/todo-completed-2026-10-25.md).
The 320px short-height composer clipping is fixed in US-40.4.

EPIC-47 (quality baseline cleanup) is active; see below. Earlier verification
limits are recorded in the [US-40.4 verification record and admin-policy addendum](docs/reviews/us-40.4-slash-skills-verification-2026-10-25.md).

## Visual design epics (proposed)

Source: approved visual design audit (2026-10-26). Suggested order: EPIC-41 → 43 → 44 → 45 → 42 → 46. EPIC-41 is confirmed complete and archived in the
[2026-10-27 checklist](docs/archive/todo-completed-2026-10-27.md); EPIC-43 is confirmed complete and archived in the
[2026-10-28 checklist](docs/archive/todo-completed-2026-10-28.md); EPIC-44, EPIC-45 and EPIC-42 are confirmed complete and archived in the
[2026-10-29 checklist](docs/archive/todo-completed-2026-10-29.md); EPIC-46 is confirmed complete and archived in the
[2026-10-30 checklist](docs/archive/todo-completed-2026-10-30.md). All visual design epics are complete.

## [EPIC-47: Quality baseline cleanup](docs/epics/EPIC-47-QUALITY-BASELINE-CLEANUP.md)

- [ ] US-47.1: Format gate (implemented on `feature/us-47.1-format-gate`; awaiting confirmation)
  - [x] Format the existing drift; add backend and frontend `format:check` scripts and a root script; run it in CI.

- [ ] US-47.2: Unit test baseline (implemented on `feature/us-47.2-unit-baseline`; awaiting confirmation)
  - [x] Triage and fix the failing frontend unit test(s); confirm the backend suite stays green.

- [ ] US-47.3: Browser test baseline
  - [ ] Run the full isolated suite; triage and fix each failing spec.

- [ ] US-47.4: Deterministic local browser runs
  - [ ] Find the source of the cold-start failures; warm or otherwise stabilize the server before specs; verify with repeated runs.
