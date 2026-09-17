# Asterism Frontend (Next.js 16)

Requires Node.js 22.13+ and pnpm 11+.

## Configuration and development

Use `apps/frontend/.env.example` / `apps/frontend/.env` and the root README's initialization
steps. `PUBLIC_URL` sets Better Auth's public base URL; `BETTER_AUTH_SECRET`,
`SYSTEM_KEY`, and `ADMIN_PASSPHRASE` are persistent secrets. Auth storage defaults
to `${STORAGE_ROOT:-/storage}/users.db`, with an optional `BETTER_AUTH_DB_PATH` override.

Browser API, WebSocket, and SSE requests always use the current origin. No
`NEXT_PUBLIC_*` URL settings are needed. Server-side API calls use loopback port 8000. Next.js rewrites `/api/py/*` to FastAPI for local development; nginx handles
that path in Docker. The rewrites preserve trailing slashes so FastAPI collection
routes do not redirect browsers to the internal backend origin and lose their
Authorization header. After changing this routing, restart Next.js and reload
with browser caching disabled to discard any previously cached 308 redirects.

From the repository root:

```bash
pnpm install
pnpm dev                              # both applications via pnpm
pnpm --filter @asterism/frontend dev  # frontend only
```

Next.js loads `apps/frontend/.env`; the backend loads `apps/backend/.env`.
Root `pnpm dev` currently starts both workspace scripts without adding another environment-loading layer.
Keep shared secrets and `PUBLIC_URL` consistent between the two app files.
Docker continues to use the root `.env`.
Exported environment variables take precedence. Restart existing dev servers
after changing environment settings; `reset:db` does not update the environment
of a running server.

Runtime auth and the official migration CLI use the same database path. Create
its parent directory before local migrations (Docker creates `STORAGE_ROOT`).
Reset is destructive; stop the app before running it.

Open `http://localhost:3000`. Next.js allows only one dev process per app directory.

## Docker and migrations

Only the repository-root Dockerfile and Compose configuration are supported.
Dependencies use the root workspace lockfile; the standalone frontend lockfile,
Dockerfile, and build-approval configuration have been removed.

The container runs the official `auth` CLI before Next.js, pinned to 1.6.11 to
match Better Auth. The image includes `src/lib/auth.ts` and passes it explicitly
with `--config`; startup requires no package downloads or custom migration script.
Migrations create missing tables without resetting users. Migration failure prevents
startup. Back up persistent storage before upgrades; do not use `reset:db` for
container startup. Update the CLI alongside Better Auth when upgrading.

Local migrations, from this directory:

```bash
node --env-file=.env node_modules/auth/dist/index.mjs migrate --config ./src/lib/auth.ts --yes
node --test scripts/test-docker-auth-migrations.mjs
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
pnpm --filter @asterism/frontend test:e2e
pnpm --filter @asterism/frontend codegen
```
