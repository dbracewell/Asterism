# Architecture documentation audit (2026-11-18)

This audit checks every guide in [`docs/architecture/`](../architecture/README.md)
against the code on `main` at `48341364`. It is the starting point for
[EPIC-87](../epics/EPIC-87-ARCHITECTURE-DOCS-REFRESH.md): each finding below is
assigned to the story that fixes it.

## How the audit was done

1. **Every guide was read** in full or, for the longest guides
   (`frontend-and-themes.md`, `data-and-storage.md`, `file-knowledge-processing.md`,
   `skills.md`, `prompt-templates.md`, `study-tools.md`), by section headings with
   the sections most likely to drift read in full.
2. **Every code name in backticks was checked against the source.** A script
   collected the functions, classes, settings and routes that the guides name and
   listed those that no longer appear anywhere under `apps/`, `scripts/` or
   `docker/`. Each hit was confirmed by hand; most were field names written as
   `Class.field`, which do exist.
3. **Every relative link was checked** with the new `pnpm docs:check`. Three broken
   links outside `architecture/` were fixed in the same story.
4. **Shipped features were matched to guides** using the ADR index, the backend
   domains under `apps/backend/asterism/domains/` and the app's settings navigation.

## Summary

The guides are, on the whole, accurate about what they cover. Their problems are
what they leave out, how they are organized, and how hard they are to read.

- **Coverage is the largest gap.** Of the 28 backend domains, 11 have no guide that
  describes them: `canvas`, `classes`, `courses`, `groups`, `usage`,
  `image_generation`, `learning`, `packs`, `status`, `components` (the registry of
  search providers and image generators) and `settings_transfer` (admin settings
  export and import). Account suspension and
  deletion appear in no guide at all.
