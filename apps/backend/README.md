# Asterism Backend (FastAPI)

Python/FastAPI backend for Asterism.

## Prerequisites

- Python 3.13+
- [uv](https://docs.astral.sh/uv/)
- pnpm (for monorepo scripts)

## Environment

Create `apps/backend/.env` from `apps/backend/.env.example`.

Required for local development:

- `STORAGE_ROOT` (directory where SQLite DB + files are stored)

## Install

From repository root:

```bash
pnpm install
```

Backend dependencies are managed with `uv` and resolved from `apps/backend/uv.lock`.

## Run (development)

From repository root:

```bash
pnpm --filter @asterism/backend dev
```

Or from `apps/backend`:

```bash
pnpm dev
```

Default URL: `http://localhost:8000`
OpenAPI: `http://localhost:8000/openapi.json`

## Database commands

From `apps/backend`:

```bash
pnpm db:migrate   # create migration
pnpm db:push      # apply migrations
pnpm db:dryrun    # generate SQL without applying
```

## Quality commands

From repository root:

```bash
pnpm turbo run lint --filter=@asterism/backend
pnpm turbo run typecheck --filter=@asterism/backend
pnpm turbo run test --filter=@asterism/backend
```
