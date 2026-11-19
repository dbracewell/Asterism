# EPIC-88: A normal project README

Status: in progress (US-88.1 complete; US-88.2 awaiting confirmation). Proposed 2026-11-18. Source: user request (2026-11-18).

## Objective

Make the root `README.md` a conventional project README. Someone landing on the
repository should learn in a minute what Asterism is, see what it looks like, get
it running with Docker or for local development, and know where to go next.

Detail that serves operators or contributors moves to the documents written for
them. Nothing is deleted without a new home.

## Where things stand (verified 2026-11-18)

| Area             | Today                                                                                         | Gap                                                                                                    |
| ---------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Opening          | Two technical paragraphs on agents, provenance and FTS composition                            | No plain statement of what the project is for or who uses it; no screenshot                            |
| Status narration | Paragraphs on EPIC-31 to EPIC-35, US-33.x and US-34.3                                         | Project history, not README content                                                                    |
| Accuracy         | "Current versus planned" table marks Groups, Users, Image Generation and Export as Planned    | All four ship; only Code Execution is Planned. User settings list omits Templates, Rubrics and ChatGPT |
| Length           | About 470 lines: `.env` grammar, secrets, edge limits, sizing table, backup, usage, About you | Operator and contributor detail crowds out the quick start                                             |
| Destinations     | [`docs/deployment.md`](../deployment.md) exists (242 lines)                                   | No contributor/development guide to receive the local-development and quality-check detail             |

## Decisions

- **README sections:** title and one-sentence description, screenshot, what it
  does (a short feature list in plain words), quick start with Docker, local
  development, documentation map (user guide, deployment, development,
  architecture, ADRs), license.
- **Short quick starts.** The Docker path is the few commands from copying
  `.env` to opening the app. The local path is install, configure, migrate,
  `pnpm dev`. Each links to the full guide for everything else.
- **Content moves, not deletion.** Configuration catalog, strict `.env` syntax,
  edge protections, sizing, backup and upgrade go to `docs/deployment.md`. Local
  development, quality checks and E2E helpers go to a new `docs/development.md`.
  Usage, budgets and About you behavior already live in ADRs and EPIC-87 guides.
- **No status narration.** Epic progress stays in `todo.md` and `docs/archive`.

## Content map (US-88.1)

Where each section of the old README went:

| Old README section                                                     | New home                                                                                                                                    |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Opening paragraphs, single-process note                                | Rewritten README (US-88.2); [overview](../architecture/overview.md); [deployment §3](../deployment.md#3-start)                              |
| Architecture: review, roadmap and EPIC-31–35 status                    | Dropped: epic history is in `todo.md`, `docs/archive` and `docs/reviews`                                                                    |
| Architecture guide list, execution context, ADR-0017, memory isolation | [Architecture index](../architecture/README.md)                                                                                             |
| Chat admission limits                                                  | [Deployment §7](../deployment.md#7-sizing-and-limits); [chat and WebSocket](../architecture/chat-and-websocket.md#limits-and-failures)      |
| Current versus planned capabilities                                    | [Frontend: settings](../architecture/frontend.md#settings); the rewritten README links `todo.md` for planned work                           |
| Configuration                                                          | [Deployment: configuration reference](../deployment.md#configuration-reference); [development: set up](../development.md#set-up)            |
| Strict portable `.env` syntax                                          | [Deployment: .env file syntax](../deployment.md#env-file-syntax)                                                                            |
| `pnpm config:check`, precedence, file secrets                          | [Deployment: configuration reference](../deployment.md#configuration-reference); [development](../development.md#set-up)                    |
| Same-origin URLs and fixed internal ports                              | [Development: run](../development.md#run); [overview](../architecture/overview.md#how-the-pieces-connect)                                   |
| Schema versioning                                                      | [Deployment §6](../deployment.md#6-storage-backups-and-upgrades); [data and storage](../architecture/data-and-storage.md#schema-versioning) |
| Docker: Compose, `docker run`, port, rebuild-free origin change        | [Deployment §3](../deployment.md#3-start)                                                                                                   |
| Docker: file secrets, TLS proxy, trusted proxies                       | [Deployment: configuration reference](../deployment.md#configuration-reference); [§4](../deployment.md#4-tls-proxy)                         |
| Edge protections                                                       | [Deployment: security defaults](../deployment.md#security-defaults)                                                                         |
| Storage and lifecycle                                                  | [Deployment §6](../deployment.md#6-storage-backups-and-upgrades)                                                                            |
| Backup, restore and upgrades                                           | [Deployment §6](../deployment.md#6-storage-backups-and-upgrades); [backup and restore](../architecture/backup-and-restore.md)               |
| Health checks, Status, image size                                      | [Deployment §8](../deployment.md#8-monitoring) and §1; [operations](../architecture/operations.md)                                          |
| Playwright browsers note                                               | [Deployment §1](../deployment.md#1-prerequisites), as a known limitation, plus a follow-up in `todo.md`                                     |
| Deployment checks (container config, smoke test)                       | [Development: container checks](../development.md#container-checks)                                                                         |
| Sizing and capacity, admission settings, what "full" looks like        | [Deployment §7](../deployment.md#7-sizing-and-limits)                                                                                       |
| Local development                                                      | [Development](../development.md)                                                                                                            |
| First-time administrator setup                                         | [Deployment §5](../deployment.md#5-first-administrator-and-setup)                                                                           |
| Files, project context and captions                                    | [File knowledge processing](../architecture/file-knowledge-processing.md); user guide (EPIC-89)                                             |
| Quality checks                                                         | [Development: checks](../development.md#checks)                                                                                             |
| Usage and budgets                                                      | [Usage and budgets](../architecture/usage-and-budgets.md); [deployment §5](../deployment.md#5-first-administrator-and-setup)                |
| About you                                                              | [Execution context](../architecture/execution-context.md#about-you-on-a-turn); [ADR-0066](../adr/0066-about-you.md)                         |
| License                                                                | Stays in the README                                                                                                                         |

## Verification (US-88.2, 2026-11-18)

Both quick starts were run from fresh clones of `main` at `0f688075`, on macOS with
Docker Desktop (4 CPUs, 16 GB), with generated secrets and throwaway storage.

- **Docker.** `cp .env.example .env`, three generated secrets, then
  `docker compose up -d --build`: built in 150 s from cached layers and reported
  healthy; `/sign-in` answered 200. Deviations, to avoid clashing with a running
  instance: a separate Compose project, `PORT=3950` with a matching `PUBLIC_URL`, and
  `STORAGE_ROOT=/storage` (Compose doesn't pass `STORAGE_ROOT`, so this changes
  nothing).
- **Local development.** `pnpm install`, `pnpm --filter @asterism/backend sync`,
  `.env` with secrets and an absolute `STORAGE_ROOT`, `migrate:db`, `init:db` (all
  migrations to head) and `pnpm dev`: both `/api/py/health/ready` and `/api/health`
  answered 200 through port 3000 after 12 s, and `/sign-in` rendered.
- **Screenshot.** `docs/images/asterism-chat.png` was taken from the Docker
  instance: first-run setup, an OpenAI-compatible provider pointing at a scripted
  local model (`demo-tutor`), and one question in Tutor mode. The names and the
  conversation are invented. EPIC-89's screenshot pipeline will regenerate it.

## User stories

Suggested order: US-88.1 → 88.2.

### US-88.1: Give displaced content a home

As an operator or contributor, the detail I relied on in the README is still
easy to find.

- [x] Map every README section to its destination in a checklist in the PR
      description; nothing is dropped silently.
- [x] Create `docs/development.md`: prerequisites, setup, migrations, `pnpm dev`
      and focused commands, mprocs, quality checks, isolated E2E and CI helpers.
- [x] Merge configuration, `.env` grammar, file secrets, edge protections,
      sizing and admission settings, backup and upgrade into
      `docs/deployment.md` where they are not already there; remove duplicates.
- [x] Update links elsewhere in `docs/` that point at README anchors.

### US-88.2: Rewrite the README

As a visitor, I understand what Asterism is and can run it.

- [x] Rewrite `README.md` to the agreed sections; keep the CI badge.
- [x] Add one screenshot of the chat workspace (from the EPIC-89 screenshot
      pipeline once it exists; a manual capture from a disposable demo instance
      until then).
- [x] Feature list reflects shipped features only; link "planned" items to
      `todo.md` rather than listing them.
- [x] Verify both quick starts from a clean clone with disposable storage, and
      record the result in the PR.
- [x] `pnpm docs:check` (EPIC-87) and `pnpm format:check` pass.
