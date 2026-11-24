# EPIC-98: Decks and quizzes from chat

Status: in progress (2026-11-24). US-98.1 done. Source: user request (2026-11-24): "New tools for
creating decks and quizzes which are automatically added when chatting in a
project with those study options available."

## Objective

In a chat inside a project with Study turned on, the main agent can draft a
flashcard deck or a practice quiz from the conversation and the project's files.
The person reviews the draft in the chat and saves it to the project's Study
area. Nothing reaches Study without the person saving it.

Out of scope: replacing the existing Study buttons and their generation
pipelines, which stay; study tools for sub-agents and drafting chats; editing
existing decks or quizzes from chat.

## Where things stand (verified 2026-11-24)

- **Decks and quizzes already exist** (EPIC-53; ADRs 0033-0037). The tables are
  `study_decks`, `study_cards`, `study_quizzes` (with `origin` "generated" or
  "practice") and `study_quiz_questions` (`domains/study/models.py`). The routes
  are under `/projects/{id}/study` (`domains/study/router.py`).
- **They are made with buttons only.** Card generation (`study/generation.py`,
  ADR-0034) returns drafts that the person accepts through card create. Quiz
  generation (`study/quiz_generation.py`, ADR-0035) generates and saves in one
  step. Usage is billed as `UsageSource.STUDY`.
- **No chat link.** Nothing in `domains/chat`, `domains/agent` or
  `features/chat` mentions decks or quizzes.
- **"Study" is a display switch.** `ProjectAreas.study`
  (`domains/projects/areas.py:11-22`) is documented as "display preferences only.
  Nothing on the server reads them to grant, remove or narrow a capability."
  Course copies force it on (`courses/copies.py:223`). There is no admin or class
  policy for study.
- **Internal tools pattern.** `resolve_effective_tools`
  (`domains/chat/tool_policy.py:30`) adds `canvas_*`, `generate_image` and
  `propose_memory` through `_offers_*` gates (:115-140) when the model supports
  tools and the agent is not a sub-agent. `require_internal_tool` (:149)
  re-checks them at execution time. Prompt guidance is added only for offered
  tools (`prompt_composition.py:190-227`). Results are stored on
  `MessageModel.tool_call_results` and rendered as cards by tool name
  (`message-item.tsx:184-188`, for example `MemoryProposalCards`).

## Decisions (to record in a new ADR)

- **Two internal tools: `propose_deck` and `propose_quiz`.** They are offered to
  the main agent in a project chat when all of these hold:
  - the project's Study area is on;
  - the model supports tools;
  - the chat is an ordinary conversation, not drafting;
  - the person may use study tools (see open question 1).

  Like `propose_memory`, they are not in capability pickers or the Tools
  allowlist. User payloads and prompt text cannot grant them.

- **This changes what `areas.study` means.** It becomes one input to an internal
  tool gate. It still grants nothing on its own: turning it on adds no data
  access, and the tools read only the chat's existing file scope. The new ADR
  amends the `areas.py` docstring and ADR-0065's statement about areas, and
  CLAUDE.md §2.4 gets a bullet.
- **Propose, then save.** Each tool call records a pending draft: a title plus
  cards, or questions with answers and explanations, plus the cited project
  files. It renders as a card in the message: preview, edit, Save to Study,
  Dismiss. Saving goes through the existing `service.create_deck` /
  `create_card` and `quizzes.save_quiz` (with a new `origin` value `"chat"`).
  Those calls re-check that the project is the person's own and that cited files
  are in it.
- **Drafts are bounded.** At most one proposal per tool per run, a cap on cards
  and questions (the same as the button flows), and size limits on each field.
  Tool arguments are model output and are validated like any user input.
- **Provenance.** Saved decks and quizzes record the chat, message and execution
  that proposed them. Usage stays billed to the chat run. No second LLM pass
  runs at save time.
- **Branch-aware.** Drafts belong to the message that made them. Regenerating
  makes new drafts and leaves saved items untouched.

## Policy (decided 2026-11-24)

- **Admin switch.** A `study_chat` admin policy, `{enabled, group_ids}` like
  memory and image generation, **on by default** (unlike other features, because
  it only drafts things the person reviews, and Study must also be on). It is
  reported as `study_chat` in `GET /availability`, so EPIC-97's hiding applies.
- **Class switch.** A class's mode policy gets "Let students make decks and
  quizzes from chat", on by default, next to the memory switch. Off, the tools
  aren't offered in that course's projects.
- **Existing decks:** out of scope. The tools only create new decks and quizzes,
  as drafts the person reviews and saves.

The tools are offered when all of these hold: the chat is an ordinary
conversation in a project; the project's Study area is on; the admin switch
allows the person; the class switch (for a course project) is on; and the
model supports tools.

## User stories

Suggested order: US-98.1 → 98.2 → 98.3 → 98.4 → 98.5.

### US-98.1: Policy, class switch and ADR

- [x] Write the ADR (gate, propose-then-save, provenance) and amend the
      `areas.py` docstring, ADR-0065 and CLAUDE.md §2.4. Done as
      [ADR-0080](../adr/0080-study-tools-in-chat.md); the areas change is noted in
      `areas.py` and `project-workspaces.md` (ADR-0065 is about the fetch tool).
- [x] Admin `study_chat` policy (`{enabled, group_ids}`, default on), its admin
      endpoints and Admin Settings section, and `study_chat` in
      `GET /availability`.
- [x] Class switch `study_chat_enabled` (default on) on the class mode policy,
      with a migration and an upgrade test, and the switch in the class page.
- [x] Settings export covers the admin policy (EPIC-100's registry, or the
      current export until then).
- [x] Tests: defaults, group limits, the class switch, availability.

### US-98.2: Draft storage

- [ ] Add a `study_proposals` table: owner, project, chat, message, execution,
      kind, payload, status. Ship it with an Alembic migration, an upgrade test
      from the previous revision, and Download my data coverage.
- [ ] Add `origin="chat"` and proposal provenance columns on decks and quizzes,
      as a migration.

### US-98.3: The tools

- [ ] Add `propose_deck` and `propose_quiz` in `domains/tools/builtin/`, with
      their constants in `tools/catalog.py` (internal, policy-gated), a gate
      `_offers_study`, a branch in `require_internal_tool`, and prompt guidance.
- [ ] Tests:
  - offered only when the project, the Study area, the admin and class
    switches and model tools all line up;
  - never offered to sub-agents or in General chats;
  - re-checked at execution time;
  - payload validation and caps;
  - one proposal per tool per run.

### US-98.4: Review and save in chat

- [ ] Save and dismiss endpoints: owner-only; recheck the project, the Study
      area, the switches and file membership; the save is idempotent.
      Regenerate the client.
- [ ] Frontend `StudyProposalCards` in `message-item.tsx`: preview, edit before
      saving, Save to Study (with a link to the new deck or quiz), Dismiss, and
      timeline labels in `agent-timeline.ts`.
- [ ] Unit tests and a Playwright test: ask for a deck in a project chat, then
      save it and see it under Study.

### US-98.5: Docs

- [ ] Hide the mention of the tools in help when unavailable (EPIC-97).
- [ ] Update `docs/architecture/study-tools.md`, the user guide pages
      (`05-studying/flashcards.md`, `practice-quizzes.md`), the educator and
      admin guide pages for the two switches, and the release notes.

## Settled questions

1. **Admin control:** yes, an admin policy, on by default, optionally by group.
2. **Class control:** yes, a class switch, on by default.
3. **Existing decks:** no; the tools only create new decks and quizzes.
