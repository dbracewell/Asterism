# Asterism Frontend (Next.js 16)

Requires Node.js 22.13+ and pnpm 11+.

## Configuration and development

Use only the repository-root `.env.example` / `.env`; app-local dotenv files are
rejected. The root README documents the required strict portable syntax and
initialization steps. `PUBLIC_URL` sets Better Auth's public base URL;
`BETTER_AUTH_SECRET`, `SYSTEM_KEY`, and `ADMIN_PASSPHRASE` are persistent secrets.
Auth storage defaults to `${STORAGE_ROOT:-/storage}/users.db`, with an optional
`BETTER_AUTH_DB_PATH` override.

Browser API, WebSocket, and SSE requests always use the current origin. No
`NEXT_PUBLIC_*` URL settings are needed. Server-side API calls use loopback port 8000. Next.js rewrites `/api/py/*` to FastAPI for local development; nginx handles
that path in Docker. The rewrites preserve trailing slashes so FastAPI collection
routes do not redirect browsers to the internal backend origin and lose their
Authorization header. After changing this routing, restart Next.js and reload
with browser caching disabled to discard any previously cached 308 redirects.

From the repository root:

```bash
pnpm install
pnpm dev                              # both applications in mprocs
pnpm --filter @asterism/frontend dev  # frontend only
```

Both commands use the root launcher. Explicitly exported variables take precedence
over the root file. Restart the root launcher after changing `.env`; restarting only
an mprocs pane retains its inherited environment. Docker Compose also consumes the
root file.

Runtime auth and the official migration CLI use the same database path. Create
its parent directory before local migrations (Docker creates `STORAGE_ROOT`). To
intentionally recreate auth storage, stop the app, run
`pnpm --filter @asterism/frontend reset:db`, inspect the absolute target, and type
`RESET`. Noninteractive cancellation never deletes the selected database.

Open `http://localhost:3000`. Next.js allows only one dev process per app directory.

## LLM provider administration

Administrators configure providers under **Settings → Admin Settings → Providers**.
Choose **OpenAI** for the fixed canonical API URL, or **Generic OpenAI** for an
administrator-supplied compatible HTTP(S) URL. Model discovery is performed by
the authenticated backend API, not directly by the browser. Context-window and
tri-state vision values show their catalog/provider/manual/unknown provenance;
unknown Generic OpenAI metadata can be completed manually and manual values are
preserved on refresh. See
[LLM Providers and Model Capabilities](../../docs/architecture/llm-providers.md).

## Files and project context

**Files** manages uploaded sources, processing status, and canonical image captions.
Users can retry failed work or edit, clear, and regenerate captions. Regeneration
discloses when an external provider may receive the image. Administrators select
captioning through the single versioned `knowledge.processing` policy; policy
changes queue replacements while existing ready generations remain searchable.

Projects and library pickers compose the shared FileManager. Adding a library file
to a project creates a reference; removing the reference preserves its source and
artifacts. Chat attachment scope follows the active branch and current project.
Runtime policy derives `search_knowledge` availability from that live context.
All server data uses generated clients and TanStack Query. Query errors expose
Retry; cached files stay visible on refresh failure, and failures never appear as
empty results. Processing actions report errors and support retry.

## Docker and migrations

Only the repository-root Dockerfile and Compose configuration are supported.
Dependencies use the root workspace lockfile; the standalone frontend lockfile,
Dockerfile, and build-approval configuration have been removed.

The container runs the official `auth` CLI before Next.js, pinned to 1.6.11 to
match Better Auth. The image includes `src/lib/auth-cli.ts` and passes it explicitly
with `--config`; startup requires no package downloads or custom migration script.
Migrations create missing tables without resetting users. Migration failure prevents
startup. Back up persistent storage before upgrades; do not use `reset:db` for
container startup. Update the CLI alongside Better Auth when upgrading.

Local migrations, from the repository root:

```bash
pnpm --filter @asterism/frontend migrate:db
pnpm --filter @asterism/frontend exec node --test scripts/test-docker-auth-migrations.mjs
```

Local proxy regression check (stop local dev servers first; uses ports 8000 and
30999 with an in-memory test database):

```bash
node scripts/test-dev-proxy.mjs
```

The combined deployment smoke test is documented in the root README.

## Quality and API generation

From the repository root:

```bash
pnpm --filter @asterism/frontend lint
pnpm --filter @asterism/frontend typecheck
pnpm --filter @asterism/frontend test
node scripts/run-isolated-e2e.mjs       # isolated E2E fixture, from repo root
pnpm --filter @asterism/frontend codegen
```

The correct architecture links are under [`docs/architecture`](../../docs/architecture/README.md).

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
