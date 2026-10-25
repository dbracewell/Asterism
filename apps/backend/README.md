# Asterism Backend (FastAPI)

Requires Python 3.13+, uv, and SQLite 3.45+ for JSONB support.

## Configuration and development

Use only the shared repository-root `.env.example` / `.env`; app-local dotenv files
are rejected. See the root README for the strict portable syntax and initial database
setup. `PUBLIC_URL` controls the public auth identity. JWT issuer
and audience are derived from it. JWKS and webhook requests use loopback port 3000,
not the public hostname. API traffic uses loopback port 8000.

Storage defaults to `/storage`; set an absolute `STORAGE_ROOT` for local development.
`DB_URL` is an optional full SQLAlchemy URL override. `SYSTEM_KEY` must match the
frontend. No separate JWT or frontend URL environment variables are needed.

From the repository root:

```bash
pnpm --filter @asterism/backend sync
pnpm --filter @asterism/backend dev
```

Normally use `pnpm dev` to start both apps. The frontend proxies browser API requests
at `http://localhost:3000/api/py`. Schema: `/api/py/openapi.json`.

The root Dockerfile is the only supported container deployment. No standalone
backend image or per-app Docker configuration is maintained.

## LLM providers and discovery

The admin-only provider discovery endpoint supports canonical OpenAI and Generic
OpenAI-compatible providers. OpenAI always uses `https://api.openai.com/v1`;
Generic OpenAI requires a normalized HTTP(S) base URL. Discovery uses bounded
OpenAI SDK requests, blocks redirects, and returns nullable capability metadata
with field-level provenance. Compatible-provider metadata is best-effort and
unknown or conflicting values require manual administration. See
[LLM Providers and Model Capabilities](../../docs/architecture/llm-providers.md).

## File knowledge processing

An uploaded eligible `UserFile` receives a canonical, versioned
`FileKnowledgeArtifactModel` (the persisted knowledge artifact) and is processed independently of project/chat
references. The knowledge-processing policy — its schemas, its persistence, and
its transitions — is owned end to end by `domains/knowledge/`, in
`processing_schemas.py`, `policy.py`, and `processing.py`. The knowledge admin
surfaces are served by `domains/knowledge/router.py` at their existing
`/settings/app/...` URLs.

Each derived output of a source file — its text extraction, its embedding, and
its captioning — is a `FileKnowledgeExtractionModel` row with its own status,
provider, model, safe errors, and kind-specific payload. The API reports them
as an `extractions` map keyed by kind. The artifact row keeps the denormalized
`searchable` aggregate so retrieval stays a single-row read. Artifacts retain
`processing_profile_generation` for policy-revision reuse; the fingerprint lives
only in the processing configuration and drives policy-change detection.

The dependency between the two domains runs one way. The files domain uses the
knowledge domain's published artifact service (`knowledge/artifacts.py`) and
never reaches into the artifact model, the artifact queries, or the ingestion
runtime. The knowledge domain reads its sources through the narrow contract in
`knowledge/sources.py`, whose implementation the files domain provides
(`files/sources.py`) and the application installs at startup.
Retrieval first resolves the active
execution context to live project/chat file IDs, then supplies both that set and the
authenticated owner to LanceDB.

The File API exposes artifact and per-extraction status plus regeneration and
cancel-processing actions. Regeneration reprocesses the embedding and caption.
Captions are indexed after successful generation; there is no approval workflow.
The captioning extraction reports its own `started_at` and `completed_at` times.

The versioned `knowledge.processing` application setting is the canonical platform-wide policy;
typed processing and captioning endpoints both transition that one value and queue
replacement generations for the eligible library. Only a completed generation
becomes current, so a failed replacement does not replace a usable artifact. See
[Knowledge retrieval](../../docs/architecture/knowledge-retrieval.md) for lifecycle,
automatic embedding provisioning, provider disclosure, and operational details.

## Database initialization

On a fresh installation, from the repository root:

```bash
pnpm --filter @asterism/backend init:db
```

