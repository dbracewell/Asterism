# Todo

Completed Projects/Chat Context and provider-settings work remains in the existing archives. This checklist tracks the findings from the [2026-10-17 review](docs/reviews/2026-10-17-codebase-review.md). See the [sequenced roadmap](docs/plans/post-refactor-quality-roadmap.md).

Archives: [2026-10-14](docs/archive/todo-completed-2026-10-14.md), [2026-10-15](docs/archive/todo-completed-2026-10-15.md), [2026-10-16](docs/archive/todo-completed-2026-10-16.md), [2026-10-17](docs/archive/todo-completed-2026-10-17.md), [2026-10-18](docs/archive/todo-completed-2026-10-18.md), [2026-10-19](docs/archive/todo-completed-2026-10-19.md), [2026-10-23](docs/archive/todo-completed-2026-10-23.md), [2026-10-24](docs/archive/todo-completed-2026-10-24.md), and [US-28.3 verification](docs/archive/us-28.3-verification-2026-10-17.md).

EPIC-31 and EPIC-32 are confirmed complete and archived above. US-38.1 through US-38.6 are confirmed complete and archived above. EPIC-33 (US-33.1 through US-33.3) is confirmed complete and archived above. EPIC-36 (US-36.1) and EPIC-37 (US-37.1) are complete; their already-merged implementation and completed checklists are reconciled and archived above. See the [2026-10-24 reassessment](docs/reviews/2026-10-24-open-epics-reassessment.md). EPIC-34 (US-34.1 through US-34.4) is confirmed complete and archived above, including finite chat admission and the current browser baseline; the old agent-selector repairs are already present. EPIC-35 (US-35.1 and US-35.2) is confirmed complete and archived above. Execute one story at a time; obtain completion confirmation before merge.

US-39.1 is confirmed complete and archived in the
[2026-10-25 checklist](docs/archive/todo-completed-2026-10-25.md).
US-39.2 completion is recorded below. The existing model/persona test assertions
and 320px composer viewport failure remain recommended follow-up work; see the
[US-39.1 verification record](docs/reviews/us-39.1-sidebar-verification-2026-10-25.md).

EPIC-39 (US-39.1 and US-39.2) is confirmed complete and archived in the
[2026-10-25 checklist](docs/archive/todo-completed-2026-10-25.md).
US-40.1 is confirmed complete and archived in the [2026-10-25 checklist](docs/archive/todo-completed-2026-10-25.md); US-40.2 through US-40.4 remain planned. Existing model/persona unit-test assertions
and the 320px composer viewport failure remain recommended follow-up work; see
[US-39.2 verification](docs/reviews/us-39.2-sidebar-verification-2026-10-25.md).

## [EPIC-40: User skills and chat slash commands](docs/epics/EPIC-40-USER-SKILLS-AND-CHAT-SLASH-COMMANDS.md)

- [ ] US-40.2: Manage skills in user settings
  - [ ] Add the Skills settings route/navigation and generated-query list/detail flows with loading, failure/retry, empty, and cached-refresh states.
  - [ ] Build create/edit/view/preview and confirmed-delete flows using existing shadcn components; preserve drafts and handle revision conflicts.
  - [ ] Add owned-skill assignment controls to main-agent settings and explain unavailable/admin-disabled activation without granting policy through the UI.
  - [ ] Verify CRUD, preview safety, search/pagination, assignments, keyboard access, and narrow/short layouts; update user-facing documentation.

- [ ] US-40.3: Activate skills through recorded chat execution
  - [ ] Add branch-local ordered active-skill state and extend send/admission contracts, expected state revisions, and request fingerprints; atomically accept activation/removal/reorder/refresh changes and reject forged, stale, unassigned, or revoked selections.
  - [ ] Resolve and pin owner-scoped skill snapshots at activation, reuse eligible active snapshots on follow-up turns, and inject a bounded named prompt layer; enforce per-skill, count, and aggregate context limits with explicit errors.
  - [ ] Persist effective skill provenance on every turn; implement explicit refresh, branch restore/fork isolation, retry/resume/regeneration, and deletion/revocation handling without rewriting history or inheriting parent activation in sub-agents.
  - [ ] Test activation across follow-ups, last-skill removal, pinned revisions/refresh, stale tabs, branch isolation, idempotency, cross-user attempts, revocation, and unchanged tool/file/delegation boundaries; regenerate clients and document the contract.

- [ ] US-40.4: Discover and invoke skills from the chat input
  - [ ] Add accessible, keyboard/touch-operable slash discovery using generated eligible-skill queries and existing shadcn patterns; cover loading, no matches, unavailable policy, and retry.
  - [ ] Implement command-boundary parsing, exact-name resolution, persistent ordered active-skill chips with remove/refresh controls, pending/update/unavailable states, and explicit handling of unknown commands/literal slash text.
  - [ ] Restore branch-local active state and pending composer edits across reloads; integrate new/existing sends, follow-ups, removals, refreshes, and retry/draft state; show per-message snapshots and retain prompt/attachments on rejection.
  - [ ] Verify keyboard/IME, mobile/short layouts, command parsing, follow-up persistence, removal/refresh, reloads/branch switches, skill-only sends, stale/deleted skills, and General/project execution end to end; run relevant gates and update README/architecture/epic/checklist records.

US-40.1 verification and known baseline failures are recorded in the
[verification report](docs/reviews/us-40.1-skills-verification-2026-10-25.md).
No story is currently active. Next recommended: US-40.2, the Skills management UI.
