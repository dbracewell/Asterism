# EPIC-65: Project workspace redesign

Status: in progress (US-65.1 and US-65.2 complete). Source: user request (2026-11-07).

## Objective

A project page is one long scroll of ten sections, with settings on a separate
page, and every project shows every feature. Reorganize a project into tabs,
let each project choose which feature areas it uses, and add a setup wizard so a
new project starts with only what its owner needs. Example uses: a study
project for a course; a document collection for asking questions with
retrieval; an agent workspace where selected sub-agents do tasks (and, later,
create files or images).

## Ownership and delivery

- **Tabs.** Overview (description, goal, recent chats), Chats, Files, Study
  (flashcards, quizzes, notes, weak spots, topic mastery), Reflections,
  Sub-agents and Settings. The active tab is in the URL, so links and the back
  button work. Existing study sub-pages stay where they are and link back to the
  Study tab.
- **Feature areas.** A project stores which optional areas are on: Study,
  Reflections, Goal and Sub-agents. Overview, Chats, Files and Settings are
  always present. A hidden area keeps its data and can be turned back on.
- **Display only.** Turning an area off never grants, removes or narrows any
  capability. Sub-agent selections, file scope and retrieval keep their existing
  server-side rules. In particular, hiding Sub-agents does not deselect them;
  the Sub-agents area shows how many are selected so nothing is hidden by surprise.
- **Wizard.** Creating a project opens a short wizard: pick a starting point
  (Study a course, Ask my documents, Agent workspace, Blank), name and describe
  it, optionally add files and instructions, then review. A starting point only
  pre-fills fields and feature areas; everything stays editable. Course projects
  from a class (EPIC-60) skip the wizard and turn on Study.
- Uses existing shadcn/ui components (Tabs, Dialog, Field). Ask before
  installing any new component.
- Every new tab, area and wizard step ships with help entries and page guides
  (EPIC-61 rule).
- No migrations: fresh initialization and the development reset.

## US-65.1: Tabbed project workspace

As a project owner, I want my project organized into tabs instead of one long page.

Estimate: 1.5 days. Dependencies: none.

Acceptance: the project page shows the tabs above with the active tab in the URL
(`/projects/{id}?tab=files`); the old `/projects/{id}/settings` route becomes the
Settings tab. Every existing section is reachable in its tab with no loss of
function. Keyboard and screen-reader navigation follow the Tabs pattern, and it
works at 320px. Page help describes each tab.

- [x] Restructure the workspace into tabs with URL state; move settings into a tab.
- [x] Update unit and E2E tests and page guides; check narrow widths and keyboard use.

## US-65.2: Per-project feature areas

As a project owner, I want to turn off the parts of a project I don't use.

Estimate: 1 day. Dependencies: US-65.1.

Acceptance: projects store their enabled areas (Study, Reflections, Goal,
Sub-agents), default all on for existing behavior, and Settings has a switch for
each. Turning one off hides its tab and its Overview content and keeps its data.
Tests prove that hiding an area changes no capability: selections, file scope,
retrieval and delegation behave the same. Team-pack export and course packs
carry the areas.

- [x] Add the field, API and Settings switches; hide tabs and Overview parts.
- [x] Test data retention and capability neutrality; carry areas through packs and courses.

## US-65.3: New-project wizard

As a user, I want a guided way to set up a project for what I'm trying to do.

Estimate: 1.5 days. Dependencies: US-65.2.

Acceptance: "New project" opens a wizard with the four starting points, then
name and description, optional files and instructions, an optional goal, and a
review step listing exactly what will be created and which areas are on. Each
starting point explains what it sets up in plain language. Cancel creates
nothing; Back keeps entries. Finish creates the project in one request and
opens its Overview. Agent workspace explains that sub-agents are chosen in the
Sub-agents tab and need a model that supports tools.

- [ ] Build the wizard steps and starting points; create the project atomically.
- [ ] Add help for each step; unit-test steps and a real-backend E2E for one path.
