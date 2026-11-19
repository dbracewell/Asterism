# Asterism architecture guides

These guides explain how Asterism is built: what each part of the system does,
the rules it keeps, and where its code lives. They are written for contributors,
starting with someone who has just joined the project.

Asterism is a self-hosted AI chat application for groups such as a school. A
Next.js frontend and a single FastAPI backend process run together in one
container on one host, with SQLite for data, LanceDB for search vectors and the
local disk for files.
The guides below take that system apart one piece at a time.

If you want to use Asterism rather than change it, read the user guide in
`docs/guide/` instead. To install and run an instance, read the
[deployment guide](../deployment.md).

## Where to start

Read these five guides in order. Together they cover the path of one chat
message, from the browser to the model and back, and the rules that path obeys.

1. [System overview](overview.md): the components, how they connect, and the
   life of a request.
2. [Authentication and security](auth-and-security.md): who a request is from
   and what they may do.
3. [Chat and WebSocket](chat-and-websocket.md): how a message is accepted,
   streamed, cancelled and resumed.
4. [Execution context](execution-context.md): how one turn gathers its
   instructions, files and helpers, and why none of them can widen its access.
5. [Agent runtime](agent-runtime.md): the bounded loop that calls the model and
   its tools, including delegation to sub-agents.

After that, read whichever guide covers the part you are changing.

## Find a guide

| If you want to know…                                                                            | Read                                                         |
| ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| How the pieces fit together and how a request flows                                             | [System overview](overview.md)                               |
| How sign-in, tokens and per-user data isolation work                                            | [Authentication and security](auth-and-security.md)          |
| How messages are accepted, streamed, cancelled and compared                                     | [Chat and WebSocket](chat-and-websocket.md)                  |
| How many people one instance serves, and how that was measured                                  | [Capacity check](capacity.md)                                |
| How logs, readiness checks, the Status page and settings export work                            | [Operations](operations.md)                                  |
| What a turn's prompt is made of and which files it may read                                     | [Execution context](execution-context.md)                    |
| How learning modes, hint levels and mode restrictions work                                      | [Learning modes](learning-modes.md)                          |
| How the agent loop, delegation, traces and compaction work                                      | [Agent runtime](agent-runtime.md)                            |
| Which tools an agent is offered and how approval works                                          | [Tool authorization](tool-authorization.md)                  |
| What is recorded about each run and what stays private                                          | [Context provenance and isolation](context-isolation.md)     |
| How skills are stored, assigned and activated                                                   | [Skills](skills.md)                                          |
| How prompt templates, the prompt coach and rubrics work                                         | [Prompt templates](prompt-templates.md)                      |
| How model providers and model capabilities are configured                                       | [LLM providers](llm-providers.md)                            |
| Where data lives: tables, search indexes, files, migrations                                     | [Data and storage](data-and-storage.md)                      |
| What happens to an upload, from bytes to searchable text                                        | [File knowledge processing](file-knowledge-processing.md)    |
| How file search stays inside a chat's allowed files, and how captions work                      | [Knowledge retrieval](knowledge-retrieval.md)                |
| How backups, restores and upgrades work                                                         | [Backup and restore](backup-and-restore.md)                  |
| How usage is counted and how group budgets refuse work                                          | [Usage and budgets](usage-and-budgets.md)                    |
| How to initialize or reset a development database                                               | [Development initialization and reset](development-reset.md) |
| How projects, project files and project sub-agents work                                         | [Project workspaces](project-workspaces.md)                  |
| How flashcards, quizzes, notes and progress work                                                | [Study tools](study-tools.md)                                |
| How educators run classes, publish courses and see class insights                               | [Classes and courses](classes-and-courses.md)                |
| How the canvas stores, versions and sandboxes documents                                         | [Canvas](canvas.md)                                          |
| How image generation works, from request to saved image                                         | [Image generation](image-generation.md)                      |
| How a setup is shared as a team pack, and what a pack can't do                                  | [Team packs](team-packs.md)                                  |
| How the frontend is built: routes, data loading, layout, the chat transcript, settings and help | [Frontend](frontend.md)                                      |
| How themes, color roles, shape and type tokens work                                             | [Themes](themes.md)                                          |
| What Markdown, links, math and file content may do                                              | [Markdown and file-content trust](markdown-content.md)       |
| Where custom themes are stored and how they are saved                                           | [Theme storage](theme-storage.md)                            |
| Where the bundled palettes come from and how contrast was checked                               | [Bundled theme palettes](bundled-theme-palettes.md)          |

