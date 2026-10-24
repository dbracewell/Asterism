# ADR-0019: Single-process runtime and storage seams

- **Status:** Accepted implementation decision for US-34.2; story verification is recorded separately
- **Date:** 2026-10-24
- **Scope:** [EPIC-34](../epics/EPIC-34-QUERY-BOUNDS-AND-ARCHITECTURE-GUARDRAILS.md)

## Context

Asterism coordinates live executions within one backend event loop. SQLAlchemy,
FileStore and VectorStore provide useful boundaries, but they do not make the
current application distributed or portable to every database/storage backend.
Uvicorn's inherited worker settings previously allowed unsupported fan-out even
though the package/container commands did not explicitly request extra workers.

## Decisions

### One backend process for one application deployment

Supported package launches (`dev`, `dev:raw`, `start`), root mprocs development
and the combined-container entrypoint use `asterism.serve`. It calls Uvicorn with
`workers=1` explicitly. `WEB_CONCURRENCY` and `UVICORN_WORKERS` must be absent or
exactly `1`; empty, malformed and other values fail without printing their values.
CLI `--workers`/`-w` accepts only one. Unsupported options, including reload, are
rejected rather than forwarded to another process manager.

The container runs `asterism.serve --check` before loading secrets, validating
application configuration, migrating auth or initializing storage. The check
imports no application/configuration/database modules. Existing package host,
port, proxy trust and graceful-shutdown settings are preserved. Development
continues to request its two-second graceful timeout; production keeps Uvicorn's
unset timeout and the container's existing shutdown watchdog.

Multiple containers/replicas, manually starting additional backend processes,
and bypassing the supported launcher with Uvicorn/Gunicorn are unsupported.
Local validation cannot discover arbitrary external replicas or another machine.
It is configuration enforcement, not a distributed singleton lock.

### State remains process-local

- `chat/jobs.py` owns jobs, generation/title tasks, controller attachments and
  pending approvals. Idle membership-change guards consult that same manager.
  Database revisions remain useful, but cannot substitute for live job ownership.
- `common/job_queue.py` and `knowledge/runtime.py` own knowledge tasks and a
  concurrency semaphore. Artifact states support interrupted-work recovery on
  restart; there is no distributed queue, cross-process lease or shared scheduler.
- Model/embedding/caption/vector/browser semaphores, HTTP/browser client pools,
  event handlers, token/user caches and configured source/selection readers are
  process-local. Their limits and invalidations do not coordinate multiple workers.
- The frontend SSE bridge also uses local listeners and rate-limit state. This
  decision does not certify multiple frontend replicas.

US-34.4 adds finite active-chat/controller admission in
[ADR-0020](0020-chat-capacity-admission.md). Worker validation alone does not
implement admission limits, bound all queue admission,
make SQLite multi-writer coordination safe, or provide horizontal scaling.

### SQLite is the implemented relational/search adapter

Fresh initialization uses registered SQLAlchemy models plus SQLite-specific
pragmas, JSONB functions, FTS5 tables and triggers. The supported baseline is
SQLite 3.45+. US-34.1 keeps matching/scoping/counting/pagination in SQL and batches
selected-page snippets, but `chat/search_index.py` still has only a SQLite adapter.
PostgreSQL JSONB variants and partial-index declarations do not establish a working
PostgreSQL initializer, search implementation or end-to-end deployment. MySQL is
also unimplemented. Future support requires explicit adapters and full invariant,
authorization, search, initialization and lifecycle verification.

The numeric-only UUID/SQLite affinity edge case recorded during
[US-34.1](../reviews/us-34.1-verification-2026-10-24.md) is not resolved by this
ADR or certified by a portability claim. Schema changes use fresh initialization;
no migrations, compatibility paths or reset of working user data belong here.

### Files and vectors have explicit, currently local seams

`files/store.py` owns the `FileStore` protocol; its `open` contract returns a local
`Path`. File conversion, source readers and model input paths consume local bytes.
An object-store implementation cannot transparently return a URL instead: future
work must either define local materialization and cleanup ownership or change the
reader/store contract. No speculative object-store adapter is introduced.

`knowledge/vector_store.py` owns `VectorStore`, implemented by local LanceDB.
Owner/file filters and generation freshness checks must survive any future swap;
the interface alone does not implement a remote service or replica coordination.

### Preserve owning domains and injected runtime readers

The static guards scan Python source recursively, including deferred and relative
imports and `from package import child` forms. Prefixes match module boundaries,
so similarly named siblings are not accidentally forbidden.

- `common` stays a leaf; neutral `db` mechanics cannot import domains or import
  the central composition roots to obtain domain policy indirectly.
- `db.model_registry` may register the declared domain model modules.
  `db.init_db` may compose the chat search initializer, settings defaults and tool
  catalog. These named roots have declared import allowlists, not blanket waivers.
- `agent.agent` assembles execution using explicitly named chat schema, execution,
  scope, tool-policy, prompt and reader-factory symbols. It does not import chat
  tables/queries or the files/project tables. `agent.service` may call the named
  project-revocation function for definition deletion. Only those assembly and
  persistence modules acquire database sessions inside the agent package.
- The retrieval package consumes injected live scope, embedding/vector providers
  and limits. It cannot import the database, owning chat/project/file readers,
  global configuration or knowledge runtime/queries/artifact service. The shared
  `KnowledgeExtractionStatus` enum is allowed; artifact ORM imports are not.
- Owning readers remain in chat/project/files domains. `core.lifespan` composes
  `FileSourceReader` with knowledge runtime. Existing knowledge/settings/files
  guards retain EPIC-38's direction and now also scan nested packages.

These are deterministic import-statement checks, not detection of arbitrary
runtime/dynamic imports or proof of every architectural property. Adding a new
composition edge requires an explicit reviewed exception and a regression test.

## Verification and consequences

The [US-34.2 record](../reviews/us-34.2-verification-2026-10-24.md) separates the
frozen-install quality run, synthetic architecture violations, real isolated
browser startup and minimal Linux container worker checks. The latter uses the
actual launcher/entrypoint with the Uvicorn version from `uv.lock`, and stops
before application dependencies or data initialization. It complements, rather
than replaces, a full application image build and `docker/smoke-test.py`.
