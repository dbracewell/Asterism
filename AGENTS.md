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

- A custom `USER.md` persona/instruction file
- A dedicated profile memory namespace (short-term + long-term)

Users can create additional profiles, but the invariant above must always hold.

## 2.3 Agents

Each user must always have:

- **At least one agent**
- **Exactly one default agent**

An agent includes:

- A system prompt
- Allowed skills
- Allowed tools
- Allowed MCP servers
- Optional model/runtime preferences

Agents are scoped so capability access is explicit and auditable.

## 2.4 Skills / Tools / MCP / Image Generation

- **Admin** can add, update, enable/disable:
  - Skills
  - Tools
  - MCP servers
  - Image generation providers/config
- Agents only use capabilities explicitly assigned to them.

---

## 3) Technical Architecture

## 3.0 Monorepo and Build Orchestration

- Repository model: **Monorepo**
- Monorepo tooling: **Turborepo**
- Package manager: **pnpm workspaces**

Engineering implications:

- Use Turborepo pipelines for build/test/lint orchestration across apps/packages.
- Prefer shared config and reusable package boundaries over duplication.
- Keep task outputs/cache settings correct so local and CI runs are deterministic.

### Common monorepo commands

Run from repository root unless noted otherwise:

- `pnpm turbo run dev` — start all development targets
- `pnpm turbo run build` — build all configured targets
- `pnpm turbo run lint` — run lint checks across the monorepo
- `pnpm turbo run test` — run test targets across apps/packages
- `pnpm turbo run typecheck` — run type-checking targets

Common filtered runs:

- `pnpm turbo run dev --filter=frontend` — run dev for frontend only
- `pnpm turbo run dev --filter=backend` — run dev for backend only
- `pnpm turbo run test --filter=frontend` — run frontend tests only
- `pnpm turbo run test --filter=backend` — run backend tests only

Notes:

- Use `--filter=<workspace>` for focused iteration on a single app/package.
- Keep `turbo.json` pipelines in sync with workspace scripts so commands are reliable.

### Troubleshooting Turborepo cache and task issues

- `pnpm turbo run <task> --force` — bypass cache and force task execution.
- `pnpm turbo run <task> --no-cache` — run without reading/writing cache for debugging.
- Remove local cache when needed: `rm -rf .turbo`.
- If dependencies or lockfile changed unexpectedly, run `pnpm install` again at repo root.
- If a task is not found, verify:
  - Workspace `package.json` contains the script
  - `turbo.json` pipeline includes/depends on the task appropriately
  - The `--filter` target matches the actual workspace name

## 3.1 Backend

- Language/Framework: **Python + FastAPI**
- LLM/agent orchestration: **LangChain**
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
- AI integration: **Vercel AI SDK + AI components**
- API client generation: **Hey API** (type-safe client from backend OpenAPI)
- Auth: **BetterAuth with JWT**

Frontend must consume generated API clients, not hand-written fetch calls for core backend APIs.

## 3.3 Orchestration and Memory

The agent runtime should support:

- Single-turn and multi-turn chats
- Agentic loop execution with bounded iterations and stop criteria
- Tool/MCP invocation with structured logging
- Short-term memory (conversation/session scope)
- Long-term memory (profile scope with retrieval)

Memory writes and retrieval should be traceable to:

- User
- Profile
- Agent
- Conversation/session
- Timestamp and source

---

## 4) Domain and Data Design Principles

1. **Invariants enforced at service + DB layers**
   - At least one profile/agent per user
   - Exactly one default profile/agent per user
2. **Capability scoping by allowlist**
   - Agent can use only assigned tools/skills/MCP servers
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

- Epics live in `/epics`
- Naming format:
  - `EPIC-<NUMBER>-<DESCRIPTION>.md`
- Each epic contains one or more user stories and their task breakdown.

## 5.2 Todo Tracking

- Root-level `todo.md` is the live execution checklist.
- When a new epic is created, copy all user stories and tasks into `todo.md` as checklist items.
- Never delete previous epic/story/task history from `todo.md`; preserve progress visibility.

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
6. Keep migration paths explicit for relational/vector/file backends.
7. Capture major architectural decisions in ADR-style notes when scope is non-trivial.

---

## 7) Suggested Initial Epic Breakdown

1. **EPIC-1-FOUNDATIONS**
   - Monorepo setup hardening, CI, lint/test, shared standards
2. **EPIC-2-AUTH-AND-USER-MODEL**
   - BetterAuth + JWT, user records, RBAC skeleton
3. **EPIC-3-PROFILES-AND-AGENTS**
   - CRUD + default invariants for profiles/agents, USER.md support
4. **EPIC-4-CAPABILITY-REGISTRY**
   - Admin management for skills/tools/MCP/image providers
5. **EPIC-5-AGENT-RUNTIME-AND-LOOPS**
   - LangChain orchestration, loop controls, execution traces
6. **EPIC-6-MEMORY-SYSTEM**
   - Short-term + long-term memory, retrieval integration
7. **EPIC-7-CHAT-AND-UX**
   - Core chat experience, profile/agent switching, streaming responses
8. **EPIC-8-OBSERVABILITY-HARDENING**
   - Logging, analytics hooks, safety checks, performance

---

## 8) Quality Gates

Minimum expectations per story:

- Lint passes
- Type checks pass
- Unit/integration tests pass (or updated intentionally)
- API schema and generated clients synchronized
- No broken auth/permission paths

Expected CI status checks:

- `CI / Lint, Typecheck, Test` (job: `quality-gates`)
- `CI / Frontend E2E (Playwright)` (job: `frontend-e2e`)

---

## 9) Documentation Expectations

Keep documentation updated when behavior changes:

- `/epics/*.md` for planning
- `/todo.md` for status
- Backend and frontend README sections for setup/runtime updates
- API docs/OpenAPI where contracts change

---

## 10) Non-Negotiable Invariants Summary

- Each user always has at least one profile and one default profile.
- Each user always has at least one agent and one default agent.
- Agent capabilities are explicit and restricted by assignment.
- Story completion requires task completion + passing tests + user confirmation before merge.
- Only one user story is actively implemented at a time.