Initialization creates missing model tables, installs SQLite FTS5 search indexes
and triggers, and creates defaults. It can be run repeatedly on the current schema;
it does not upgrade older schemas. The container runs it on every startup before
launching the backend. To intentionally recreate the configured local SQLite database, run
`pnpm --filter @asterism/backend reset:db`, verify the displayed absolute target, and
type `RESET`. A noninteractive reset is canceled unless the internal confirmed command
is invoked through the root `pnpm reset:db -- --yes` workflow.

## Chat admission

Validated environment defaults are `MAX_ACTIVE_CHAT_JOBS=32`,
`MAX_ACTIVE_CHAT_JOBS_PER_USER=4`, `MAX_CHAT_CONTROLLERS=128` and
`MAX_CHAT_CONTROLLERS_PER_USER=16`. Work includes generation, title tasks and
approval waits. Admission rejects immediately with a retryable socket error;
controller saturation closes with 1013 before history/Agent allocation. Disconnect
releases only the controller while work continues. See
[ADR-0020](../../docs/adr/0020-chat-capacity-admission.md) for ranges, release
ownership and the separate knowledge/model gates.

## Current versus planned capabilities

The admin navigation marks **Groups, Users, Image Generation, Code Execution and
Export** as **Planned**. Their panes explain future scope and offer no configuration
actions. Providers, Theme Editor, Tools and Image Captioning remain available;
user settings expose General, Personas, Skills, and Agents.

| Capability           | Available now                                                                                                                | Planned                                                    |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| Providers and models | Admin provider/model configuration; per-chat model selection                                                                 | —                                                          |
| Agents and tools     | User main/sub-agent settings; admin tool policy and provider settings                                                        | —                                                          |
| Skills               | Private skills editor/preview and main-agent assignment UI; CRUD/policy APIs ([contract](../../docs/architecture/skills.md)) | Slash commands and runtime activation                      |
| Appearance           | User theme/font preferences; admin Theme Editor                                                                              | —                                                          |
| Image captioning     | Admin captioning policy and file-processing integration                                                                      | —                                                          |
| Users and access     | Admin/user access checks, owner scoping and backend user lifecycle                                                           | Users management screens and permission-policy controls    |
| Groups               | —                                                                                                                            | Group management and group policy settings                 |
| Image Generation     | Image search and captioning are separate existing capabilities                                                               | Image-generation providers, models and generation workflow |
| Code Execution       | —                                                                                                                            | Sandboxed execution and runtime settings                   |
| Export               | Individual file downloads                                                                                                    | Data/conversation export tools                             |
| Personas and memory  | Persona CRUD/defaults, chat selection and immutable execution inputs                                                         | Long-term memory engine                                    |

