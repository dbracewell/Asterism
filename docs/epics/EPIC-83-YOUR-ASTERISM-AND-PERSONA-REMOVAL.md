# EPIC-83: Your Asterism (replace personas with one "About you")

Status: complete (2026-11-17). Source: user request (2026-11-17) and the
[feature overlap review](../reviews/2026-11-17-feature-overlap-review.md).

## Objective

Remove multiple user personas. Learning modes already switch how Asterism
responds, so a per-chat persona picker is a second way to do the same thing.
Each user instead writes one **About you** text, as in Claude's personal
preferences: who they are, what they know, and how they like answers. It lives in
a new **Your Asterism** section of User Settings, which will later hold memory
settings.

## Current state (what goes away)

- `user_personas` table, `users.default_persona_id` / `persona_revision`, the
  insert trigger that creates a Default persona, the 20-persona limit
  ([ADR-0021](../adr/0021-personas-and-execution-binding.md)).
- `persona_router` CRUD and default switching; `domains/user/personas.py`,
  `persona_schemas.py`.
- Per-chat persona override: `chats.persona_id` / `persona_revision`,
  `change_chat_persona`, the composer persona chip
  (`chat-persona-picker.tsx`) and the header persona label.
- Reflections partitioned and filtered by `persona_id`, with cascade-on-delete
  ([ADR-0048](../adr/0048-session-reflections.md)).
- `persona_id` on skill-drafting runs ([ADR-0061](../adr/0061-skill-drafting-runs.md)).
- Settings → Personas, the `settings.personas` and `concept.persona` help pages
  and the `persona` guided-tour step.

## What stays

- The **profile** prompt layer, in the same place in the layer order (after the
  main-agent layer, before the mode layer). Its text is now About you.
- Pinning: each accepted message records the About you text and revision it was
  sent with, immutably, as today. Resume and replay use the recorded text;
  regenerate uses the current text. Child agents inherit the recorded layer.
- About you grants nothing: no tools, files, delegation, role or memory access.
- The rule that a learning mode does not override the user's explicit
  constraints (ADR-0028: the profile layer still outranks the mode).

## Decisions

- **Storage:** `users.about_md` (Text, default empty) and `users.about_revision`
  (positive int). Same limits as USER.md today: 16,000 characters /
  64,000 UTF-8 bytes, no NUL or non-text control characters. Edits require the
  expected revision and return 409 on conflict. No separate table: there is
  exactly one per user, and the user row is already the owner lock.
- **Empty is valid.** A new user starts with no About you; an empty text adds no
  profile layer. The "at least one profile, exactly one default" invariant is
  removed, not replaced.
- **No per-chat override.** Users switch response behavior with learning modes.
- **Reflections** partition by user and project (or user and chat in General).
  The persona filter is removed.
- **Memory namespaces** key by user (plus project, or chat in General); the
  profile segment is dropped. No memory engine is added in this epic.
- **No migration.** Change the schema directly and reset the development
  database (`scripts/reset-databases.mjs`).
- A new ADR supersedes ADR-0021 and amends ADR-0028, ADR-0048 and ADR-0061.

## User stories

### US-83.1: About you replaces personas (backend)

- [x] ADR-0066 "About you": storage, limits, revisioning, pinning, layer order,
      supersedes ADR-0021; amend ADR-0028/0048/0061 and ADR-0016 (memory contracts).
- [x] Add `about_md` / `about_revision` to `UserModel` with check constraints;
      remove `PersonaProfileModel`, `default_persona_id`, `persona_revision`,
      the Default-persona insert trigger and the deferred FK.
- [x] `GET /users/me/about` and `PUT /users/me/about` (with `expected_revision`);
      delete `persona_router` and its schemas/service.
- [x] Prompt composition: build the profile layer from the user's About you
      (skip when blank), framed as information about the user rather than
      instructions; pin `accepted_about` (text + revision) on message
      acceptance; keep the immutability trigger; resume rechecks nothing beyond
      ownership.
