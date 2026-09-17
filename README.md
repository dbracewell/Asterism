# Asterism

[![CI](https://github.com/dbracewell/Asterism/actions/workflows/ci.yml/badge.svg)](https://github.com/dbracewell/Asterism/actions/workflows/ci.yml)

Asterism is a full-stack, multi-agent AI application with coordinated agents, tools,
skills, memory, and profile-specific behavior.

## Configuration

Copy the shared example to the repository root and replace the placeholder secrets:

```bash
cp .env.example .env
# Generate separate persistent secrets with: openssl rand -base64 32
```

- `PUBLIC_URL`: the browser-facing origin, default `http://localhost:3000`, without
  a trailing slash. This also sets Better Auth's base URL and JWT issuer/audience.
- `BETTER_AUTH_SECRET`: persistent secret protecting authentication data.
- `SYSTEM_KEY`: shared secret for internal privileged requests.
- `ADMIN_PASSPHRASE`: passphrase for first-time administrator setup.
- `STORAGE_ROOT`: absolute writable directory for local development. Docker Compose
  uses its named volume at `/storage`, regardless of this local setting.
- Optional: `BETTER_AUTH_DB_PATH` and `DB_URL` override database locations.
- Optional: `PORT` changes the Compose host port; update `PUBLIC_URL` to match.

Browsers always use same-origin `/api/py`, `/api/stream`, and chat WebSocket URLs.
Server-side API requests use loopback port 8000. Signing-key discovery and webhooks
use loopback port 3000. These internal ports are fixed in both development and Docker.
There are no separate JWT issuer/audience or browser API URL settings.

**Migrating older configuration:** move secrets and storage settings into the root
`.env`, rename the old public auth/frontend URL setting to `PUBLIC_URL`, and remove
legacy JWT, JWKS, frontend/backend URL overrides and `NEXT_PUBLIC_*` URL variables.
Archive the old app-local `.env` files so Next.js and Python do not load stale values.
Keep the existing secrets and database paths to preserve users and sessions.

## Docker

The root `Dockerfile` packages Next.js, FastAPI, and nginx in one non-root container.
pnpm builds the frontend workspace; uv installs locked Python dependencies. The split
container configuration is no longer supported.

```bash
docker compose up -d --build
docker compose logs -f
```

Or build and run directly:

```bash
docker build -t asterism:local .
docker run -d --name asterism --restart unless-stopped --stop-timeout 30 \
  -p 127.0.0.1:3000:3000 --env-file .env -e STORAGE_ROOT=/storage \
  -v asterism-storage:/storage asterism:local
```

Open <http://localhost:3000>. To use another local port, set `PORT=8080` and
`PUBLIC_URL=http://localhost:8080` for Compose. Changing the public origin does not
require rebuilding the image, only recreating the container.

For remote HTTPS access, put a trusted TLS proxy in front of port 3000 and set
`PUBLIC_URL` to its external origin. Forward Host, X-Forwarded-Proto, and WebSocket
upgrades. Do not expose internal ports 3001 or 8000.

### Storage and lifecycle

`/storage` contains `users.db`, `database.db`, and uploaded files. Auth migrations
run on each startup using the bundled, pinned official Better Auth CLI and explicit
`src/lib/auth.ts` configuration (no startup downloads). The backend initializer runs only when its database is absent;
existing backend databases are not reset or automatically migrated. Bind mounts must
be writable by UID **10001**. Back up databases before upgrades.

The single `storage` volume does not automatically import older split-container
volumes. Copy their databases/files into the new volume while services are stopped,
retaining the auth secret and setting appropriate ownership. Never use `down -v`
unless deleting persisted data is intentional.

Health checks cover the frontend, backend OpenAPI, and auth signing keys. If a
service exits, the container stops so its restart policy can recover. SIGTERM stops
all services. ML/CUDA dependencies make builds and images large; allow substantial
free Docker disk space. Optional tools requiring Playwright browsers need those
browser binaries installed separately.

Deployment smoke test (creates/removes its own container, volume, and account):

```bash
python3 docker/smoke-test.py asterism:local
```

## Local development

Requires Node.js 22.13+, pnpm 11+, Python 3.13+, uv, and Python linked against
SQLite **3.45+** (the backend uses JSONB functions).

1. Run `pnpm install` and `pnpm --filter @asterism/backend sync`.
2. Configure the root `.env` as above, with an absolute writable `STORAGE_ROOT`.
3. Initialize databases on a **fresh installation only**:

   ```bash
   # Create your configured STORAGE_ROOT directory first.
   # Frontend migrations are non-destructive.
   cd apps/frontend
   node --env-file=../../.env node_modules/auth/dist/index.mjs migrate --config ./src/lib/auth.ts --yes
   cd ../backend
   # WARNING: this backend command resets an existing database.
   uv run --env-file ../../.env python -m asterism.db.init_db
   cd ../..
   ```

4. Start both applications from the repository root:

   ```bash
   pnpm dev
   ```

`pnpm dev` currently starts both workspace development scripts through pnpm. The
shared root environment launcher and mprocs interface are introduced separately by
EPIC-9; until then, follow the app-specific configuration notes. Open
`http://localhost:3000`, not the backend port. Next.js proxies `/api/py/*`
(including WebSocket upgrades) to FastAPI on port 8000. Docker uses nginx for the
same routing. API schema: `http://localhost:3000/api/py/openapi.json`.

To start one workspace using its current package-level configuration path:

```bash
pnpm --filter @asterism/frontend dev
pnpm --filter @asterism/backend dev
```

EPIC-9 US-9.1 will make root and focused development commands use the same root
configuration source.

## First-time administrator setup

Open the app and complete the initial account setup using `ADMIN_PASSPHRASE`.
Keep this passphrase private. The frontend and backend must use the same `SYSTEM_KEY`.

## Quality checks

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm --filter @asterism/frontend test:e2e
```

Existing local CI helpers are also available via `pnpm ci:local:quality` and
`pnpm ci:local:e2e`. The E2E helper resets its dedicated test database, not production
storage. See each application's README for focused commands.
