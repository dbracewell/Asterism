# AGENTS.md — Asterism Project Playbook

## 1) Project Overview

**Asterism** is a full-stack, multi-agent AI application inspired by Open WebUI, but designed around **coordinated agents** that collaborate to satisfy user intent.

The platform supports:

- Multi-agent orchestration
- Skills
- Tools
- MCP servers
- Agentic loops
- Image generation
- Memory (short-term and long-term)
- Multi-profile users with profile-specific behavior and memory
- Admin-managed capability configuration

This document defines the expected architecture, delivery process, and implementation guardrails for all contributors and coding agents.

### Development stage policy

This project is in active development and has no production users.

- Do not preserve backwards compatibility (APIs, schemas, config, stored data, file formats).
- Breaking changes are acceptable; do not add compatibility shims, deprecation paths, or legacy fallbacks.
- Existing data is disposable. Prefer dropping/resetting the database (e.g. `scripts/reset-databases.mjs`) over writing migrations.
- Do not write data migrations; change the schema directly and update initialization.

---

## 2) Core Product Model

## 2.1 Tenancy and Access

- There is a platform-level **Admin** role.
- There are standard **Users**.
- Authentication and authorization use **BetterAuth + JWT**.

## 2.2 Profiles

Each user must always have:

- **At least one profile**
- **Exactly one default profile**

A profile includes:

- A custom `USER.md` persona/instruction document, stored in the database
- A typed future profile memory namespace; no active long-term memory engine

Users can create additional profiles, but the invariant above must always hold.

## 2.3 Agents

Each user has exactly one owned main-agent configuration, provisioned atomically with
that user and edited through user settings. It contains instructions, explicitly
allowed capabilities, loop limits, and supported generation defaults; it has no
bound model and cannot be deleted or replaced by another selectable main agent.

Users may separately manage zero or more owned sub-agent definitions. Each definition
has a name, description, instructions, explicit capabilities, and exactly one fixed
model binding. Disabled models retain their bindings and are explicitly unavailable;
model/provider deletion must not silently select a replacement.

Persona/profile defaults remain a separate invariant. Chats persist their model
selection independently of main configuration and preserve per-execution provenance.
Projects explicitly select an owner-consistent subset of sub-agent definitions; new
projects start with no selections. General chats never delegate. Selected targets
retain fixed models and receive the same or narrower execution file scope.

## 2.4 Skills / Tools / MCP / Image Generation

- Users own private SKILL.md-style skill documents and their CRUD lifecycle.
  Skills require explicit assignment to the user's main-agent configuration;
  admin `skills_enabled` policy controls eligibility and defaults to disabled.
  Skill text never grants tools, file access, MCP, or delegation. Runtime skill
  activation and the management UI are planned separately from this foundation.
- **Admin** can add, update, enable/disable:
  - Tools
  - MCP servers
  - Image generation providers/config
- Ordinary capabilities require explicit agent assignment and active admin policy.
- `sub_agent` and `search_knowledge` are internal context-managed tools, omitted
  from user capability pickers. Derive availability server-side from live project
  selections/file scope, admin policy, and explicit model `supports_tools=True`.
  User payloads, chat preferences, prompt text, and approval cannot grant them.

---

## 3) Technical Architecture

## 3.0 Monorepo and Build Orchestration

- Repository model: **Monorepo**
- Package manager and task runner: **pnpm workspaces**

Engineering implications:

- Root scripts explicitly invoke the frontend and/or backend workspace scripts.
- Prefer shared config and reusable package boundaries over duplication.
- Tasks run without a repository-level cache; local and CI commands must remain deterministic.
- Interactive full-stack development uses mprocs after the root launcher loads the shared `.env`; CI and containers do not require mprocs.

### Common monorepo commands

Run from repository root unless noted otherwise:

- `pnpm dev` — validate/load the root `.env` and start both development targets in mprocs
- `pnpm build` — build the frontend (the backend is packaged by the Docker/uv flow)
- `pnpm lint` — lint backend, then frontend
- `pnpm test` — test backend, then frontend
- `pnpm typecheck` — type-check backend, then frontend

