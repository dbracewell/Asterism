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

## Database initialization and migrations

From the repository root, on a fresh installation and after every pull that
changes the schema:

```bash
pnpm --filter @asterism/backend init:db
```

`init:db` applies pending migrations (`upgrade head`) in one SQLite transaction,
then seeds defaults; fresh and existing databases take the same path and data is
kept. The container runs it on every startup. The API server checks the revision
before serving and refuses to start unless the database is at this code's head.
Both refuse, without changing anything, a database whose revision the code does
not know (newer, or from another branch) and one created before migrations were
adopted; the error names both revisions. Migrations are forward-only
([ADR-0069](../../docs/adr/0069-versioned-schema-migrations.md)).

### Changing the schema

Every model, trigger or FTS change ships with a migration in
`asterism/db/migrations/versions/`. Generate one against a database at head
(a disposable one is fine), then review it:

```bash
cd apps/backend
DB_URL=sqlite+aiosqlite:////absolute/path/scratch.db uv run alembic revision --autogenerate -m "add widgets"
```

- Autogenerate covers tables, columns, indexes and constraints. It does not see
  expression indexes, triggers, FTS5 tables or seed rows; write those as
  `op.create_index(..., [sa.text(...)])` or `op.execute(...)` with frozen SQL.
- Constraint changes on SQLite rebuild the table (`op.batch_alter_table`); say in
  the migration docstring what it rebuilds. Foreign keys are off while migrations run.
- Never import application models or column types in a migration; the generator
  renders JSON and encrypted columns as plain `sa.JSON()` / `sa.Text()`.
- There is no `downgrade()`.

`tests/test_migrations.py` is the CI check: a database built by the migrations
must match `create_all` plus the current FTS definitions
(`domains/chat/search_index.py`) object for object, and Alembic's autogenerate
diff against the models must be empty. A model change without a migration fails it.

### Migration tests

A migration that changes stored data gets a test that seeds the previous revision
and upgrades, using `tests/migration_harness.py`:

```python
async def test_widget_backfill(migration_db):
    await upgrade_to(migration_db, "<previous revision>")
    with sqlite3.connect(migration_db) as db:  # seed rows in the old shape, plain SQL
        db.execute("INSERT INTO ...")
    await upgrade_to(migration_db, "head")
    with sqlite3.connect(migration_db) as db:  # assert the new shape
        ...
```

Seed with SQL, not models: models describe head, not the previous revision.
`test_data_seeded_at_previous_revision_survives_upgrade` is the template.

### Development reset

To discard a disposable local database, run `pnpm reset:db` from the repository
root (or `pnpm --filter @asterism/backend reset:db` for the backend only), verify
the displayed absolute targets, and type `RESET`. A noninteractive reset is
canceled unless the internal confirmed command is invoked through the root
`pnpm reset:db -- --yes` workflow. Reset is never part of an upgrade; see
[initialization and reset](../../docs/architecture/development-reset.md).

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
user settings expose General, Your Asterism, Skills, and Agents.

| Capability           | Available now                                                                                                                                            | Planned                                                 |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| Providers and models | Admin provider/model configuration; per-chat model selection                                                                                             | —                                                       |
| Agents and tools     | User main/sub-agent settings; admin tool policy and provider settings                                                                                    | —                                                       |
| Skills               | Private skills editor/assignments, admin policy, slash discovery, branch-local activation and provenance ([contract](../../docs/architecture/skills.md)) | Automatic skill selection                               |
| Appearance           | User theme/font preferences; admin Theme Editor                                                                                                          | —                                                       |
| Image captioning     | Admin captioning policy and file-processing integration                                                                                                  | —                                                       |
| Users and access     | Admin/user access checks, owner scoping and backend user lifecycle                                                                                       | Users management screens and permission-policy controls |
| Groups               | —                                                                                                                                                        | Group management and group policy settings              |
| Image Generation     | Policy, `generate_image`, Create image, the local diffusers and ComfyUI generators ([ADR-0064](../../docs/adr/0064-image-generation.md))                 | Admin page and chat UI (EPIC-76)                        |
| Code Execution       | —                                                                                                                                                        | Sandboxed execution and runtime settings                |
| Export               | Individual file downloads                                                                                                                                | Data/conversation export tools                          |
| About you and memory | About you text in Your Asterism, pinned on each accepted turn                                                                                            | Long-term memory engine                                 |