The
[2026-11-18 audit](../reviews/2026-11-18-architecture-docs-audit.md) lists the
known gaps and errors in the existing guides, and
[EPIC-87](../epics/EPIC-87-ARCHITECTURE-DOCS-REFRESH.md) fixes them.

## The main boundaries

A few rules hold across the whole system. Each guide explains how its part keeps
them.

- **The browser talks only to its own origin.** All backend traffic, HTTP and
  WebSocket alike, goes through `/api/py` on the public origin. In development
  Next.js forwards it to FastAPI; in the container nginx does.
- **Better Auth owns identity.** It issues sessions and signed tokens. FastAPI
  checks each token against Better Auth's public keys and never trusts an
  identity sent by the browser.
- **Nothing written can grant a capability.** An agent's tools come from what the
  user assigned, what the admin allows, what the model supports and what the
  chat's context provides. Prompts, files, skills, About you text and approval
  clicks cannot add to that set.
- **A turn's file access is fixed when it starts and rechecked when it is used.**
  Each run records the files it may read. Every read checks again that access
  still holds, so removing a file takes effect immediately.
- **Storage sits behind interfaces.** The relational database, the vector store
  and the file store each have an adapter, so they can be replaced later.
- **One process.** The supported deployment runs a single backend process, which
  holds chat jobs and queues in memory
  ([ADR-0019](../adr/0019-single-process-runtime-and-storage-seams.md)).

## Where the code starts

- Backend application: [`asterism.main:app`](../../apps/backend/asterism/main.py),
  with startup and shutdown in [`core/lifespan.py`](../../apps/backend/asterism/core/lifespan.py).
- Backend domains: [`apps/backend/asterism/domains/`](../../apps/backend/asterism/domains/),
  one package per area (chat, agent, files, knowledge, projects and so on).
- Chat jobs and transport: [`ChatJobManager`](../../apps/backend/asterism/domains/chat/jobs.py)
  and [`ChatController`](../../apps/backend/asterism/domains/chat/controller.py).
- Agent loop: [`Agent`](../../apps/backend/asterism/domains/agent/agent.py).
- Tool registry: [`registry.py`](../../apps/backend/asterism/domains/tools/registry.py).
- Knowledge runtime: [`runtime.py`](../../apps/backend/asterism/domains/knowledge/runtime.py).
- Frontend routes: [`apps/frontend/src/app/`](../../apps/frontend/src/app/), with
  features under [`src/features/`](../../apps/frontend/src/features/).
- Frontend chat connection: [`useChatWebSocket`](../../apps/frontend/src/features/chat/hooks/use-chat-websocket.tsx).

## Decisions and history

- [Architecture decision records](../adr/) explain why the system is built the way
  it is. Guides link to the ADR behind each rule.
- [ADR-0017](../adr/0017-project-file-and-chat-boundaries.md) collects the current
  contracts between projects, files, chats and executions.
- [ADR-0016](../adr/adr-0016-memory-resource-contracts.md) lists the state the
  backend keeps in memory and how it is bounded.
- Epics, the [checklist archive](../archive/) and [reviews](../reviews/) record how
  the system got here.

## Writing a guide

[CONTRIBUTING.md](CONTRIBUTING.md) describes the layout every guide follows and
how to write and check one. Shared terms are in [terminology](../terminology.md).
