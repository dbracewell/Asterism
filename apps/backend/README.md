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
pnpm --filter @asterism/backend reset:db
```

**Warning:** this command resets an existing backend database. It is not an upgrade
migration. The container calls it only when the default database file is absent.

## Quality checks

From the repository root:

```bash
pnpm --filter @asterism/backend lint
pnpm --filter @asterism/backend typecheck
pnpm --filter @asterism/backend test
```
