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

### Strict portable `.env` syntax

The root `.env` is intentionally limited to syntax that produces identical bytes in
Node.js, Docker Compose, and `docker run --env-file`:

```dotenv
# Full-line comments and blank lines are allowed.
PUBLIC_URL=http://localhost:3000
BETTER_AUTH_SECRET=abcDEF0123+/=_-.
EMPTY_OPTIONAL_VALUE=
```

Each assignment must be a single unquoted `KEY=VALUE` line with no surrounding
whitespace. Keys use letters, digits, and underscores and cannot begin with a digit.
Values may contain additional `=` characters. LF and CRLF line endings are supported.

The following are rejected before an application starts:

```dotenv
VALUE="quoted"              # quotes
VALUE=two words             # whitespace
VALUE=$HOME                 # interpolation or dollar characters
VALUE=secret # comment      # inline comments
VALUE=line\nnext            # escapes and backslashes
export VALUE=secret         # shell syntax
```

Quotes, `$`, escapes, interpolation, multiline values, inline comments, and whitespace
in values are forbidden because common dotenv implementations interpret them
differently. Use whitespace-free paths and generated URL-safe/base64 secrets. If a
value cannot use this grammar, inject it directly into the process environment instead
of putting it in the shared file.

Explicitly inherited process variables take precedence over the root file, including
an explicitly empty value; later validation may reject an empty required setting.
Changing `.env` requires restarting the root development launcher, not merely an
individual mprocs pane.

Validate development configuration without opening databases, creating storage, or
printing values:

```bash
pnpm config:check
```

The check reports each setting's source (`process`, `root-dotenv`, `file-secret`,
`default`, or `missing`) and status. Runtime profiles reject empty values and known
placeholders; production additionally enforces HTTPS outside loopback and minimum
secret strength. Canonical `/run/secrets/BETTER_AUTH_SECRET`, `SYSTEM_KEY`, and
`ADMIN_PASSPHRASE` files are fallback sources when process/root values are absent.
The complete variable catalog and command validation matrix are in
[ADR-0010](docs/adr/0010-configuration-validation-secrets-and-safe-migration.md).

Browsers always use same-origin `/api/py`, `/api/stream`, and chat WebSocket URLs.
Server-side API requests use loopback port 8000. Signing-key discovery and webhooks
use loopback port 3000. These internal ports are fixed in both development and Docker.
There are no separate JWT issuer/audience or browser API URL settings.

Asterism currently has no supported legacy-installation migration path. Fresh
installations use only the root configuration described above.

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
require rebuilding the image, only recreating the container. Image builds neither
read `.env` nor require runtime credentials.

For orchestrators with file secrets, mount canonical uppercase files at
`/run/secrets/BETTER_AUTH_SECRET`, `/run/secrets/SYSTEM_KEY`, and
`/run/secrets/ADMIN_PASSPHRASE`. Explicit environment values take precedence. Do not
mount lowercase aliases.

For remote HTTPS access, put a trusted TLS proxy in front of port 3000 and set
`PUBLIC_URL` to its external origin. Forward Host, X-Forwarded-Proto, and WebSocket
upgrades. Do not expose internal ports 3001 or 8000.

### Storage and lifecycle

`/storage` contains `users.db`, `database.db`, and uploaded files. Auth migrations
run on each startup using the bundled, pinned official Better Auth CLI and explicit
`src/lib/auth-cli.ts` configuration (no startup downloads). The backend initializer runs only when its database is absent;
existing backend databases are not reset or automatically migrated. Bind mounts must
be writable by UID **10001**. Back up databases before upgrades.

Never use `docker compose down -v` unless deleting all persisted data is intentional.

Health checks cover the frontend, backend OpenAPI, and auth signing keys. If a
service exits, the container stops so its restart policy can recover. SIGTERM stops
all services. ML/CUDA dependencies make builds and images large; allow substantial
free Docker disk space. Optional tools requiring Playwright browsers need those
browser binaries installed separately.

Deployment checks use only generated disposable configuration, containers, volumes,
and accounts:

```bash
pnpm test:container-config
python3 docker/smoke-test.py asterism:local
```

The parity check verifies byte-identical strict-file values in the repository loader,
Compose, and direct Docker. The smoke test exercises both environment and canonical
file-secret modes with two runtime origins and scans browser assets, image metadata,
and logs for synthetic secret canaries.

## Local development

Requires Node.js 22.13+, pnpm 11+, Python 3.13+, uv, mprocs 0.9.6+, and Python
linked against SQLite **3.45+** (the backend uses JSONB functions).

1. Run `pnpm install` and `pnpm --filter @asterism/backend sync`.
2. Configure the root `.env` as above, with an absolute writable `STORAGE_ROOT`.
3. Initialize databases on a **fresh installation only**:

   ```bash
   # Create your configured STORAGE_ROOT directory first.
   pnpm --filter @asterism/frontend migrate:db
   pnpm --filter @asterism/backend init:db
   ```

   Both initialization commands preserve existing data. To intentionally delete and
   recreate both local SQLite databases, run `pnpm reset:db`, inspect the displayed
   absolute targets, and type `RESET`. Noninteractive execution is canceled unless
   `pnpm reset:db -- --yes` is supplied explicitly. Reset supports only validated
   local SQLite targets; back up any data you need first.

4. Start both applications from the repository root:

   ```bash
   pnpm dev
   ```

Install mprocs 0.9.6 or newer (`brew install mprocs`, or use its documented npm/cargo
installation), then run `pnpm dev`. The root launcher validates and loads `.env` before
mprocs starts separate frontend and backend panes. Press `q` in mprocs to stop both.
The backend child does not receive Better Auth or administrator secrets.

Open `http://localhost:3000`, not the backend port. Next.js proxies `/api/py/*`
(including WebSocket upgrades) to FastAPI on port 8000. Docker uses nginx for the
same routing. API schema: `http://localhost:3000/api/py/openapi.json`.

To run without mprocs, start one app in each of two terminals. These focused commands
use the same root loader and configuration contract:

```bash
pnpm --filter @asterism/frontend dev
pnpm --filter @asterism/backend dev
```

Documented package scripts are the supported entrypoints. Raw `next`, `uvicorn`, and
`python -m` commands must be given a complete environment by their caller.

## First-time administrator setup

Open the app and complete the initial account setup using `ADMIN_PASSPHRASE`.
Keep this passphrase private. The frontend and backend must use the same `SYSTEM_KEY`.

## Quality checks

```bash
pnpm lint
pnpm typecheck
pnpm test
node scripts/run-isolated-e2e.mjs
```

Existing local CI helpers are also available via `pnpm ci:local:quality` and
`pnpm ci:local:e2e`. Unit and E2E jobs do not load dotenv files; the E2E helper creates,
migrates, and removes a unique temporary auth database and configuration directory.
CI also builds the Docker frontend stage without runtime credentials. See each
application's README for focused commands.
