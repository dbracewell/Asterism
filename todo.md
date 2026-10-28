# Todo

Completed Projects/Chat Context and provider-settings work remains in the existing archives. This checklist tracks the findings from the [2026-10-17 review](docs/reviews/2026-10-17-codebase-review.md). See the [sequenced roadmap](docs/plans/post-refactor-quality-roadmap.md).

Archives: [2026-10-14](docs/archive/todo-completed-2026-10-14.md), [2026-10-15](docs/archive/todo-completed-2026-10-15.md), [2026-10-16](docs/archive/todo-completed-2026-10-16.md), [2026-10-17](docs/archive/todo-completed-2026-10-17.md), [2026-10-18](docs/archive/todo-completed-2026-10-18.md), [2026-10-19](docs/archive/todo-completed-2026-10-19.md), [2026-10-23](docs/archive/todo-completed-2026-10-23.md), [2026-10-24](docs/archive/todo-completed-2026-10-24.md), [2026-10-25](docs/archive/todo-completed-2026-10-25.md), [2026-10-27](docs/archive/todo-completed-2026-10-27.md), [2026-10-28](docs/archive/todo-completed-2026-10-28.md), and [US-28.3 verification](docs/archive/us-28.3-verification-2026-10-17.md).

EPIC-31 and EPIC-32 are confirmed complete and archived above. US-38.1 through US-38.6 are confirmed complete and archived above. EPIC-33 (US-33.1 through US-33.3) is confirmed complete and archived above. EPIC-36 (US-36.1) and EPIC-37 (US-37.1) are complete; their already-merged implementation and completed checklists are reconciled and archived above. See the [2026-10-24 reassessment](docs/reviews/2026-10-24-open-epics-reassessment.md). EPIC-34 (US-34.1 through US-34.4) is confirmed complete and archived above, including finite chat admission and the current browser baseline; the old agent-selector repairs are already present. EPIC-35 (US-35.1 and US-35.2) is confirmed complete and archived above. Execute one story at a time; obtain completion confirmation before merge.

EPIC-39 and EPIC-40 are confirmed complete and archived in the
[2026-10-25 checklist](docs/archive/todo-completed-2026-10-25.md).
The 320px short-height composer clipping is fixed in US-40.4.

No user story is currently active. Recommended next work: reconcile the four
remaining frontend unit assertions and the model-context browser assertion.
See the [US-40.4 verification record and admin-policy addendum](docs/reviews/us-40.4-slash-skills-verification-2026-10-25.md)
for current evidence and verification limits.

## Visual design epics (proposed)

Source: approved visual design audit (2026-10-26). Suggested order: EPIC-41 → 43 → 44 → 45 → 42 → 46. EPIC-41 is confirmed complete and archived in the
[2026-10-27 checklist](docs/archive/todo-completed-2026-10-27.md); EPIC-43 is confirmed complete and archived in the
[2026-10-28 checklist](docs/archive/todo-completed-2026-10-28.md). EPIC-44 is in progress (US-44.1 active).

### [EPIC-44: Agent constellation](docs/epics/EPIC-44-AGENT-CONSTELLATION.md)

- [x] US-44.1: Delegation graph
  - [x] Design the layout (deterministic placement of up to N nodes, plus an overflow strategy); build the SVG component.
  - [x] Map the existing activity states to node states; test state transitions and many-agent/narrow layouts.

- [ ] US-44.2: Compact summary
  - [ ] Build the summary and expand interaction; test reload and history rendering.

- [ ] US-44.3: Accessibility and reduced motion
  - [ ] Add the text equivalent, a polite live region and keyboard handling; add axe and keyboard tests.

### [EPIC-45: Welcome, empty and loading states](docs/epics/EPIC-45-WELCOME-EMPTY-AND-LOADING-STATES.md)

- [ ] US-45.1: New-chat hero
  - [ ] Rebuild the hero in `app/(main)/page.tsx`; add the suggestion sources; test with a project, without one, and with no skills.

- [ ] US-45.2: Skeletons for loading
  - [ ] Add skeleton variants; replace the "Loading …" paragraphs; test that status announcements remain.

- [ ] US-45.3: Empty states with a clear next step
  - [ ] Audit the 61 `Empty` usages; standardize copy and actions; update the tests that assert on copy.

- [ ] US-45.4: Sign-in and first-run screens
  - [ ] Restyle `AuthForm` and the auth layout; keep the existing auth tests passing; update screenshots.

### [EPIC-42: App shell and navigation chrome](docs/epics/EPIC-42-APP-SHELL-AND-NAVIGATION-CHROME.md)

- [ ] US-42.1: Contextual header
  - [ ] Replace `NavHeader` and `MobileSidebarTrigger` with one route-aware header component.
  - [ ] Add breadcrumb, chip and action slots fed by route params and existing queries; reuse `ChatSessionActionMenu`.
  - [ ] Test the breadcrumbs per route, the mobile layout and keyboard order; update screenshots.

- [ ] US-42.2: Sidebar hierarchy
  - [ ] Restyle the sidebar groups and rows; add an optional project accent (backend field, regenerated client).
  - [ ] Test the active state and collapsed icon mode; update screenshots.

- [ ] US-42.3: Shared page header and list layout
  - [ ] Build `PageHeader` and the list layout; migrate the four pages.
  - [ ] Update tests and screenshots.

### [EPIC-46: Settings and admin visual coherence](docs/epics/EPIC-46-SETTINGS-AND-ADMIN-VISUAL-COHERENCE.md)

- [ ] US-46.1: Settings hierarchy
  - [ ] Add a settings section primitive; migrate the user and admin panes; test the sticky save bar's dirty state.

- [ ] US-46.2: Theme gallery
  - [ ] Build the preview tile from the theme variables; replace the selector; test selection, keyboard use and admin-only editing.

- [ ] US-46.3: Provider and model identity
  - [ ] Add a provider icon map (monochrome, theme-aware) and capability badges; test the labels for accessibility.
