# EPIC-87: Architecture documentation refresh

Status: complete (2026-11-18; US-87.1 through US-87.7 merged). Proposed 2026-11-18. Source: user request (2026-11-18).

## Objective

Bring `docs/architecture/` in line with the code as it is today, and make it
pleasant to read. A contributor who opens one of these guides should learn how a
part of the system works, why it works that way, and where the code lives,
without having to piece it together from epics, ADRs and review notes.

The guides describe the current system. History belongs in ADRs, epics and the
archive, and the guides link to it rather than retelling it.

Out of scope: changing behavior. If the refresh finds a bug or a gap between an
ADR and the code, record it in `todo.md` as a follow-up and document what the code
does now.

## Where things stand (verified 2026-11-18)

| Area        | Today                                                                                          | Gap                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ----------- | ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Coverage    | 24 guides, about 5,300 lines                                                                   | No guide for canvas ([ADR-0063](../adr/0063-canvas.md)), image generation ([ADR-0064](../adr/0064-image-generation.md)), account lifecycle ([ADR-0070](../adr/0070-account-lifecycle.md)), groups and usage budgets ([ADR-0058](../adr/0058-user-groups.md), [ADR-0073](../adr/0073-usage-ledger-and-budgets.md)), classes and courses ([ADR-0053](../adr/0053-classes-and-educators.md)), learning modes and mode policy ([ADR-0068](../adr/0068-effective-mode-policy.md)), context compaction ([ADR-0060](../adr/0060-context-compaction.md)), logs and status ([ADR-0074](../adr/0074-production-logs-and-status.md)), the help center or team packs. "Suspend" appears in no guide |
| Accuracy    | Most guides were written story by story                                                        | Some name code that no longer exists (`file-knowledge-processing.md`) or contradict ADRs (General chat delegation in `tool-authorization.md`); `frontend-and-themes.md` still lists panes as Planned that now ship                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Readability | Dense, list-heavy prose                                                                        | Story and epic references in the body (28 in `frontend-and-themes.md`, 15 in `prompt-templates.md`); terms used before they are defined; few diagrams of flows                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Navigation  | `README.md` index plus an unordered "Additional guides" list                                   | No reading order, no single place that says which guide answers which question                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Size        | `frontend-and-themes.md` is 659 lines and mixes layout, themes, product surface and trust gaps | Hard to find one topic                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Link health | Links are checked by hand                                                                      | No automated check for broken relative links or anchors                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |

## Decisions

- **One template for every guide.** Each guide opens with a short paragraph on
  what it covers and who needs it, then explains the idea before the mechanics:
  _Purpose → Concepts → How it works → Invariants and security → Limits and
  failure behavior → Where the code lives → Related decisions._ A section may be
  skipped when it has nothing to say.
- **Present tense, current behavior.** Guides say what the system does. They do
  not say which story added it. Rationale is one sentence and an ADR link.
