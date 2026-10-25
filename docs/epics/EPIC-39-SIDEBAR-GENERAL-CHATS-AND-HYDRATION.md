# EPIC-39: Sidebar General chats and hydration

Status: complete; user-confirmed on 2026-10-25 and approved for local merge.
Builds on the user's sidebar changes. See the
[verification record](../reviews/us-39.1-sidebar-verification-2026-10-25.md) and
[completed checklist](../archive/todo-completed-2026-10-25.md).

## Objective

Give General an expandable chat list with five chats per page, matching the
new Projects navigation, and fix sidebar hydration and collapsed empty states.

## US-39.1: Complete General navigation and stabilize sidebar rendering

As a user, I want to browse General chats in the sidebar the same way I browse
projects, with reliable rendering when loading or collapsing the sidebar.

Estimate: 1–2 days. Dependencies: preserve and extend the current sidebar edits.

Acceptance criteria:

- General retains its navigation link and gains an accessible expand/collapse
  control and nested list of General chats, showing at most five per page.
- Previous/next controls follow the Projects pattern, have accessible names,
  and disable at page boundaries and during fetches. Project chats never appear
  in the General list; switching workspaces does not change its scope.
- Loading, empty, failure/retry, and cached-refresh failure states remain clear.
  Creating or deleting chats refreshes the list; deleting the last item on a
  later page returns to a valid page. Existing chat actions remain available
  without duplicating the General list elsewhere in the sidebar.
- A hard reload produces no sidebar hydration errors, including with persisted
  open/closed preferences. Server markup and the first client render agree;
  hydration warnings are fixed at their source rather than suppressed.
- Collapsing the sidebar hides “No chats yet.” and nested list controls without
  leaving hidden interactive elements keyboard-focusable. Expanding restores
  the appropriate state; mobile drawer navigation remains usable.

Tasks:

- [x] Extend General in `NavWorkspaces` with a five-chat paginated list using
      generated API/TanStack Query hooks, explicit General scope, and existing
      shadcn sidebar patterns; reconcile `NavChatSessions` to avoid duplication.
- [x] Handle pagination boundaries, refreshes after chat mutations, and list
      loading/error/empty states while preserving existing chat actions.
- [x] Reproduce the hydration error and fix initial sidebar state rendering;
      inspect the `is_project_visible` browser-cookie initializer as a likely
      cause and verify persisted open and closed states.
- [x] Hide empty-state text and nested controls in icon-collapse mode and
      verify keyboard access and mobile drawer behavior.
- [x] Add focused pagination/hydration/collapse regressions; run relevant lint,
      typecheck, formatting, unit tests, and browser checks, then update story
      status and documentation before requesting completion confirmation.

Focused sidebar tests, typecheck, lint, formatting, build, and the isolated
sidebar browser gate pass. The full frontend suite still has four failures
reproduced at the starting commit; the 320px composer browser failure also
reproduces there. These baseline failures remain explicitly documented follow-up
work; the user confirmed this story after the limits were reported.

Scope: frontend sidebar only; reuse existing paginated chat APIs. No schema
changes, data resets, or broader sidebar redesign are planned. Implement this
story on a feature branch and obtain user confirmation before merging.
