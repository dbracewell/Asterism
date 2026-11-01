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
the popover content, and a Back button returns. US-61.5 adds an "Open in help
center" link once that page exists; until then, help never links to a route
that does not exist.

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

**Convention.** A story that adds a user-facing concept or control adds its
help entry in the same change. The frontend README records this.

## Consequences

- Help text is versioned with the code and cannot drift into a separate store.
- Translating or editing help requires a deployment; acceptable for now.
- A closed union means each new entry touches the union and the record; the
  compiler then keeps both in step.
- The help popover uses the existing popover tokens, so theme contrast is
  covered by the existing theme-contrast checks.