- **A few guides contradict the code** or each other. These are listed under
  [Stale or wrong claims](#stale-or-wrong-claims) and are the most urgent fixes,
  because a reader cannot tell them from the accurate parts.
- **The guides read as a changelog.** Headings and sentences name the story that
  added a behavior ("Run usage and cost (US-54.1)"). Nineteen of the 24 guides do
  this, 118 times in total. A reader has to know the project's history to follow
  the present.
- **Topics are scattered.** Learning modes live in `execution-context.md`; pricing
  lives in `agent-runtime.md`; the system topology is drawn twice. The index lists
  ten guides in a table and the other fourteen in an unordered list.

## Stale or wrong claims

| Guide                                            | Claim                                                                                                                                                                                                      | What the code does                                                                                                                                                                             | Story      |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| `tool-authorization.md`, `chat-and-websocket.md` | The `tool_approval` command takes `always_allow`, a remembered approval                                                                                                                                    | No code reads or sends `always_allow`; the controller reads only `tool_id` and `approved` ([controller.py](../../apps/backend/asterism/domains/chat/controller.py))                            | 87.2, 87.3 |
| `tool-authorization.md`, `agent-runtime.md`      | Depth is bounded by a `MAX_SUB_AGENT_DEPTH` constant (default 3)                                                                                                                                           | Depth is the `max_sub_agent_depth` setting read from configuration ([sub_agent.py](../../apps/backend/asterism/domains/tools/builtin/sub_agent.py))                                            | 87.3       |
| `tool-authorization.md`                          | "General has no delegation scope"                                                                                                                                                                          | General chats delegate to the main agent's General chat set ([ADR-0059](../adr/0059-general-chat-delegation.md)), as `agent-runtime.md` correctly says                                         | 87.3       |
| `execution-context.md`                           | "General sees only active-branch local references and has no delegation targets"; delegation "validates current project targets"                                                                           | Same as above: General chats have targets from the General chat set                                                                                                                            | 87.3       |
| `agent-runtime.md`                               | The prompt layer table lists seven layers                                                                                                                                                                  | The composer has nine kinds, adding `task` (skill drafting) and `skill_catalog` ([prompts.py](../../apps/backend/asterism/domains/agent/prompts.py))                                           | 87.3       |
| `agent-runtime.md`                               | "Usage views read only these recorded values" (per-message pricing)                                                                                                                                        | Usage views read the usage ledger, `usage_records` ([ADR-0073](../adr/0073-usage-ledger-and-budgets.md))                                                                                       | 87.4       |
| `auth-and-security.md`                           | Admin → Users is a "read-only user list"                                                                                                                                                                   | Admins suspend, reactivate, reset and delete accounts there ([ADR-0070](../adr/0070-account-lifecycle.md))                                                                                     | 87.2       |
| `file-knowledge-processing.md`                   | Work runs through `KnowledgeIngestionJobs` and `KnowledgeCaptionJobs` via `ingest_file_artifact` and `_caption_file_artifact`; `runtime.py` builds `knowledge_ingestion_jobs` and `knowledge_caption_jobs` | One `JobManager` in [runtime.py](../../apps/backend/asterism/domains/knowledge/runtime.py) runs `ingestion.ingest_file` and `captioning.caption`; none of the named classes or functions exist | 87.4       |
| `file-knowledge-processing.md`                   | Also names `ExecutionContextResolver`, `KnowledgeProcessingProfileModel`, `KnowledgeCaptionConfigurationModel`, `_provider_caption_document`                                                               | None of these exist                                                                                                                                                                            | 87.4       |
| `knowledge-retrieval.md`                         | Relational data uses "direct schema initialization"                                                                                                                                                        | The schema is managed by Alembic migrations ([ADR-0069](../adr/0069-versioned-schema-migrations.md))                                                                                           | 87.4       |
| `data-and-storage.md`                            | Describes a `JSONB_COLUMN` helper                                                                                                                                                                          | No such name exists; see [columns.py](../../apps/backend/asterism/db/columns.py)                                                                                                               | 87.4       |
| `frontend-and-themes.md`                         | "Admin navigation retains five **Planned** badges"                                                                                                                                                         | Only Code Execution is Planned                                                                                                                                                                 | 87.6       |
| `README.md` (index)                              | Two topology diagrams, here and in `overview.md`, that differ in detail                                                                                                                                    | One should remain, in `overview.md`                                                                                                                                                            | 87.1, 87.2 |

## Missing coverage

| Feature                                                                                                           | Where it is decided                                        | Where it should be documented          | Story |
| ----------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- | -------------------------------------- | ----- |
| Groups and roles                                                                                                  | [ADR-0058](../adr/0058-user-groups.md)                     | `auth-and-security.md`                 | 87.2  |
| Account lifecycle: suspend, reset links, deletion, deletion requests, sign out everywhere                         | [ADR-0070](../adr/0070-account-lifecycle.md)               | `auth-and-security.md`                 | 87.2  |
| Edge hardening: CSP, HSTS, rate limits, trusted proxies                                                           | [ADR-0071](../adr/0071-edge-hardening.md)                  | `auth-and-security.md`                 | 87.2  |
| Production logs, request IDs, readiness, Admin → Status                                                           | [ADR-0074](../adr/0074-production-logs-and-status.md)      | new `operations.md`                    | 87.2  |
| Internal tools `load_skill`, `canvas_*`, `generate_image`                                                         | ADR-0062, ADR-0063, ADR-0064                               | `tool-authorization.md` table          | 87.3  |
| Learning modes and mode policy (now inside `execution-context.md`)                                                | ADR-0028 to ADR-0031, ADR-0055, ADR-0068                   | new `learning-modes.md`                | 87.3  |
| Usage ledger and group budgets (now a short section of `data-and-storage.md`)                                     | [ADR-0073](../adr/0073-usage-ledger-and-budgets.md)        | new `usage-and-budgets.md`             | 87.4  |
| Model pricing (now inside `agent-runtime.md`)                                                                     | ADR-0073                                                   | `llm-providers.md`                     | 87.3  |
| Classes, educators, invites, courses, class insights                                                              | [ADR-0053](../adr/0053-classes-and-educators.md), ADR-0055 | new `classes-and-courses.md`           | 87.5  |
| Canvas, including its preview frame (the one frame the CSP allows)                                                | [ADR-0063](../adr/0063-canvas.md)                          | new `canvas.md`; `markdown-content.md` | 87.5  |
| Image generation                                                                                                  | [ADR-0064](../adr/0064-image-generation.md)                | new `image-generation.md`              | 87.5  |
| Team packs (only listed in the index today)                                                                       | [ADR-0051](../adr/0051-team-pack-format.md)                | new `team-packs.md`                    | 87.5  |
| Component registry: search providers and image generators                                                         | —                                                          | `tool-authorization.md`                | 87.3  |
| Admin settings export and import (Admin → Export)                                                                 | —                                                          | new `operations.md`                    | 87.2  |
| Help center, page guides and first-chat tour                                                                      | [ADR-0032](../adr/0032-in-app-help-content.md)             | `frontend.md`                          | 87.6  |
| Backend domain map: all 28 domains (the `execution-context.md` table lists 7)                                     | —                                                          | `overview.md`                          | 87.2  |
| Schema overview: the ERD shows 14 tables and none from classes, groups, usage, canvas, study, skills or templates | —                                                          | `data-and-storage.md`                  | 87.4  |

## Per-guide assessment

**Current** means accurate, with only story references to remove. **Revise** means
accurate in the main but with gaps or a few stale claims. **Rewrite** means the
guide needs restructuring or a substantial share of it is wrong.

| Guide                           | Lines | Verdict | Main problems                                                                                                                  | Story |
| ------------------------------- | ----- | ------- | ------------------------------------------------------------------------------------------------------------------------------ | ----- |
| `README.md`                     | 134   | Rewrite | Half table, half unordered list; duplicate topology; no reading order                                                          | 87.1  |
| `overview.md`                   | 150   | Revise  | Workspace layout names 6 of 28 domains; topology omits nginx and LanceDB; links to README configuration that EPIC-88 will move | 87.2  |
| `auth-and-security.md`          | 144   | Rewrite | Stale Users claim; no groups, lifecycle or edge hardening; About you section sits after the theme section                      | 87.2  |
| `chat-and-websocket.md`         | 206   | Revise  | `always_allow`; no usage-limit refusal; story references                                                                       | 87.2  |
| `capacity.md`                   | 119   | Current | Accurate and recent; points to README sizing that EPIC-88 will move                                                            | 87.2  |
| `agent-runtime.md`              | 405   | Revise  | Layer table; depth constant; pricing belongs elsewhere; six story-named headings                                               | 87.3  |
| `tool-authorization.md`         | 101   | Rewrite | Three stale claims; tool table misses three internal tools                                                                     | 87.3  |
| `execution-context.md`          | 264   | Revise  | General delegation claims; learning modes (half the guide) belong in their own guide                                           | 87.3  |
| `context-isolation.md`          | 82    | Current | Story reference in the title                                                                                                   | 87.3  |
| `skills.md`                     | 313   | Revise  | Accurate; title and sections carry story numbers                                                                               | 87.3  |
| `prompt-templates.md`           | 244   | Revise  | Accurate; organized by story (seven story-named sections)                                                                      | 87.3  |
| `llm-providers.md`              | 146   | Revise  | Missing pricing and image-generation providers; one 100-word line                                                              | 87.3  |
| `data-and-storage.md`           | 413   | Rewrite | Partial ERD; `JSONB_COLUMN`; "Related Documentation" heading sits in the middle with sections after it                         | 87.4  |
| `knowledge-retrieval.md`        | 267   | Revise  | Schema initialization claim; two benchmark sections; overlaps `file-knowledge-processing.md`                                   | 87.4  |
| `file-knowledge-processing.md`  | 363   | Rewrite | Component table names classes and functions that no longer exist                                                               | 87.4  |
| `backup-and-restore.md`         | 112   | Current | Recent and accurate                                                                                                            | 87.4  |
| `development-reset.md`          | 110   | Current | Recent and accurate                                                                                                            | 87.4  |
| `study-tools.md`                | 246   | Revise  | Organized by story; accurate against today's study routes                                                                      | 87.5  |
| `project-workspaces.md`         | 376   | Revise  | "Story boundary and verification" section is history; learning goals and reflections fit here, classes do not appear           | 87.5  |
| `frontend-and-themes.md`        | 659   | Rewrite | Mixes four subjects; 28 story references; stale Planned inventory; no canvas or help system                                    | 87.6  |
| `markdown-content.md`           | 166   | Revise  | No canvas preview; "Verification and remaining work" is history                                                                | 87.6  |
| `theme-storage.md`              | 128   | Current | Story references in two headings                                                                                               | 87.6  |
| `bundled-theme-palettes.md`     | 93    | Current | Story references                                                                                                               | 87.6  |
| `theme-layout-review-matrix.md` | 82    | Move    | Review evidence rather than architecture (EPIC-87 open question 1)                                                             | 87.6  |

## Fixed in US-87.1

- `pnpm docs:check` checks relative links, anchors and images in `README.md` and
  `docs/` (archived checklists excepted) and runs in CI.
- Broken links fixed: two anchors in EPIC-26 that pointed at renamed
  `agent-runtime.md` sections, and a misspelled file name in the 2026-10-17 review.
- The guide template, writing rules and shared terminology are in
  [`architecture/CONTRIBUTING.md`](../architecture/CONTRIBUTING.md) and
  [`docs/terminology.md`](../terminology.md).
- The index ([`architecture/README.md`](../architecture/README.md)) is a map with a
  reading order. Its duplicate topology diagram is removed; `overview.md` keeps its own.

## Resolution (2026-11-18)

Every finding above was fixed in EPIC-87, US-87.2 to US-87.7:

- The stale claims are corrected, and every code name the guides use exists.
- Nine new guides cover the missing domains: `operations.md`, `learning-modes.md`,
  `usage-and-budgets.md`, `classes-and-courses.md`, `canvas.md`,
  `image-generation.md`, `team-packs.md`, `frontend.md` and `themes.md`.
  `frontend-and-themes.md` is split into the last two, and the review matrix moved
  to `docs/reviews/`.
- No guide body names the story that added a behavior, except links to planned work.
- `pnpm docs:check` also covers the app and scripts READMEs and the agent
  playbooks, where it found 16 more broken links.

One code issue found along the way is recorded in `todo.md`: admin-only routes
refuse a non-admin with 401 instead of 403.
