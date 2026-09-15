# Asterism Frontend (Next.js 16)

Next.js frontend for Asterism.

## Prerequisites

- Node.js 22.13+
- pnpm 11+

## Environment

Create `apps/frontend/.env` from `apps/frontend/.env.example`.

Required variables:

- `BETTER_AUTH_SECRET`
- `BETTER_AUTH_URL`
- `BETTER_AUTH_DB_PATH`
- `NEXT_PUBLIC_BACKEND_API_URL`

## Install

From repository root:

```bash
pnpm install
```

## Run (development)

From repository root:

```bash
pnpm --filter @asterism/frontend dev
```

Or from `apps/frontend`:

```bash
pnpm dev
```

Default URL: `http://localhost:3000`

> Note: Next.js allows only one `next dev` process per app directory.

## Build and start

From `apps/frontend`:

```bash
pnpm build
pnpm start
```

## Docker builds

The frontend Dockerfile uses `apps/frontend` as its build context and installs
from the standalone `pnpm-lock.yaml` with `--frozen-lockfile`.
`docker-pnpm-workspace.yaml` supplies pnpm 11 build-script approvals and pins
Kysely to 0.28.17: Better Auth 1.6.14 imports migration exports absent in 0.29.
When updating frontend dependencies, regenerate the standalone lockfile with
that configuration as `pnpm-workspace.yaml` in an isolated directory (outside
the root workspace). Review this pin when upgrading Better Auth.

### Container database initialization

The entrypoint runs `migrate-db.mjs` before starting Next.js, using the installed
Better Auth migration API and the shared `src/lib/auth-options.ts` configuration.
It creates missing tables and applies pending migrations on every startup without
resetting users, including when the SQLite file already exists but is empty.
Migration failures prevent the server from starting.

`BETTER_AUTH_DB_PATH` selects the database; in Docker it defaults to
`${STORAGE_ROOT:-/storage}/users.db`. Keep that path on a persistent volume and
back up the database before upgrades. Do not use `reset:db` for container startup:
that command intentionally deletes data.

Regression checks against a built image:

```bash
# From repository root
 docker run --rm --entrypoint node \
  -v "$PWD/apps/frontend/scripts/test-db-migrations.mjs:/app/scripts/test-db-migrations.mjs:ro" \
  asterism-frontend-build-check --test scripts/test-db-migrations.mjs
```

## Quality commands

From repository root:

```bash
pnpm turbo run lint --filter=@asterism/frontend
pnpm turbo run typecheck --filter=@asterism/frontend
pnpm turbo run test --filter=@asterism/frontend
```

## Test commands

From `apps/frontend`:

```bash
pnpm test:unit   # Vitest + React Testing Library
pnpm test:e2e    # Playwright
```

## API client generation

From `apps/frontend`:

```bash
pnpm codegen
```