- **Write for a capable newcomer.** Define each term the first time it appears,
  prefer full sentences to fragments, and keep lists for things that really are
  lists. A short worked example ("when a student sends a message in a class
  project…") beats an abstract rule.
- **Diagrams where there is a flow.** Use Mermaid fenced blocks for request
  paths, lifecycles and state machines, so diagrams stay text and diff cleanly.
- **Code references are links.** Point at files and, where stable, symbols, so a
  reader can jump straight to the implementation.
- **Verify against code, not against older docs.** Every claim in a refreshed
  guide is checked against the source or a test.

## Open questions

1. ~~Should `theme-layout-review-matrix.md` move to `docs/reviews/`?~~ Decided
   2026-11-18: moved, as review evidence; the palette guide stays (US-87.6).
2. ~~Should the link checker run in CI or only locally?~~ Decided 2026-11-18:
   CI, in `quality-gates` (US-87.1).

## Follow-ups found

Problems in the code found while documenting it. They are recorded in `todo.md`
and are not fixed in this epic.

- Admin-only routes refuse a non-admin with 401 instead of 403, which the browser
  reads as an expired token (found in US-87.2).

## User stories

Suggested order: US-87.1 → 87.2 → 87.3 → 87.4 → 87.5 → 87.6 → 87.7.
US-87.1 sets the template and tooling the other stories use.

### US-87.1: Audit, template and link check

As a contributor, I know which guides are wrong or missing and how a refreshed
guide should read.

- [x] Audit every guide against the code: for each, list stale claims, missing
      features and removed features. Record the audit in
      `docs/reviews/2026-11-18-architecture-docs-audit.md`.
- [x] Write the guide template and writing rules in
      `docs/architecture/CONTRIBUTING.md` (structure, tone, terminology, diagram
      and link conventions, a before/after example).
- [x] Add a terminology list shared with the user guide (EPIC-89) so the same
      thing has the same name everywhere (for example _main agent_, _sub-agent_,
      _General chat set_, _execution file scope_).
- [x] Add `pnpm docs:check`: broken relative links, missing anchors and missing
      images across `docs/` and `README.md`. Wire it into CI (see open question 2).
- [x] Rewrite `docs/architecture/README.md` as a map: a reading order for new
      contributors, then a table of "if you want to know X, read Y".

### US-87.2: System, security and request path

As a contributor, I can follow one request from the browser to the database and
back, and I know every check it passes.

- [x] `overview.md`: topology diagram (nginx, Next.js, FastAPI, SQLite, LanceDB,
      file store), workspace layout, request and streaming flow.
- [x] `auth-and-security.md`: Better Auth and JWT/JWKS, the backend identity
      copy (ADR-0057), groups and roles, account lifecycle (suspend, reset links,
      deletion and deletion requests), edge hardening (CSP, HSTS, rate limits,
      trusted proxies), internal callbacks.
- [x] `chat-and-websocket.md`: protocol, reconnectable jobs, cancellation,
      admission limits, usage-limit refusals, with a job lifecycle diagram.
- [x] `capacity.md` and a new `operations.md`: process model, admission
      settings, logs and request IDs, readiness endpoints, Admin → Status, and admin
      settings export and import.
- [x] Remove story references and stale claims from these guides.

### US-87.3: Agents, tools and prompts

As a contributor, I understand how one turn is assembled and executed, and what
can and cannot grant a capability.

- [x] `execution-context.md`: one turn traced from membership through prompt
      layers (main-agent instructions, About you, learning mode, skills) to
      retrieval and provider access, as a diagram plus a worked example.
- [x] `agent-runtime.md`: bounded loop, events, delegation, traces, context
      compaction, verification.
- [x] `tool-authorization.md`: ordinary versus internal tools, a table of every
      internal tool (`sub_agent`, `search_knowledge`, `load_skill`, `canvas_*`,
      `generate_image`) and the conditions that offer it; approvals; the component
      registry of search providers and image generators.
- [x] `skills.md`, `prompt-templates.md`, `context-isolation.md`: refresh and
      remove history narration.
- [x] `llm-providers.md`: provider modes, model capabilities, ChatGPT plan
      connections, pricing used by the usage ledger.
- [x] New `learning-modes.md`: the modes, hint levels and show answer, how the
      effective mode is chosen (ADR-0068), and how class policy restricts it.

### US-87.4: Data, files and knowledge

As a contributor, I know where each piece of data lives, who can read it, and
what happens to it on upload, deletion, backup and upgrade.

- [x] `data-and-storage.md`: schema overview by domain (with an entity
      diagram), message tree, FTS search, migrations (ADR-0069); correct the
      serialization section, which names a `JSONB_COLUMN` helper that does not exist.
- [x] Merge or clearly divide `knowledge-retrieval.md` and
      `file-knowledge-processing.md` so each topic has one home: processing
      pipeline in one, scoped retrieval in the other.
- [x] `backup-and-restore.md`, `development-reset.md`: refresh against the
      current commands.
- [x] New `usage-and-budgets.md`: the usage ledger, what is recorded, group
      budgets, where refusals happen, what is never refused.
- [x] Add "Download my data" (ADR-0076) and user deletion to the data lifecycle
      section.

### US-87.5: Product domains without a guide

As a contributor, I can find an architecture guide for every shipped feature.

- [x] New `classes-and-courses.md`: classes, educators, invites, courses,
      course-managed content, mode policy and class insights.
- [x] New `canvas.md`: branch-aware canvas versions, the tools, trust rules and
      preview isolation.
- [x] New `image-generation.md`: provider configuration, group access, the
      prompt check, recording and produced files.
- [x] New `team-packs.md`: export and import, the manifest (ADR-0051) and what
      a pack never grants.
- [x] `study-tools.md`, `project-workspaces.md`: refresh against today's study
      pages (decks, review, quizzes, notes, summaries, guides, drafts) and
      project settings.

### US-87.6: Frontend

As a frontend contributor, I know how the app shell, themes, content rendering
and in-app help fit together.

- [x] Split `frontend-and-themes.md` into `frontend.md` (app shell, routing,
      data loading with TanStack Query and Hey API, layout and scrolling rules,
      settings structure) and `themes.md` (ownership, tokens, Theme Editor).
- [x] Replace the product-surface inventory with the current admin and user
      settings sections; only Code Execution is still Planned.
- [x] `markdown-content.md`, `theme-storage.md`, `bundled-theme-palettes.md`:
      refresh; resolve open question 1 for the review matrix.
- [x] New section on the help system: help registry, page guides, help center
      and first-chat tour, and how they relate to the user guide (EPIC-89).

### US-87.7: Final consistency pass

As a reader, the guides read as one set.

- [x] Read every guide end to end for tone, terminology and duplication; each
      topic has one home and other guides link to it.
- [x] No story or epic references remain in guide bodies.
- [x] `pnpm docs:check` passes; every new guide is in the index.
- [x] Update `CLAUDE.md`/`AGENTS.md` links that point at renamed or split guides.
