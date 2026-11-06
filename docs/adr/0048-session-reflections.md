# ADR-0048 — Session reflections

Status: accepted and implemented for US-58.2 on 2026-11-06
([EPIC-58](../epics/EPIC-58-LEARNING-GOALS-REFLECTION-AND-PROGRESS.md)).

## Context

Learners want to capture what they learned and what is still unclear at the
end of a session, optionally starting from a suggested draft, and to review,
edit and delete those notes per project. EPIC-58 requires explicit user-owned
records partitioned by user, profile and project, never an automatic memory
engine (AGENTS.md §3.3).

## Decision

- **A `reflections` domain** with one table. Each row has `user_id`,
  `persona_id`, `project_id` (null for General), a link to the source
  `chat_id`, `learned`, `unclear` (≤ 2,000 characters each, at least one
  non-blank) and a revision.
- **Partitioning from the chat, server side.** Creating a reflection names an
  owned chat. The server takes the chat's project and its current persona (the
  default persona when the chat has none); clients cannot choose them.
  `persona_id` is a composite owner foreign key that cascades, so deleting a
  persona deletes its reflections. A deleted project sets `project_id` to null,
  moving its reflections to General like its chats; a deleted chat only clears
  the link.
- **Reads.** `GET /reflections/` lists one partition, a project or General,
  newest first, optionally narrowed to one persona. Filters run in the database
  before pagination, from an owner-scoped base select. A foreign persona filter
  is 404. Updates and deletes are revision compare-and-set (409 when stale), and
  foreign IDs are 404.
- **Suggested drafts are ephemeral.** `POST /reflections/draft` uses the
  chat-title model (`resolve_title_model`), like the prompt coach. It reads the
  active branch as untrusted text inside `<chat>` tags (the newest 12,000
  characters), leaves out tool steps and spot-the-error answers (which contain a
  deliberate error), and asks for short first-person suggestions grounded in the
  learner's own messages. The parse is lenient and bounded (600 characters per
  part). Nothing is stored or logged, and the response is `no-store`. With no
  usable model it is 503, and a failed or unreadable reply is 502.
- **UI.** **Reflect on this session** in a chat's menu opens a dialog with
  "What did I learn?" and "What's still unclear?". **Suggest a draft** fills
  both, after a confirmation if the learner already wrote something, and asks
  them to edit it. The project and General pages list reflections with a
  persona filter, inline editing and confirmed deletion.
- **No automatic use.** Agents never read reflections; including them in a chat
  is out of scope here, and US-58.4 turns unclear items into practice only with
  per-item confirmation.

## Consequences

- New table, so the development reset is needed.
- Reflections partition by persona at write time. Changing a chat's persona
  later affects only new reflections.
