# Completed checklist — 2026-10-29

The user confirmed US-44.3 completion and authorized a local merge on
2026-10-29. EPIC-44 (US-44.1 through US-44.3) is complete; each story was
confirmed and merged with `--no-ff` before the next began.

### [EPIC-44: Agent constellation](../epics/EPIC-44-AGENT-CONSTELLATION.md)

- [x] US-44.1: Delegation graph
  - [x] Design the layout (deterministic placement of up to N nodes, plus an overflow strategy); build the SVG component.
  - [x] Map the existing activity states to node states; test state transitions and many-agent/narrow layouts.

- [x] US-44.2: Compact summary
  - [x] Build the summary and expand interaction; test reload and history rendering.

- [x] US-44.3: Accessibility and reduced motion
  - [x] Add the text equivalent, a polite live region and keyboard handling; add axe and keyboard tests.

The user confirmed EPIC-45 completion and authorized a local merge on
2026-10-29. EPIC-45 (US-45.1 through US-45.4) is complete; the stacked story
branches were merged into `main` in order with `--no-ff`.

### [EPIC-45: Welcome, empty and loading states](../epics/EPIC-45-WELCOME-EMPTY-AND-LOADING-STATES.md)

- [x] US-45.1: New-chat hero
  - [x] Rebuild the hero in `app/(main)/page.tsx`; add the suggestion sources; test with a project, without one, and with no skills.

- [x] US-45.2: Skeletons for loading
  - [x] Add skeleton variants; replace the "Loading …" paragraphs; test that status announcements remain.

- [x] US-45.3: Empty states with a clear next step
  - [x] Audit the 61 `Empty` usages; standardize copy and actions; update the tests that assert on copy.

- [x] US-45.4: Sign-in and first-run screens
  - [x] Restyle `AuthForm` and the auth layout; keep the existing auth tests passing; update screenshots.
