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

## Files and knowledge bases

**Files** is the user-facing source of truth for upload processing and image
captions. Eligible uploads are processed in the background; the screen displays
the current artifact status and lets a user retry failed work or edit, clear, or
regenerate a canonical image caption. Caption regeneration warns that a selected
external provider may receive the image.

**Knowledge** manages ordered collections of existing library files. Adding a
file only creates a membership, so processing and captions are shared across all
collections that contain it. Removing a membership leaves the file intact;
deleting the file from Files removes its memberships and derived knowledge.
Agent-profile knowledge-base assignments enable the scoped `search_knowledge`
tool. The generated client is the source for these REST contracts.

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