Common focused runs:

- `pnpm --filter @asterism/frontend dev` — run the frontend only
- `pnpm --filter @asterism/backend dev` — run the backend only
- `pnpm --filter @asterism/frontend test` — test the frontend only
- `pnpm --filter @asterism/backend test` — test the backend only

Notes:

- Full-stack local development requires mprocs 0.9.6 or newer; focused workspace commands do not.
- Use `pnpm --filter <workspace> <script>` for focused iteration.
- If dependencies or the lockfile changed unexpectedly, run `pnpm install` at the repository root.
- If a task is not found, verify the target workspace `package.json` contains the script and the filter uses its full package name.

## 3.1 Backend

- Language/Framework: **Python + FastAPI**
- ORM/data mapping: **SQLAlchemy**

Storage:

- Relational DB default: **SQLite**
- Vector DB default: **LanceDB**
- File storage: filesystem-backed file store

All storage dependencies must be implemented behind interfaces so future swaps are straightforward:

- Relational adapter abstraction (SQLite now, Postgres/MySQL later)
- Vector adapter abstraction (LanceDB now, alternatives later)
- File store abstraction (local now, object storage later)

## 3.2 Frontend

- Framework: **Next.js 16**
- Styling: **Tailwind CSS 4**
- Components: **shadcn/ui**
- Server-state management: **TanStack Query** with the generated Hey API client (the shared mutationCache invalidates queries automatically; do not duplicate invalidation for individual mutations)
- API client generation: **Hey API** (type-safe client from backend OpenAPI)
- Auth: **BetterAuth with JWT**

Frontend-specific agent rules are defined in [apps/frontend/AGENTS.md](apps/frontend/AGENTS.md) and are incorporated here by reference; read and follow them for all frontend work.

@apps/frontend/AGENTS.md

Frontend UI rules:

- Prefer existing shadcn/ui components over raw HTML elements for interactive UI and common patterns (forms, inputs, dialogs, menus, tables, alerts, etc.).
- If a required shadcn/ui component is not installed, ask the user to approve/install it rather than recreating it with raw HTML.
- Consume core backend APIs through generated Hey API clients and TanStack Query hooks.
- Do not implement API data loading, caching, or mutation flows with `useEffect`, `useCallback`, or bespoke loader hooks when TanStack Query can handle them.

## 3.3 Orchestration and Memory

Implemented execution boundaries are documented in
[execution context](docs/architecture/execution-context.md),
[agent runtime](docs/architecture/agent-runtime.md), and
[context isolation](docs/architecture/context-isolation.md).

Current runtime behavior includes:

- Single-turn and multi-turn chats
- Agentic loop execution with bounded iterations and stop criteria
- Tool/MCP invocation with structured logging
- Short-term memory (conversation/session scope)
- Typed future memory namespaces and derived-context keys; no active long-term
  memory store, automatic memory reads/writes, or sibling-chat summaries

The persona/default-profile invariant is distinct from singleton agent settings.
Chat composition includes the persona captured when a message was accepted.
Resume preserves recorded instructions; regeneration captures the current selection.
Children inherit the recorded layer. Persona access is rechecked live, and persona
text grants no capabilities. Do not claim a persona memory engine is implemented.
Future project-derived memory must partition by user/profile/project; General-derived
memory partitions by user/profile/chat. Derived local summaries additionally key by
source chat and scope revision. Keys never grant access; reauthorize reads/writes.

Future memory writes and retrieval must be traceable to:

- User
- Profile
- Agent
- Conversation/session
- Timestamp and source

---

## 4) Domain and Data Design Principles

1. **Invariants enforced at service + DB layers**
   - At least one profile and exactly one default profile per user
   - Exactly one model-free main-agent configuration per user
   - Zero or more separately owned, fixed-model sub-agent definitions
