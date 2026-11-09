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

The user confirmed US-68.2 completion on 2026-11-08. EPIC-68 (US-68.1 and
US-68.2) is complete; each story was confirmed and merged with `--no-ff` before
the next began. See ADR-0059 (sub-agents in General chats).

### [EPIC-68: Sub-agents in General chat](../epics/EPIC-68-SUB-AGENTS-IN-GENERAL-CHAT.md)

- [x] US-68.1: General delegation scope in the backend (confirmed and merged 2026-11-08)
  - [x] Write the ADR (amends the "General chats never delegate" rule) and update AGENTS.md and architecture docs.
  - [x] Add the General set to the main-agent configuration and resolve it in `resolve_delegation_scope`.
  - [x] Tests: no set → no `sub_agent` tool; set → delegation works; removing a target mid-turn is refused; child file scope is limited to the chat's attachments; owner isolation.
- [x] US-68.2: Choose General chat sub-agents (confirmed and merged 2026-11-08)
  - [x] Build the picker with generated client hooks; show availability.
  - [x] Update help and glossary; unit tests and an E2E delegating from a General chat with a fake provider.

The user confirmed US-69.2 completion on 2026-11-08. EPIC-69 (US-69.1 and
US-69.2) is complete; each story was confirmed and merged with `--no-ff` before
the next began. See ADR-0060 (automatic context compaction).

### [EPIC-69: Automatic context compaction](docs/epics/EPIC-69-AUTO-COMPACTION.md)

- [x] US-69.1: Compaction records and prompt assembly (confirmed and merged 2026-11-08)
  - [x] Write the ADR (record shape, branch/fork rules, trust rules, thresholds). ([ADR-0060](docs/adr/0060-context-compaction.md))
  - [x] Implement the record, the summarizer prompt and assembly changes.
  - [x] Tests: threshold trigger, branch isolation, fork before/after the point, replay, unknown context window, failure path.
- [x] US-69.2: Compaction in the chat UI and settings (confirmed and merged 2026-11-08)
  - [x] Stream compaction events; add the divider, meter action and admin settings; regenerate the client.
  - [x] Help and glossary; unit tests and an E2E with a small fake context window.

The user confirmed US-73.2 completion on 2026-11-08. EPIC-73 (US-73.1 and
US-73.2) is complete; each story was confirmed and merged with `--no-ff` before
the next began. See the [approved layout](../plans/us-73.1-composer-layout.md).

### [EPIC-73: Composer cleanup](../epics/EPIC-73-COMPOSER-CLEANUP.md)

- [x] US-73.1: Layout proposal (confirmed and merged 2026-11-08)
  - [x] Inventory every composer control and when it shows; produce the mockup; get approval.
- [x] US-73.2: Rebuild the composer (confirmed and merged 2026-11-08)
  - [x] Implement the layout; update help.
  - [x] Update unit tests and the composer-related E2E specs.
