# Asterism Frontend (Next.js 16)

Next.js frontend for Asterism.

## Prerequisites

- Node.js 20+
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

## Quality commands

From repository root:

```bash
pnpm turbo run lint --filter=frontend
pnpm turbo run typecheck --filter=frontend
pnpm turbo run test --filter=frontend
```

## API client generation

From `apps/frontend`:

```bash
pnpm codegen
```
