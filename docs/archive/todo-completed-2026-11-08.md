# Completed checklist — 2026-11-08

The user confirmed US-66.3 completion on 2026-11-08. EPIC-66 (US-66.1 through
US-66.3) is complete; each story was confirmed and merged with `--no-ff` before
the next began. See ADR-0032 (in-app help content).

### [EPIC-66: Help coverage](../epics/EPIC-66-HELP-COVERAGE.md)

- [x] US-66.1: Page guides for every page (confirmed and merged 2026-11-08)
  - [x] Write the missing guides and mappings.
  - [x] Add the coverage test over routes and settings sections.
- [x] US-66.2: Glossary and inline help for newer features (confirmed and merged 2026-11-08)
  - [x] Add glossary entries and inline triggers; review wording for accuracy.
  - [x] Extend help tests and the help E2E for the new surfaces.
- [x] US-66.3: Help consistency pass (confirmed and merged 2026-11-08)
  - [x] Review and fix all help text; update the contribution notes.

The user confirmed US-74.1 completion on 2026-11-08. EPIC-74 (US-74.1) is
complete and merged with `--no-ff`.

### [EPIC-74: Compact Markdown spacing in chat](../epics/EPIC-74-COMPACT-MARKDOWN-SPACING.md)

- [x] US-74.1: Tighten Markdown rhythm (confirmed and merged 2026-11-08)
  - [x] Rework the `prose` margin rules (heading top/bottom, `li > p`, list after heading).
  - [x] Add a visual/E2E check with a fixture like the screenshot.

The user confirmed US-67.2 completion on 2026-11-08. EPIC-67 (US-67.1 and
US-67.2) is complete; each story was confirmed and merged with `--no-ff` before
the next began. See ADR-0054 (course packs, course-managed records).

### [EPIC-67: Read-only course projects](../epics/EPIC-67-READ-ONLY-COURSE-PROJECTS.md)

- [x] US-67.1: Lock course-managed records in the backend (confirmed and merged 2026-11-08)
  - [x] Amend ADR-0054 with the lock rule, the list of guarded write paths and the leave/delete behavior.
  - [x] Add a single `require_not_course_managed` check in the courses domain and call it from each guarded service.
  - [x] Tests: every guarded path refuses for course records, allows for the student's own records, and the update path still works.
- [x] US-67.2: Show course projects as read-only (confirmed and merged 2026-11-08)
  - [x] Expose a `course_managed` flag (and class name) on project, sub-agent and file responses; regenerate the client.
  - [x] Disable and explain the locked controls; add the leave-course action.
  - [x] Update help; add unit tests and an E2E: student adds a course, can chat, cannot edit it.

The user confirmed US-70.3 completion on 2026-11-08. EPIC-70 (US-70.1 through
US-70.3) is complete; each story was confirmed and merged with `--no-ff` before
the next began. See ADR-0058 (user groups).

### [EPIC-70: User groups and model/tool access](../epics/EPIC-70-USER-GROUPS-AND-ACCESS.md)

- [x] US-70.1: Groups and membership (confirmed and merged 2026-11-08)
  - [x] Write the ADR (replaces the educator grant in ADR-0053; admin-role mirroring).
  - [x] Implement groups, seeding, membership and the educator flow change; update AGENTS.md §2.1.
  - [x] Tests: defaults, educator approve/revoke, admin mirroring, owner isolation, built-ins protected.
- [x] US-70.2: Group model and tool access, enforced (confirmed and merged 2026-11-08)
  - [x] Extend `ModelAvailability` and tool policy with group access; add the unavailable reason.
  - [x] Tests across every entry point (chat, compare, delegation, sub-agent save, course add, study tools, title model exemption).
- [x] US-70.3: Admin Settings → Groups (confirmed and merged 2026-11-08)
  - [x] Build the page and user-list group control; regenerate the client.
  - [x] Extend settings export/import; help, glossary, unit tests and an E2E restricting a student's models.