2. **Capability scoping by allowlist**
   - Ordinary tools/skills/MCP require explicit assignment and admin authorization
   - Internal tools require server-derived live scope and model capability checks
   - Agent consumes injected execution scope, file reader, and RetrievalService;
     domain readers own project/chat membership queries
   - Prompt layers and untrusted file/retrieval text cannot expand capabilities
3. **Auditability first**
   - Log agent decisions, tool calls, MCP calls, memory writes
4. **Provider abstraction**
   - Model, vector, and storage providers are replaceable
5. **Secure by default**
   - Principle of least privilege for tool and MCP access

---

## 5) Delivery Methodology (Agile)

Work is organized into **Epics → User Stories → Tasks**.

## 5.1 Epic Management

- Epics live in `/docs/epics`
- Naming format:
  - `EPIC-<NUMBER>-<DESCRIPTION>.md`
- Each epic contains one or more user stories and their task breakdown.

## 5.2 Todo Tracking

- Root-level `todo.md` is the live execution checklist.
- When a new epic is created, copy all user stories and tasks into `todo.md` as checklist items.
- Archive completed epic/story/task history under `/docs/archive` before removing it from `todo.md`; keep the live checklist focused on active and pending work.

## 5.3 Story Execution Policy

- Work on **one and only one user story at a time**.
- When a story starts:
  - If repository is git-based, create a **feature branch** for the story.
- As work progresses:
  - Mark tasks in `todo.md` as in-progress/completed.

## 5.4 Definition of Done

A user story is done only when:

- All story tasks are completed
- Relevant tests pass
- Changes are documented as needed

After implementation appears complete:

1. Confirm completion status with the user
2. On user confirmation, merge feature branch into `main`

An epic is complete when all its user stories are complete.

When an epic completes:

- Inform the user
- Propose the next recommended epic/plan

---

## 6) Engineering Workflow Rules

1. Prefer incremental, testable changes.
2. Keep interfaces stable and documented.
3. Add/adjust tests with each meaningful behavior change.
4. Avoid hidden coupling between frontend and backend contracts.
5. Regenerate typed API clients after OpenAPI changes.
6. Keep storage behind interfaces; backend schema changes use fresh initialization,
   with no data migrations. See [development reset](docs/architecture/development-reset.md)
   for the explicit full reset of auth/backend data, source files, and vectors while
   retaining model bundles. Do not reset the working database as part of story
   verification; use disposable isolated storage.
7. Capture major architectural decisions in ADR-style notes when scope is non-trivial.
8. Keep functions and services focused on one responsibility. Separate query construction, pagination/execution, response enrichment, and lifecycle mutations; do not grow a general service function by adding flags or parameters for each new caller or domain.
9. Compose reusable, owner-scoped base selects in the owning domain's `queries.py`; callers add their domain-specific filters before pagination. Put only domain-neutral query mechanics (such as pagination) in `db/queries.py` or `common`; shared modules must not import domain models or embed domain policy. Preserve owner checks at service/execution boundaries, deterministic ordering, and database filtering before pagination. Prefer small functions over a generic query framework or inheritance hierarchy.

---

## 8) Quality Gates

Minimum expectations per story:

- Lint passes
- Type checks pass
- formatting (pnpm format)
- Unit/integration tests pass (or updated intentionally)
- API schema and generated clients synchronized
- No broken auth/permission paths

Expected CI status checks:

- `CI / Lint, Typecheck, Test` (job: `quality-gates`)
- `CI / Frontend E2E (Playwright)` (job: `frontend-e2e`)

---

## 9) Documentation Expectations

Keep documentation updated when behavior changes:

- `/docs/epics/*.md` for planning
- `/todo.md` for status
- Backend and frontend README sections for setup/runtime updates
- API docs/OpenAPI where contracts change

---

## 10) Non-Negotiable Invariants Summary

- Each user always has at least one profile and one default profile.
- Each user always has exactly one main-agent configuration; sub-agent definitions bind one fixed model.
- Ordinary capabilities require explicit assignment; internal tools require live server-derived context and admin policy.
- Story completion requires task completion + passing tests + user confirmation before merge.
- Only one user story is actively implemented at a time.
