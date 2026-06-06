# Asterism

[![CI](https://github.com/dbracewell/Asterism/actions/workflows/ci.yml/badge.svg)](https://github.com/dbracewell/Asterism/actions/workflows/ci.yml)
[![CI (main)](https://github.com/dbracewell/Asterism/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/dbracewell/Asterism/actions/workflows/ci.yml?query=branch%3Amain)

Asterism is a full-stack, multi-agent AI app (inspired by Open WebUI) where agents, tools, skills, MCP servers, image generation, and memory work together to fulfill user requests.

## Clone the repo

```bash
git clone git@github.com:dbracewell/Asterism.git
cd Asterism
```

## Run locally

### Prerequisites

- Node.js 22.13+
- pnpm 11+
- Python 3.13+
- [uv](https://docs.astral.sh/uv/)

### 1) Install dependencies

```bash
pnpm install
```

### 2) Configure environment files

```bash
cp apps/backend/.env.example apps/backend/.env
cp apps/frontend/.env.example apps/frontend/.env
```

Update values in both `.env` files as needed for your machine.

For first-time admin setup, set `BOOTSTRAP_SETUP_TOKEN` in `apps/backend/.env`.
Example:

```bash
BOOTSTRAP_SETUP_TOKEN=<a-strong-random-secret>
```

If deploying with Docker, pass `BOOTSTRAP_SETUP_TOKEN` as an environment variable
or Docker secret for the backend container.

### 3) Start backend and frontend

In terminal 1:

```bash
pnpm --filter @asterism/backend dev
```

In terminal 2:

```bash
pnpm --filter @asterism/frontend dev
```

Frontend: http://localhost:3000  
Backend OpenAPI: http://localhost:8000/openapi.json

## Run CI checks locally

From repository root:

```bash
pnpm ci:local:quality   # lint + typecheck + tests (backend + frontend)
pnpm ci:local:e2e       # frontend Playwright e2e
pnpm ci:local           # runs both in sequence
```

These scripts mirror the GitHub CI pipeline, including native `better-sqlite3`
verification before test execution.

`pnpm ci:local:e2e` also resets and uses a dedicated BetterAuth database at
`apps/frontend/ci-users.db` so local e2e runs start clean.

## First-time admin access setup

1. Start backend and frontend.
2. Sign up/sign in from the frontend.
3. Open `http://localhost:3000/app/setup`.
4. Enter the `BOOTSTRAP_SETUP_TOKEN` value.
5. Your current signed-in user is promoted to `admin`.

Notes:

- Bootstrap only works while **no admin exists**.
- After the first admin is created, setup bootstrap is disabled.
- Keep `BOOTSTRAP_SETUP_TOKEN` private and share it only through a trusted channel.
