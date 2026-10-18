# EPIC-32: Responsive layout and reachability

Status: confirmed complete on 2026-10-18; US-32.1, US-32.2 and US-32.3 are confirmed complete. Source: [2026-10-17 codebase review](../reviews/2026-10-17-codebase-review.md), F3, F4.

## Objective

Establish explicit scroll ownership and test content reachability, not only document width.

## Ownership and delivery

Implementation stays within the owning domain/component. Preserve existing authorization, shared mutation-cache invalidation and generated API contracts. Use fresh initialization for schema changes; no migrations, compatibility shims or live-database resets. Work on one story at a time, create its feature branch, complete relevant lint/type/format/test gates, synchronize generated clients when contracts change, document behavior and obtain user confirmation before merge.

## US-32.1: Make short-screen authentication reachable

Status: confirmed complete on 2026-10-18; checklist [archived](../archive/todo-completed-2026-10-18.md#us-321--authentication-and-mobile-workspace-reachability).

As a user, I want setup and login controls reachable in a short or keyboard-reduced viewport.

Estimate: 1–2 days. Dependencies: None.

Acceptance criteria:

At 320px and 390px widths, 300px and normal heights, and enlarged text, fields, errors and submit controls remain reachable by touch/scroll and keyboard. Authentication owns scrolling without breaking the workspace shell. No global horizontal clipping hides content. Follow-up acceptance from the mobile report: the sidebar opens with one tap, the header spans the viewport without content covering it, and authenticated pages retain usable scroll owners.

Tasks:

- [x] Give authentication pages a dynamic-height and scroll contract while preserving workspace-specific scroll ownership.
- [x] Add short-screen/landscape and enlarged-text browser cases with submit/validation reachability checks.
- [x] Check focus visibility and keyboard navigation, and update the frontend layout guide.
- [x] Repair reported mobile sidebar, header and page-scroll regressions; verify authenticated mobile routes.

Verification: [2026-10-18 evidence](../reviews/us-32.1-verification-2026-10-18.md).

## US-32.2: Make settings, dialogs and file panes fit their containers

Status: confirmed complete on 2026-10-18; checklist [archived](../archive/todo-completed-2026-10-18.md#us-322--settings-dialogs-and-file-pane-responsiveness).

As a user, I want all actions available in narrow panes even on a wide display.

Estimate: 2–3 days. Dependencies: US-32.1 establishes the layout contract.

Acceptance criteria:

Theme Editor stacks or adapts to pane width; file grids fit below 250px content width. Tall dialogs expose footer/close controls. Settings navigation retains unrelated URL parameters. Existing provider/agent behavior remains intact.

Tasks:

- [x] Audit actual flex/grid minimums, SettingsCard, Theme Editor and file grid; use shrinkable content and container-based adaptation where appropriate.
- [x] Define dialog height/scroll ownership and inspect every production dialog caller with long validation content.
- [x] Preserve unrelated settings URL parameters through the shared search-param helper.
- [x] Add browser tests at 320/390/768/1440px, 640px nested panes and short heights; verify hidden overflow and focused actions, not just scrollWidth.

Verification: [2026-10-18 evidence](../reviews/us-32.2-verification-2026-10-18.md), including 72 isolated browser tests passing without retries.

## US-32.3: Bound rich chat content and composer overlap

Status: confirmed complete on 2026-10-18; checklist [archived](../archive/todo-completed-2026-10-18.md#us-323--rich-chat-content-and-composer-reachability).

As a user, I want long responses and attachments to stay readable without hiding the last message.

Estimate: 2–3 days. Dependencies: US-31.3 policy; can investigate beforehand.

Acceptance criteria:

Wide tables/code/math scroll locally. Long unbroken text and filenames do not expand/clamp away application controls. The final message and actions remain reachable with a multiline composer and expanded file context. Browser checks cover empty, loading, failure and cached-refresh states.

Tasks:

- [x] Define renderer-level wrapping and local scroll policies for tables, code, math, images and long tokens.
- [x] Measure composer height or use flow layout so message clearance follows actual content instead of a fixed 150px reserve.
- [x] Test long tool arguments, citations, attachments and sidebar/panel combinations using synthetic stress content.
- [x] Add reachability assertions, screenshots and keyboard checks at mobile and nested desktop widths.

Verification: [2026-10-18 evidence](../reviews/us-32.3-verification-2026-10-18.md), including 81 isolated browser tests passing without retries. EPIC-32 is confirmed complete. EPIC-33 / US-33.1, repairing bundled palette mappings and contrast, is recommended next.