The Users badge describes unfinished administration screens, not missing access
control. Backend list/provision/delete routes already have authorization and
lifecycle checks. Navigation visibility does not grant access. Your Asterism holds one About you
text per user; each accepted turn pins the text and revision it was sent with. Long-term memory remains future work. See the [product-surface inventory](../../docs/architecture/frontend-and-themes.md#current-versus-planned-product-surface) for ownership
and limits.

## Local image generation

The local generator (US-76.2) runs Hugging Face `diffusers` pipelines in a
separate worker process started by the backend. It picks a device at startup:
CUDA if available, then Apple MPS, then CPU. An administrator can override it.

- **Catalog and recommendation.** `GET /settings/app/image-generation/local`
  reports the hardware, each pinned catalog model's fit (fully on the device,
  with CPU offload, or not at all) and the recommended model. Memory figures
  are estimates at each model's native resolution. The catalog runs from
  Qwen-Image-2.1 (about 20 GB of GPU memory with offload) down to DreamShaper
  8 LCM (3 GB GPUs, 8 GB Macs, CPU).
- **Precision** follows the OS, processor and model: bf16 where the device has
  fast native support (NVIDIA Ampere+, Apple M2+ GPUs on macOS 14, Intel and
  AMD CPUs with AVX-512 BF16 or AMX, Graviton 3+), otherwise fp16 on a GPU for
  Stable Diffusion models and float32 for the rest and for CPUs, including
  every Mac CPU. float32 doubles the memory a model needs.
- **Downloads** go to `STORAGE_ROOT/models/image-generation/<model>` at a
  pinned revision and are verified by manifest (4–33 GB per model).
  Non-commercial licenses (Qwen-Image-2.1) must be accepted before download.
- **Apple Silicon (local development):** MPS works with the default torch
  build. About 70% of unified memory is assumed usable by the GPU.
- **NVIDIA in Docker:** the image runs on CPU by default. For CUDA, run the
  container with the NVIDIA container runtime (`--gpus all`) and a CUDA build
  of torch; check the admin page's hardware report shows `cuda`.
- **CPU** works for every model that fits in memory. The recommendation is
  the smallest: DreamShaper 8 LCM takes about 13 s per 512² image on an M5 Max
  CPU; large models take minutes.

The worker loads the model on the first image and unloads after 10 idle
minutes. Out-of-memory errors and crashes are reported to the user and the
next request starts a fresh worker.

## ComfyUI image generation

The ComfyUI generator (US-76.3) sends jobs to an existing ComfyUI server. It is
an `ImageGenerator` component: select and configure it through the
`image_generator_provider` application setting (`{"name": "ComfyUI",
"parameters": {...}}`), like the search providers. Parameters: the address,
optional bearer or basic sign-in (for a server behind a proxy; ComfyUI itself
has none), and either a checkpoint for the built-in workflow or a custom
workflow exported with **Save (API)** using `{{prompt}}`, `{{seed}}`,
`{{width}}` and the other placeholders. Saving validates them and returns the
reason when they're wrong. `POST /components/ImageGenerator/ComfyUI/test`
checks unsaved parameters and suggests the server's checkpoints. Step progress
uses ComfyUI's WebSocket when the proxy allows it.

Administrators set all of this up in Admin Settings → Image Generation.
`POST /settings/app/image-generation/test` generates one image with the saved
generator into the administrator's files, even while the policy is off.

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
- [Backup and restore (`python -m asterism.backup`)](../../docs/architecture/backup-and-restore.md)

## Implementation history

Dated story notes are preserved in the
[documentation history archive](../../docs/archive/us-28.2-documentation-history-2026-10-17.md).
Use the runtime and operator guides above for current contracts.

## About you

User Settings → Your Asterism holds one **About you** text per user: facts about
who they are and what they know, used when Asterism answers. It starts empty, is
limited to 16,000 characters, and saves with a revision check that keeps the draft
after a conflict. Each accepted turn pins the text and revision; resume reuses
them and regeneration uses the current text. A blank text adds nothing to the
prompt. Delegates inherit the recorded text within their existing capability
ceilings. About you grants no tools or files, and no long-term memory engine is
active. See [ADR-0066](../../docs/adr/0066-about-you.md).

Schema changes ship as versioned migrations; `init:db` upgrades an existing
database in place. Story tests use disposable storage and do not touch the working
database.

## Private skills API foundation

