# ADR-0032 — In-app help content

Status: accepted for US-61.1 on 2026-11-01.

## Context

Asterism is aimed at learners, and its chat input alone offers personas,
skills, learning modes, hint levels, the mode lock, templates, models,
attachments and comparison. Before this decision the only in-app help was
`HelpIcon`, a hover tooltip on an unfocusable icon, used in three places.
Hover help does not work on touch devices or from the keyboard, and it has no
room for an explanation. EPIC-61 adds contextual help, page guides, a tour and
a help center; they all need one source of help text.

## Decision

**Ownership.** Help text is static frontend code in `src/features/help`. There
is no backend content store, admin editing or model-generated help. The text
describes product behavior, so it changes in the same commit as the behavior,
and code review checks it.

**Registry.** `HelpId` is a closed string union. `helpEntries` is a
`Record<HelpId, HelpEntry>`, so TypeScript rejects a missing entry, an unknown
ID in a component, or a related link to an unknown ID. An entry has:

- `title`: the term as the UI shows it.
- `summary`: one or two plain sentences, shown first.
- `details`: short paragraphs shown after "Learn more".
- `related`: other `HelpId`s, shown as links within the popover.
- `audience`: `"everyone"` or `"admin"`.

IDs are namespaced: `concept.*` for glossary terms, and a surface prefix (for
example `settings.*` or `admin.*`) for help about one control. Page guides
(US-61.3) and tour steps (US-61.4) reference these IDs rather than repeating
the text.

**Page guide coverage (US-66.1).** Every route under `app/(main)` and every
settings section has a guide written for it; no page borrows another page's
guide. Unknown settings sections follow the settings page and show their
tab's default section and guide. Planned admin sections have no guide, so no
Help button, until they ship. `pages.test.ts` reads the route folders and the
real settings section lists, so a new page or section without a guide fails
the test. The `(auth)` pages (sign-in, setup, invite) have no app header and
so no Help button; their forms explain themselves.

**Inline help on newer surfaces (US-66.2).** The glossary covers study
tools (flashcards and decks, quizzes and attempts, weak spots, study notes),
classes (class, educator, course, class code, invite links, learning mode
policy, class insights), team packs and the admin-only settings file. Section
headings take their trigger through `HelpHeading`, and page titles through
`PageHeader`'s `help` slot; both keep the button outside the heading so its
accessible name stays the section's name. Entries state the limits learners
rely on, and `registry.test.ts` checks them: insights are totals shown only
once five students share, sharing is off until a student turns it on, the
class policy can only limit, and packs carry no files or keys and grant no
tools.

**Accuracy rules.** Help describes only implemented behavior. In particular:

- Persona, skill, learning-mode and template text never grants tools, files,
  MCP access or delegation. Help must not suggest otherwise.
- There is no long-term memory engine. Help must not say a persona or chat
  "remembers" anything beyond the current conversation.
- Features with a "Planned" badge or no UI (for example MCP servers) get no
  help entry until they ship.
- Learning-mode prompts are best effort. Help says the model is asked to
  behave a certain way; it does not promise it always will.

**Audience.** Admin-only entries render nothing for other users, and are
dropped from related links. The dashboard layout sets the viewer's audience
from the server-loaded user role through `HelpAudienceProvider`. The default
is the non-admin audience, so a missing provider hides admin help. This is a
presentation choice only; admin pages and APIs keep their own authorization.

**Presentation.** `HelpTopic` is a focusable icon button labelled
"Help: <title>". It opens a shadcn `Popover`, which works with click, tap and
keyboard, and Escape closes it and returns focus. The popover shows the title
and summary. "Learn more" expands the details in place. Related links replace
the popover content, and a Back button returns. "Open in help center" links to
the current entry's anchor on `/help`.

`HelpIcon` remains for short, dynamic descriptions supplied by the server (tool
and component descriptions). It becomes a focusable button that opens the same
`Popover` instead of a hover-only tooltip.

**First-chat tour (US-61.4).** The tour is a modal shadcn `Popover` anchored
to each composer control (found by `data-tour`), with a ring drawn around the
control; no tour library. Its step text follows the same accuracy rules. The
per-user `first_chat_tour` setting (`completed` or `dismissed`; unset means
"offer it") is stored through the existing user settings API so it follows the
learner between devices. Replays use the `?tour=first-chat` link and do not
overwrite an earlier completion when skipped.

**Help center (US-61.5).** `/help` renders every entry and page guide visible
to the viewer, filtered client-side (every query word must appear in the
title, summary, details, or a guide's areas, tips and terms). Anchors come
from one module (`center.ts`): an entry's anchor is its `HelpId`; a page
guide's is `page-<guide id>`, because guide IDs such as `admin.tools` overlap
help IDs. Anchors are focusable, so the router's hash navigation focuses the
entry it lands on. "Learn more" in the popover and page sheet stays an in-place
expansion; the separate "Open in help center" link goes to the entry, and a
Playwright check follows every such link. Admin-only entries and guides are
left out of the page for other users, as in the popover.

**Convention.** A story that adds a user-facing concept or control adds its
help entry in the same change, and a story that adds a page or settings
section adds its guide. A story that changes behavior or moves a control
updates the help that describes it. US-66.3 reviewed every entry and guide
against the app after the EPIC-65 workspace redesign. The frontend README
records the convention.

## Consequences

- Help text is versioned with the code and cannot drift into a separate store.
- Translating or editing help requires a deployment; acceptable for now.
- A closed union means each new entry touches the union and the record; the
  compiler then keeps both in step.
- The help popover uses the existing popover tokens, so theme contrast is
  covered by the existing theme-contrast checks.
