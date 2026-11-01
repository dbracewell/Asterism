# EPIC-61: In-app help and guided onboarding

Status: in progress (US-61.5 awaiting confirmation; see [ADR-0032](../adr/0032-in-app-help-content.md)). Source: product discussion (2026-11-01), learner track.

## Objective

Explain Asterism's concepts where learners meet them. The chat composer alone
offers personas, skills, learning modes, hint levels, the mode lock, templates,
model selection, attachments and comparison. Few new users will know these
terms. Every main page should explain what it is for and what each control does,
in plain language, without sending the learner to external documentation.

## Ownership and delivery

- Help content is **frontend-owned, static and typed**. A single registry maps
  stable help IDs (for example `composer.persona` or `concept.skill`) to a short
  summary, a longer explanation and optional related IDs. Components refer to
  help by typed ID, so a missing or misspelled entry fails type checking.
- No backend content store and no LLM-generated help. The text describes product
  behavior, so it must stay accurate and reviewable in code review.
- Help text describes only implemented behavior. For example, it must not claim
  a persona memory engine exists, and it must not suggest that persona, skill or
  mode text grants tools, file access or delegation.
- Admin-only concepts (tool policy, MCP servers, providers, skills policy) are
  shown only to admins.
- Help is reachable by keyboard, works on touch devices (no hover-only content)
  and meets the existing accessibility and theme-contrast baselines.
- Interactive UI uses existing shadcn/ui components (Popover, Sheet, Dialog,
  Tooltip). If a new component is needed, ask for approval before installing it.
- Tour completion and "don't show again" state is stored per user on the server
  so it follows the learner between devices.
- After this epic, new user-facing concepts ship with their help entries. Add
  this to the frontend contribution notes.

## US-61.1: Help content foundation

As a learner, I want a consistent way to ask "what is this?" anywhere in the app.

Estimate: 1.5 days. Dependencies: none.

Acceptance: a typed help registry and glossary exist covering at least: chat,
General vs. project chats, persona, main agent, sub-agent, skill, learning mode
(Standard, Tutor, Explain-back, Review my work), hint levels and answer reveal,
mode lock, template, model, attachment and file scope, comparison, tool approval
and citations. A reusable help trigger opens a popover with the summary, a
"Learn more" link and related terms. It works with keyboard, touch and screen
readers. The existing tooltip-only `HelpIcon` uses are migrated where the text
is longer than a short label.

- [x] Write an ADR for help content ownership, the registry shape and the accuracy rules.
- [x] Implement the typed registry, glossary entries and the help popover component.
- [x] Migrate existing `HelpIcon` uses where appropriate; document the convention for new features.
- [x] Test registry completeness, admin-only filtering, keyboard and touch access, and contrast.

## US-61.2: Composer help

As a learner, I want to understand each chat input control before I use it.

Estimate: 1.5 days. Dependencies: US-61.1.

Acceptance: the persona picker, skill slash menu and chips, learning-mode picker,
hint controls and reveal action, mode lock, template and prompt-coach entry,
model picker, attach menu and comparison targets each have a help trigger. The
learning-mode picker shows a one-line description of each mode next to its name
and explains what changes when the learner picks it. Help does not crowd the
composer at 320px width or at short heights.

Delivered as: one "Chat controls" help button in the composer toolbar that
walks through every toolbar control and links to each concept (separate buttons
beside each picker would crowd the 320px toolbar), plus inline help where there
is room: skill chips, hint controls (hint levels, or the reveal step in Review
my work), Files in context, Prompt templates and Prompt review. The mode picker
lists each mode's one-line description, exposed as the option's accessible
description. The mode-lock dialog already explains the lock; the header control
gets page-level help in US-61.3.

- [x] Add help triggers and mode descriptions to the composer controls.
- [x] Verify layout at narrow and short viewports; update composer tests.

## US-61.3: Page help panel

As a learner, I want a short guide to the page I'm on.

Estimate: 2 days. Dependencies: US-61.1.

Acceptance: a "Help" button in the page header opens a side sheet titled for the
current page. It explains the page's purpose, its main areas and common tasks,
with links to glossary entries. Covered pages: new chat, chat, General, Projects,
project workspace and project settings, Files, Search, User Settings (each tab)
and Admin Settings (each section, admins only). The `?` key opens the panel when
focus is not in a text field. Empty states on these pages explain the concept and
link to the relevant help.

- [x] Implement the page help sheet, route mapping and the keyboard shortcut.
- [x] Write the page guides and update the empty states.
- [x] Test route coverage, the shortcut's focus rules and admin-only sections.

## US-61.4: Guided first-chat tour

As a new learner, I want a short walkthrough the first time I open a chat.

Estimate: 2 days. Dependencies: US-61.2.

Acceptance: on the first visit to the new-chat page the learner is offered an
optional tour of five to seven steps that highlights the composer, persona,
skills, learning modes, model and attachments. The learner can skip, go back,
or finish the tour. Completion and dismissal are stored per user; the tour can
be restarted from the help panel and from User Settings. Steps whose control is
not present (for example, skills disabled by policy) are skipped. The tour traps
focus correctly and announces each step to screen readers.

Delivered as: a "New here?" card on the new-chat page (shown while the
`first_chat_tour` user setting is unset) that starts a modal popover tour of up
to six steps: message box, persona, skills (only while the skills policy is on),
learning mode, model and attachments. Finish stores `completed`; Skip, Escape or
"No thanks" store `dismissed` (a skipped replay keeps an earlier completion).
The help sheet ("Take the chat tour") and User Settings → General ("Restart the
chat tour") replay it through `/?tour=first-chat`.

- [x] Add per-user onboarding state to the user preferences API; regenerate the client.
- [x] Build the tour on existing shadcn/ui primitives, with skip, back and restart.
- [x] Test first-visit behavior, persistence, restart, skipped steps and accessibility.

## US-61.5: Help center page

As a learner, I want one place to browse and search every explanation.

Estimate: 1 day. Dependencies: US-61.1, US-61.3.

Acceptance: a `/help` page lists the glossary and the page guides with client-side
search. Every "Learn more" link lands on the matching entry. The page is linked
from the sidebar or user menu and respects admin-only filtering.

Delivered as: a `/help` page, linked from the user menu and the page help
sheet, with a Glossary, Controls and settings, and Page guides, each entry at a
stable anchor and searchable client-side. "Learn more" still expands details in
place (popover and sheet); a separate "Open in help center" link beside it goes
to the entry's anchor, and the router focuses it on arrival. Admin-only entries
and guides are omitted for other users. The Playwright check opens every help
popover, as a learner and as an admin, follows its help center link and checks
that the anchor exists, carries the entry's title and is in view; it also
checks every in-page related and term link.

- [x] Build the help center page with search and anchor links.
- [x] Add a Playwright check that every "Learn more" link resolves to an entry.
