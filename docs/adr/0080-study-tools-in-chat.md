# ADR-0080 — Decks and quizzes from chat

Status: accepted. The switches are implemented for US-98.1 (2026-11-24); the
draft storage, the tools and the review card follow in US-98.2 to US-98.4
([EPIC-98](../epics/EPIC-98-STUDY-TOOLS-IN-CHAT.md)). Amends the project areas
of US-65.2, which were display preferences only.

## Context

A project's Study area holds flashcard decks and practice quizzes (ADR-0033 to
ADR-0035). Today they are made only with buttons: a form runs a bounded
generation over the project's files. People asked for them from chat, where the
conversation already says what they need to practise.

The main agent already gets internal tools that are offered from live,
server-side state and never from what a user, a prompt or a file says:
`canvas_*` (ADR-0063), `generate_image` (ADR-0064) and `propose_memory`
(ADR-0078).

## Decision: two internal tools, offered only where Study is on

`propose_deck` and `propose_quiz` are internal tools for the main agent. They
are offered, and checked again when they run, only when all of these hold:

1. The chat is an ordinary conversation in a project (never General chats,
   drafting chats or sub-agents).
2. **The project's Study area is on.** This makes the area one input to a
   capability gate. It still grants nothing by itself: the tools read only the
   chat's existing file scope, and turning the area on adds no data access.
3. **The admin switch allows the person** (below).
4. **For a course project, the class switch is on** (below).
5. The chat's model supports tools.

Like `propose_memory`, they are not in capability pickers or the tools
allowlist, and user payloads, prompt text and approvals can't grant them.

## Decision: the admin switch is on by default

The admin policy `study_chat` is `{enabled, group_ids}`, like memory and image
generation, but **on when unset**. Unlike those features it only drafts:
nothing reaches Study until the person reviews and saves it, and the project's
Study area must also be on. A malformed stored value reads as off, so a bad
write never widens it.

- It is reported as `study_chat` in `GET /availability` (EPIC-96), so its entry
  points are hidden while it is off for someone (EPIC-97).
- `course_study_chat` is on while the policy is on for any group, so an
  educator's class switch is shown only when it can mean something.
- The settings export carries the on/off switch; group limits stay with the
  installation, as for memory.

## Decision: a class switch, on by default

A class's mode policy gains `study_chat_enabled` ("Let students make decks and
quizzes from chat"), default on, next to the memory switch. It can only narrow:
off, the tools aren't offered in that class's course projects. Students see it in
the course's policy notice with the educator who set it, and it doesn't touch the
students' own projects. Existing classes are migrated with it on.

## Decision: propose, then save

Each call records a pending draft: a deck (title and cards) or a quiz (title,
questions, answers and explanations), with the project files it cites. It shows
as a card in the message, where the person can edit it, save it to Study or
dismiss it. Saving goes through the existing deck, card and quiz services, which
check again that the project is the person's own and that cited files are in it;
saved items record the chat, message and execution that proposed them. A draft
is bounded like the button flows (one per tool per run, the same caps), and its
text is model output, validated like any input. Regenerating a reply makes new
drafts and leaves saved items alone.

The tools create new decks and quizzes only. Adding cards to an existing deck is
out of scope.

## Consequences

- People can turn a conversation into practice without leaving the chat, and
  every item still passes their review.
- Two switches decide availability; both default on, so new installations and
  existing classes get the feature without setup.
- `areas.study` now gates a capability, which its docstring and the project
  workspaces architecture note say.