- [x] Remove `chats.persona_id` / `persona_revision`, `change_chat_persona` and
      the chat persona route; drop `pending_persona` from `ChatInfo`.
- [x] `ExecutionScope`: replace `user_profile_id` / `user_profile_revision` /
      `persona_layer` with the About you revision and layer; update
      `MemoryNamespace` to user + project/chat.
- [x] Reflections: drop `persona_id`, its FK, index segment and list filter.
- [x] Skill drafting: drop `persona_id` from the run payload.
- [x] AI-use log, context inspection, comparisons: report "About you
      (revision N)" instead of persona name/ID.
- [x] Tests: replace persona suites with About you tests (revision conflict,
      limits, blank → no layer, pinning on accept, resume vs regenerate,
      reflections without persona). Regenerate OpenAPI and the Hey API client.

### US-83.2: Your Asterism settings section (frontend)

- [x] Add a **Your Asterism** User Settings section directly after General,
      replacing Personas. One card, **About you**: a textarea with character
      count, guidance text and examples of facts about the user ("What should
      Asterism know about you?"; no "how should it respond" prompt, since that
      belongs in main-agent instructions), Save with revision-conflict handling.
- [x] Do not add a memory placeholder card; the section is structured so a
      Memory card can be added later.
- [x] Delete `persona-settings.tsx`, `persona-queries.ts` and their tests.
- [x] Settings links/deep links that pointed to `personas` point to `your-asterism`.

### US-83.3: Remove persona from chat and the rest of the UI

- [x] Remove `chat-persona-picker.tsx`, the persona composer chip
      (`composer-chip.ts`), the header persona label and new-chat persona state.
- [x] Message provenance shows "About you" (with revision) when the profile
      layer was present, instead of the persona name; update `context-manifest.ts`
      and `ai-use-log.ts`.
- [x] Reflections UI: remove the persona filter and persona labels.
- [x] Help: replace `settings.personas` and `concept.persona` with
      `settings.your-asterism` / `concept.about-you`; update the composer, header
      and transcript help text that mentions personas; remove the `persona` tour
      step (point the tour at the learning-mode chip instead).
- [x] Update unit tests and Playwright specs; `pnpm lint`, `typecheck`, `test`,
      `format:check` pass.

### US-83.4: Docs and invariants

- [x] `CLAUDE.md`/AGENTS.md: rewrite §2.2 (Profiles → About you), the persona
      paragraph in §3.3, §4 invariant 1 and §10; remove "multi-profile users"
      from the overview.
- [x] Architecture docs: `execution-context.md`, `context-isolation.md`,
      `agent-runtime.md`, `chat-and-websocket.md`, `data-and-storage.md`,
      `skills.md`, `project-workspaces.md`, `auth-and-security.md`,
      `frontend-and-themes.md`.
- [x] Backend and frontend READMEs where they mention personas.

## Settled questions

- **Main-agent instructions vs About you** (decided 2026-11-17). They stay
  separate and mean different things:
  - **Main-agent instructions** say how the agent acts. They stay in Settings →
    Agents beside capabilities and loop limits.
  - **About you** is information about the user that the agent uses when it
    writes an answer, like a persistent memory of the user. It does not tell the
    agent how to behave.

  The prompt wraps the profile layer as information about the user, not as
  instructions, and the field label, help text and examples say so ("I'm a
  second-year nursing student; I know basic chemistry"). Response-style requests
  belong in main-agent instructions or a learning mode. When long-term memory
  arrives, it sits beside About you in Your Asterism as the same kind of thing.

- **Educator-provided context.** Course projects carry project instructions and
  a tutor sub-agent; nothing in a course used personas. No change needed.

## Notes

Not in this epic: long-term memory, or any automatic edit of About you by the
agent. Those belong to a later memory epic hosted in Your Asterism.
