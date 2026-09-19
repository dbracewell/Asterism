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

## Database initialization

On a fresh installation, from the repository root:

```bash
pnpm --filter @asterism/backend init:db
```

Initialization creates missing schema, applies pending data-preserving Asterism
schema migrations, and creates defaults without deleting existing data. It is safe
to run repeatedly, and the container runs it on every startup before launching the
backend. To intentionally recreate the configured local SQLite database, run
`pnpm --filter @asterism/backend reset:db`, verify the displayed absolute target, and
type `RESET`. A noninteractive reset is canceled unless the internal confirmed command
is invoked through the root `pnpm reset:db -- --yes` workflow.

## Quality checks

From the repository root:

```bash
pnpm --filter @asterism/backend lint
pnpm --filter @asterism/backend typecheck
pnpm --filter @asterism/backend test
```

## Architecture documentation

Comprehensive system design guides and Mermaid sequence diagrams are available in the [`/architecture`](../../architecture/README.md) directory:

- [System Overview](../../architecture/overview.md) — Topology, technology stack, and request lifecycle
- [Tool Authorization & Approval](../../architecture/tool-authorization.md) — Pluggable approval policies, WebSocket human-in-the-loop, and sub-agent sandboxing
- [Agent Runtime & Execution Loop](../../architecture/agent-runtime.md) — Multi-step loops, dynamic system prompts, and streaming deltas
- [Chat & Real-Time WebSocket](../../architecture/chat-and-websocket.md) — Concurrency, `ChatController`, `ChatOrchestrator`, and message queues
- [Data Model & Storage](../../architecture/data-and-storage.md) — High-concurrency SQLite WAL, JSONB columns, and the message tree
- [Authentication & Security](../../architecture/auth-and-security.md) — BetterAuth, JWKS RS256 token verification, and tenancy
