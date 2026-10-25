# Completed checklist — 2026-10-25

The user confirmed US-39.1 completion and authorized a local commit/merge on
2026-10-25 after the verification limits were reported. EPIC-39 is complete.

## [EPIC-39: Sidebar General chats and hydration](../epics/EPIC-39-SIDEBAR-GENERAL-CHATS-AND-HYDRATION.md)

- [x] US-39.1: Complete General navigation and stabilize sidebar rendering.
  - [x] Extend General in `NavWorkspaces` with a five-chat paginated list using generated API/TanStack Query hooks, explicit General scope, and existing shadcn sidebar patterns; reconcile `NavChatSessions` to avoid duplication.
  - [x] Handle pagination boundaries, refreshes after chat mutations, and list loading/error/empty states while preserving existing chat actions.
  - [x] Reproduce the hydration error and fix initial sidebar state rendering; inspect the `is_project_visible` browser-cookie initializer as a likely cause and verify persisted open and closed states.
  - [x] Hide empty-state text and nested controls in icon-collapse mode and verify keyboard access and mobile drawer behavior.
  - [x] Add focused pagination/hydration/collapse regressions; run relevant lint, typecheck, formatting, unit tests, and browser checks, then update story status and documentation before requesting completion confirmation.

Verification: five focused sidebar unit tests, typecheck, lint, formatting,
production build, six auth database tests, and the focused isolated browser gate
passed. The cookie-constant follow-up browser gate passed 13 checks with no
retries. The broader combined browser run passed 28 checks and failed the
existing 320px composer assertion; complete frontend Vitest passed 371 tests and
failed four existing UI assertions. Those five failures reproduce on the starting
commit and remain follow-up work, not passes. See the
[verification record](../reviews/us-39.1-sidebar-verification-2026-10-25.md).

## [EPIC-39 / US-39.2: Sidebar context and alignment](../epics/EPIC-39-SIDEBAR-GENERAL-CHATS-AND-HYDRATION.md#us-392-restore-workspace-chat-context-and-align-navigation-rows)

- [x] US-39.2: Restore workspace chat context and align navigation rows.
  - [x] Restore the scoped lower General list and persist its expansion independently of the quick list.
  - [x] Share the General/Projects row layout and apply active highlighting to the entire row.
  - [x] Verify both lists, route scoping, independent preferences, text alignment, highlighting, hydration, and collapsed/mobile behavior; update documentation.

The user confirmed US-39.2 completion and authorized local merge on 2026-10-25.
Final scope includes the longer General list, independent expansion preferences,
shared full-row selection/alignment, unfilled expanded disclosure buttons,
selection icon cleanup, scrolling repair, and project-name headings.

Verification: seven focused sidebar unit tests, typecheck, focused lint, and
formatting passed. Earlier story browser runs passed the new behavior cases,
with the existing 320px composer failure retained in the broader 29-pass/1-fail
result. Button follow-ups passed light/dark browser checks in disposable storage
using alternate test-only ports to preserve the running development servers.
Four existing full-unit failures remain documented. The last project-name
follow-up was verified with focused unit/type/lint checks, not a new browser run.
See the [US-39.2 verification record](../reviews/us-39.2-sidebar-verification-2026-10-25.md).

## [EPIC-40 / US-40.1: Private skills foundation](../epics/EPIC-40-USER-SKILLS-AND-CHAT-SLASH-COMMANDS.md#us-401-persist-and-authorize-private-skills)

- [x] US-40.1: Persist and authorize private skills
  - [x] Add skill storage, fresh initialization/registration, constraints, and bounded frontmatter/Markdown validation; reject unsupported executable/capability declarations rather than interpreting them.
  - [x] Implement owner-scoped paginated/searchable CRUD and expected-revision updates in the skills domain; handle assignment cleanup on deletion without rewriting snapshots.
  - [x] Add owner-consistent main-agent assignments and explicit admin skills-policy contracts; expose eligible skill metadata for the composer and regenerate typed clients.
  - [x] Test ownership, uniqueness, validation, concurrent edits, deletion, policy/assignment eligibility, and fresh-schema initialization; document domain boundaries.

The user confirmed US-40.1 completion and authorized local commit/merge on
2026-10-25 after verification limits were reported. Delivered private skill
storage/validation/CRUD, owner-consistent main-agent assignments, fail-closed
admin policy, eligible discovery, synchronized clients, and architecture/docs.

Verification: 683 backend tests passed, backend/frontend typechecks and lint
passed, fresh schema/foreign-key integrity and six auth database checks passed.
Four pre-existing frontend unit failures and six unchanged backend formatting
failures remain documented. No browser suite or production build was run for
this API-only foundation. See the
[verification record](../reviews/us-40.1-skills-verification-2026-10-25.md).
US-40.2 through US-40.4 remain planned; EPIC-40 is not complete.

## [EPIC-40 / US-40.2: Skills management UI](../epics/EPIC-40-USER-SKILLS-AND-CHAT-SLASH-COMMANDS.md#us-402-manage-skills-in-user-settings)

- [x] US-40.2: Manage skills in user settings
  - [x] Add the Skills settings route/navigation and generated-query list/detail flows with loading, failure/retry, empty, and cached-refresh states.
  - [x] Build create/edit/view/preview and confirmed-delete flows using existing shadcn components; preserve drafts and handle revision conflicts.
  - [x] Add owned-skill assignment controls to main-agent settings and explain unavailable/admin-disabled activation without granting policy through the UI.
  - [x] Verify CRUD, preview safety, search/pagination, assignments, keyboard access, and narrow/short layouts; update user-facing documentation.

The user confirmed completion and authorized local commit/merge on 2026-10-25.
Delivered private Skills CRUD, safe Markdown preview, and independent main-agent
assignments with owner-scoped caches and conflict-safe drafts.

Verification: 21 focused component tests and 22 isolated browser checks passed;
typecheck, lint, formatting, six auth database checks and production build passed.
The four existing frontend unit failures remain documented in the
[verification record](../reviews/us-40.2-skills-ui-verification-2026-10-25.md).
US-40.3 and US-40.4 remain planned; EPIC-40 is not complete.