US-40.1 adds private `skills` documents and owner-consistent `agent_skills`
assignments. Admin `skills_enabled` policy defaults to false. Source validation,
revision-checked CRUD, main-agent assignment replacement, and eligible metadata
pages are implemented. The frontend now provides the Skills editor/preview and
assignment UI. Chat acceptance now pins authorized skill snapshots per branch;
execution/replay rechecks live eligibility. The chat composer supports explicit
slash selection, persistent active chips, removal and refresh controls.
See the [skills contract](../../docs/architecture/skills.md) for endpoints, bounds,
permissions, and fresh-schema behavior. Verification uses disposable storage.

## Side-by-side comparison

US-54.4 runs a prompt on two or three models as sibling chat branches (`compare`
on chat sends, `POST /chat/{chat_id}/message/{id}/compare` for an answered turn,
and `GET`/`PUT /chat/{chat_id}/comparisons/{id}`). Columns run one after another
within the chat's single work slot. See the
[chat contract](../../docs/architecture/chat-and-websocket.md#side-by-side-comparison-us-544)
and [ADR-0027](../../docs/adr/0027-side-by-side-comparison-branches.md).

## Prompt templates API

US-51.1 adds owner-scoped `prompt_templates` documents (a typed field schema plus
a `{{key}}` placeholder body) under `/prompt-templates/`, with revision-checked
CRUD, and a bundled read-only framework catalog (RTF, CO-STAR, CRAFT, few-shot,
step-by-step) at `/prompt-templates/frameworks`. US-51.5 adds conditional
`{{#key}}…{{/key}}` sections, guided-level field examples and a freeform
checklist to the document, and makes the scaffolding `level` a required part of
send-time template provenance. US-51.6 adds the opt-in, ephemeral prompt coach
(`/prompt-templates/coach` and `/prompt-templates/coach/review`), which runs on
the chat-title model. Template text grants no capabilities. See the [prompt templates contract](../../docs/architecture/prompt-templates.md)
and [ADR-0026](../../docs/adr/0026-prompt-template-documents-and-framework-catalog.md).

## Study API

US-53.1 adds the `study` domain: user-owned flashcard decks and cards under
`/projects/{project_id}/study/decks`. Cards carry optional citations to project
files, checked against the live project scope on write and marked available or
unavailable on read. Deleting a project deletes its decks. US-53.2 adds bounded, unsaved card
drafts at `…/decks/{deck_id}/card-drafts`, read through the retrieval domain's
`SourceReader` and cited to chunks ([ADR-0034](../../docs/adr/0034-bounded-flashcard-draft-generation.md)).
US-53.3 adds FSRS-6 scheduling, review logs, due counts and the review queue and
rating routes. US-53.4 adds practice quizzes under `…/study/quizzes`, with exact
multiple-choice grading, model-graded short answers and saved attempts
([ADR-0035](../../docs/adr/0035-practice-quizzes-and-grading.md)). US-53.5 derives
weak spots from attempts and review logs and builds practice quizzes from
them ([ADR-0036](../../docs/adr/0036-weak-spots-and-practice.md)); topics, weak
spots and pending unclear items are read together at `…/study/progress` and
practised at `…/study/practice`
([ADR-0067](../../docs/adr/0067-progress-panel.md)). US-53.6 adds cited
summary drafts, study-guide drafts and saved study notes
([ADR-0037](../../docs/adr/0037-study-notes-summaries-and-guides.md)). See the [study tools
contract](../../docs/architecture/study-tools.md) and
[ADR-0033](../../docs/adr/0033-study-domain-and-scheduling.md).

## Learning-mode evaluation

`asterism/domains/learning/evals/*.json` holds fixture cases that check whether
a model follows a learning mode at each hint level (for example, no leaked
answer before the learner asks for it). A case can also set `feedback`:
`structured` requires the mode's feedback headings in order with one or two
follow-up questions, and `free_form` forbids them. Review fixtures cover
pasted and attached attempts (attachments written as the runtime inlines them),
instructions embedded in an attachment, and the revealed corrected solution. The fixtures are validated in CI, but
the live run is informational and never gates CI. Run it against any
OpenAI-compatible endpoint from `apps/backend`:

```sh
node ../../scripts/run-with-env.mjs --env none --scope backend --profile test -- \
  uv run python scripts/evaluate_learning_modes.py \
  --base-url http://localhost:11434/v1 --model llama3.1 [--api-key-env OPENAI_API_KEY]
```

See [ADR-0029](../../docs/adr/0029-branch-local-hint-levels.md).