The Users badge describes unfinished administration screens, not missing access
control. Backend list/provision/delete routes already have authorization and
lifecycle checks. Navigation visibility does not grant access. Persona settings manage separate USER.md instructions and one default; chats can
follow that default or select a fixed persona. Accepted turns preserve their
instructions and provenance. Long-term memory remains future work. See the [product-surface inventory](../../docs/architecture/frontend-and-themes.md#current-versus-planned-product-surface) for ownership
and limits.

## Quality checks

Backend `typecheck` runs full basedpyright followed by compileall; root and CI
commands use this gate. Component metadata is class-level, and the chat job manager
keeps a narrow lifecycle protocol while controllers bind the concrete orchestrator.
Chat read/delete queries are owner-scoped and return the same 404 for foreign and
missing identities. Uvicorn transport diagnostics redact token query values.

From the repository root:

```bash
pnpm --filter @asterism/backend lint
pnpm --filter @asterism/backend typecheck
pnpm --filter @asterism/backend test
```

## Architecture documentation

The supported runtime is a single coordinated backend process with SQLite.
Package `dev:raw`/`start` and the container use `python -m asterism.serve`, which
passes `workers=1` explicitly and rejects `WEB_CONCURRENCY` or `UVICORN_WORKERS`
unless unset or exactly `1`. CLI `--workers`/`-w` accepts only one; reload and
other unlisted server options are unsupported. Check worker settings without
opening application storage with `uv run python -m asterism.serve --check` from
this directory. The container runs that check before secrets/migrations. Multiple
replicas, direct Uvicorn/Gunicorn launches and external process fan-out are
unsupported; this guard cannot detect processes on other machines.
See [ADR-0019](../../docs/adr/0019-single-process-runtime-and-storage-seams.md) for
process-local jobs, queues, guards and caches and the explicit composition roots.
Chat jobs and membership guards are process-local; PostgreSQL JSONB column types
do not supply a complete PostgreSQL initializer/search adapter. FileStore and
VectorStore are explicit seams, with FileStore still returning a local `Path`.
The [2026-10-17 review](../../docs/reviews/2026-10-17-codebase-review.md)
records these limits. US-34.1 keeps chat/project FTS matches in composable SQL
relations, applies owner/scope predicates before count/pagination, and batches one
chronological owned-message snippet per selected content-matched chat. The
[search design](../../docs/architecture/data-and-storage.md#search-indexes) and
[query-bound measurements](../../docs/reviews/us-34.1-verification-2026-10-24.md)
distinguish page-bounded application data and round trips from database scan work.
SQLite is the only implemented search dialect; shared `db/queries.py` stays
free of chat/project models and policy.

Comprehensive system design guides and Mermaid sequence diagrams are available in the [`/architecture`](../../docs/architecture/README.md) directory:

- [System Overview](../../docs/architecture/overview.md) — Topology, technology stack, and request lifecycle
- [Tool Authorization & Approval](../../docs/architecture/tool-authorization.md) — Pluggable approval policies, WebSocket human-in-the-loop, and sub-agent sandboxing
- [Agent Runtime & Execution Loop](../../docs/architecture/agent-runtime.md) — Multi-step loops, dynamic system prompts, and streaming deltas
- [Chat & Real-Time WebSocket](../../docs/architecture/chat-and-websocket.md) — Concurrency, `ChatController`, `ChatOrchestrator`, and message queues
- [Data Model & Storage](../../docs/architecture/data-and-storage.md) — High-concurrency SQLite WAL, JSONB columns, and the message tree
- [Knowledge Retrieval](../../docs/architecture/knowledge-retrieval.md) — LanceDB lifecycle, offline model provisioning, and multimodal embedding benchmark
- [Authentication & Security](../../docs/architecture/auth-and-security.md) — BetterAuth, JWKS RS256 token verification, and tenancy

## Current runtime and operator guides

- [Execution context and module boundaries](../../docs/architecture/execution-context.md)
- [Agent settings, model provenance, delegation, and prompts](../../docs/architecture/agent-runtime.md)
- [REST acceptance, drafts, branches, and WebSocket transport](../../docs/architecture/chat-and-websocket.md)
- [Project and chat UI](../../docs/architecture/project-workspaces.md)
- [Tool policy and approval](../../docs/architecture/tool-authorization.md)
- [Context provenance and memory limits](../../docs/architecture/context-isolation.md)
- [Clean initialization and reset with model-bundle retention](../../docs/architecture/development-reset.md)

## Implementation history

Dated story notes are preserved in the
[documentation history archive](../../docs/archive/us-28.2-documentation-history-2026-10-17.md).
Use the runtime and operator guides above for current contracts.

## Personas

User Settings → Personas manages up to 20 owned personas, each with a name and
USER.md instructions. Choose one default; chats can follow it for each new message
or keep an explicit selection. Save uses revision checks and retains drafts after
conflicts. Choose another default and switch explicitly selected chats before
deleting a persona. Accepted turns preserve their instructions; resume reuses them
and regeneration captures current settings. Delegates inherit the recorded persona
within their existing capability ceilings. No long-term memory engine is active.
See [binding and storage limits](../../docs/adr/0021-personas-and-execution-binding.md).

This schema requires fresh initialization. For an older development database, use
the explicit reset workflow when ready to discard its data; story tests use
disposable storage and do not reset the working database.

## Private skills API foundation

US-40.1 adds private `skills` documents and owner-consistent `agent_skills`
assignments. Admin `skills_enabled` policy defaults to false. Source validation,
revision-checked CRUD, main-agent assignment replacement, and eligible metadata
pages are implemented. The frontend now provides the Skills editor/preview and
assignment UI; runtime activation is not implemented yet.
See the [skills contract](../../docs/architecture/skills.md) for endpoints, bounds,
permissions, and fresh-schema behavior. Verification uses disposable storage.
