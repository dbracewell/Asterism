# Developing Asterism

How to set up a development environment, run the app locally, and run the checks
that CI runs. For deploying an instance, see the [deployment guide](deployment.md);
for how the system is built, see the [architecture guides](architecture/README.md).

## Prerequisites

- **Node.js** 22.13 or later and **pnpm** 11 or later
- **Python** 3.13 or later, linked against **SQLite 3.45** or later (the backend uses
  SQLite's binary JSON functions), and **uv**
- **mprocs** 0.9.6 or later, to run both apps side by side (`brew install mprocs`,
  or its npm or cargo install)
- **Docker**, only for the container checks

## Set up

1. Install dependencies:

   ```bash
   pnpm install
   pnpm --filter @asterism/backend sync
   ```

2. Create the root `.env` from the example and fill it in:

   ```bash
   cp .env.example .env
   openssl rand -base64 32   # once for each secret
   ```

   Set `PUBLIC_URL` (normally `http://localhost:3000`), the three secrets, and
   `STORAGE_ROOT` to an absolute directory you can write to. The file has a
   [strict syntax](deployment.md#env-file-syntax).

3. Check the configuration. This reads the settings and reports where each came
   from and whether it is valid, without opening a database or printing values:

   ```bash
   pnpm config:check
   ```

4. Create the storage directory, then create or upgrade both databases:

   ```bash
   pnpm --filter @asterism/frontend migrate:db
   pnpm --filter @asterism/backend init:db
   ```

   Both keep existing data. Run them again after pulling schema changes; the backend
   refuses to start until its database is at the current revision.

## Run

```bash
pnpm dev
```

The root launcher checks and loads `.env`, then starts the frontend and backend in
mprocs panes. Press `q` to stop both. Changing `.env` needs a restart of the
launcher, not just of one pane.

Open <http://localhost:3000>, never the backend port. Next.js forwards `/api/py/…`
(WebSockets included) to FastAPI on port 8000, as nginx does in the container. The
API schema is at <http://localhost:3000/api/py/openapi.json>. The backend never
receives Better Auth's secret or the admin passphrase.

To run without mprocs, start each app in its own terminal:

```bash
pnpm --filter @asterism/frontend dev
pnpm --filter @asterism/backend dev
```

The package scripts are the supported entry points. Raw `next`, `uvicorn` or
`python -m` commands don't load `.env`, so their caller must provide a complete
environment.

The first time you open the app, create the administrator account with
`ADMIN_PASSPHRASE` and connect a model provider, as in the
[deployment guide](deployment.md#5-first-administrator-and-setup).

### Resetting local data

`pnpm reset:db` deletes and recreates both local databases and clears uploaded
files and search vectors, keeping downloaded model bundles. It shows the exact paths
and asks you to type `RESET`; in a script, pass `pnpm reset:db -- --yes`. It is for
throwaway development data only, never part of an upgrade
([initialization and reset](architecture/development-reset.md)). Back up anything
you want to keep first.

## Checks

Run these before opening a pull request. CI runs the same ones.

```bash
pnpm format:check    # or pnpm format to fix
pnpm lint
pnpm typecheck
pnpm test            # backend, frontend and root script tests
pnpm docs:check      # links, anchors and images in the documentation
node scripts/run-isolated-e2e.mjs   # browser tests against a disposable stack
```

`pnpm ci:local:quality` and `pnpm ci:local:e2e` run the full CI jobs locally,
including a clean install.

- **Unit and integration tests** never load `.env` and use disposable storage. They
  never touch your working database.
- **The isolated end-to-end runner** creates a temporary auth database, storage and
  configuration, starts both apps on ports 3000, 3100 and 8000 (which must be free),
  runs Playwright with one worker, and removes everything afterwards. Install the
  browser once with `pnpm --filter @asterism/frontend exec playwright install chromium`.
- **Focused runs** use the workspace scripts, for example
  `pnpm --filter @asterism/backend test` or `pnpm --filter @asterism/frontend test`.
  Each app's README lists its own commands: [backend](../apps/backend/README.md),
  [frontend](../apps/frontend/README.md).

### Container checks

With Docker, these check the image and its configuration using generated,
throwaway secrets, containers and volumes:

```bash
docker build -t asterism:local .
pnpm test:container-config            # the same .env values reach the repo loader, Compose and docker run
python3 docker/smoke-test.py asterism:local   # both secret modes, two origins, headers, no leaked secrets
pnpm test:container-launch            # the backend refuses more than one worker
pnpm capacity:check                   # a class of 30 against the image (a 10-minute run plus setup)
```

The [scripts README](../scripts/README.md) describes every root script and its options.

## Working on the code

- **Changing the API.** After a backend route or schema change, regenerate the
  frontend client with `pnpm codegen` while the backend is running (it reads
  `http://localhost:8000/api/py/openapi.json`, or the file or URL in
  `OPENAPI_INPUT`), and commit the result.
- **Changing the schema.** Every backend schema change ships as an Alembic migration
  with an upgrade test ([backend README](../apps/backend/README.md#database-initialization-and-migrations),
  [ADR-0069](adr/0069-versioned-schema-migrations.md)).
- **Process.** Work is planned as epics and stories in `docs/epics/` and tracked in
  [`todo.md`](../todo.md); [`AGENTS.md`](../AGENTS.md) describes the workflow and the
  rules every change follows.
- **Documentation.** Update the matching architecture guide in the same change
  ([writing guides](architecture/CONTRIBUTING.md)).
