# Repository Scripts

These Node.js scripts support configuration loading, validation, CI checks, database
maintenance, and isolated tests. Run commands from the repository root unless noted
otherwise. Use the corresponding pnpm command when one is available; package scripts
provide the intended configuration profile and environment scope.

API-client generation is intentionally a workspace command rather than a script in
this directory: after a FastAPI contract change, use `pnpm --filter
@asterism/frontend codegen` against the current backend schema. The generated client
is used by file, project, processing-profile, and captioning UI flows.

## Script reference

### `check-client-secret-leaks.mjs`

Scans one or more files or directories for the current process values of
`BETTER_AUTH_SECRET`, `SYSTEM_KEY`, and `ADMIN_PASSPHRASE`. It reports only the
variable name and artifact path, never the matched value. CI uses it with synthetic
canaries to verify that secrets do not enter browser assets or the generated API
client.

```bash
BETTER_AUTH_SECRET=synthetic-canary \
  node scripts/check-client-secret-leaks.mjs apps/frontend/.next/static
```

Exit codes: `0` when no canary is found, `1` when a leak is found, and `2` when no
scan path is supplied.

### `check-no-dotenv.mjs`

Recursively checks a directory for runtime `.env*` files while allowing
`.env.example` and ignoring dependency, build, virtual-environment, and test-output
directories. CI runs this immediately after checkout to prove that quality gates do
not depend on a dotenv file.

```bash
node scripts/check-no-dotenv.mjs [directory]
# pnpm alias:
pnpm check:no-dotenv
```

The default directory is the current working directory. A normal developer checkout
with a root `.env` is expected to fail this CI-oriented check.

### `check-workspace-tasks.mjs`

Validates repository task wiring and maintenance safeguards. It checks that root
quality commands invoke the expected pnpm workspaces, required workspace scripts
exist, Turbo and obsolete files remain removed, and reset/migration commands do not
reintroduce `auth@latest`, shell sourcing, or developer-specific paths.

```bash
pnpm check:workspace-tasks
```

### `config-check.mjs`

Loads and validates configuration without opening databases, creating storage, or
starting an application. Output is restricted to setting names, source categories,
and validity; values are never printed. It also warns when the root `.env` has broader
than owner-only POSIX permissions.

```bash
pnpm config:check
node scripts/config-check.mjs \
  --profile development --scope all --env required
```

Options:

- `--profile`: `development`, `production`, `auth-migrate`, `backend-init`, `reset`,
  `build`, `test`, or `codegen`.
- `--scope`: `all`, `frontend`, or `backend`.
- `--env`: `required`, `optional`, or `none`.

### `config-contract.mjs`

Defines the shared configuration catalog and side-effect-free validation rules used
by the launcher, configuration check, tests, and container startup. It exports
`validateConfiguration`, `assertValidConfiguration`, setting metadata, secret names,
and redacted error types. This is a library module rather than a standalone command.

Validation covers command-specific requirements, origins, secret placeholders and
production strength, absolute/writable storage targets, SQLite URLs, ports, and JSON
list settings.

### `reset-databases.mjs`

Coordinates an explicitly destructive reset of both backend and authentication SQLite
databases. It displays the resolved absolute targets and requires the operator to type
`RESET` before invoking each workspace's already-confirmed reset command. A
noninteractive invocation is canceled unless `--yes` is explicitly supplied.

Use the root command rather than invoking this file directly:

```bash
pnpm reset:db
pnpm reset:db -- --yes # explicit noninteractive confirmation
```

Configuration is validated by `run-with-env.mjs` before this script runs. It removes
original files and knowledge/vector storage along with both databases, but retains
`models/knowledge-clip` and `models/captioning-smolvlm2`. Stop all application workers
first. The two-store reset is sequential, not transactional. See the
[reset runbook](../docs/architecture/development-reset.md) for override paths,
review, initialization, retained model bundles, and partial failure handling.

### `run-isolated-e2e.mjs`

Creates a unique temporary directory, generates synthetic test secrets, migrates a
temporary Better Auth database, runs the frontend Playwright suite, and removes all
temporary state in a `finally` block. It does not load developer dotenv files or use
repository/production databases.

```bash
CI=1 node scripts/run-isolated-e2e.mjs --retries=0
# Focus one spec (its fresh-install prerequisite still runs):
CI=1 node scripts/run-isolated-e2e.mjs authenticated-workspace.spec.ts --retries=0
# Included in:
pnpm ci:local:e2e
```

`RUNNER_TEMP` is used when available; otherwise the operating-system temporary
directory is used.

Ports **3000, 3100, and 8000** must be free. A loopback bridge on 3000 forwards
only backend JWKS and internal stream-callback routes to Next.js on 3100; it does
not reuse a developer server. The runner passes its unique auth/storage paths to
both applications and closes the bridge/backend before removing temporary state.
The Playwright subprocess is asynchronous so internal auth requests can progress.
CLI arguments pass through to Playwright. The `fresh-install` project is an explicit
prerequisite before account-creating Chromium tests.

The authenticated workspace spec runs only with the runner's
`ASTERISM_ISOLATED_E2E=true` marker. It uses real Better Auth/JWT, production routes,
SQLite/file storage, WebSockets, and a local deterministic OpenAI-compatible model
double. Other specs retain mocked HTTP/WebSocket boundaries for focused failure/UI
states. Embedding model provisioning is disabled in isolated runs; pending retrieval
is explicit, and backend tests verify ready-vector retrieval separately.

### `run-with-env.mjs`

The central configuration launcher. It resolves the repository root independently of
the current working directory, enforces the strict portable dotenv grammar, rejects
competing app-local dotenv files, applies process/root-dotenv/file-secret precedence,
validates the selected command profile, removes out-of-scope application settings,
and then spawns the command. Child exit codes and termination signals are preserved.

```bash
node scripts/run-with-env.mjs \
  --env required --scope frontend --profile development -- <command> [args...]
```

Environment modes:

- `required`: require and load the root `.env`.
- `optional`: load the root `.env` if present.
- `none`: do not inspect or load dotenv/file-secret sources.

Scopes are `all`, `frontend`, and `backend`. The launcher sets
`ASTERISM_CONFIG_PROFILE` for the child. Most users should invoke existing root or
workspace pnpm scripts instead of calling the launcher directly.

The module also exports the portable parser, root loader, scope filtering, argument
parsing, legacy-file detection, and subprocess runner for tests and other repository
tools.

### `check-theme-storage-container.mjs`

Verifies the actual theme repository in a disposable test layer on the locally
available `asterism:local` runtime image. Requires Docker and installed frontend
dependencies; optional `THEME_TEST_RUNTIME_IMAGE` selects another local application
runtime image. It makes no network requests during the image build or container runs.

```bash
node scripts/check-theme-storage-container.mjs
```

Three fresh containers run as UID/GID `10001` with a read-only application filesystem
and share a newly created test volume. The check saves, replaces and reads a palette,
verifies default assets are immutable and removes its own image, volume and temporary
artifacts. No existing application data is used. See [theme lifecycle](../docs/architecture/theme-storage.md).

## Theme and layout review evidence

The isolated browser runner includes the [theme/layout review matrix](../docs/architecture/theme-layout-review-matrix.md),
with all bundled palettes, short viewports, narrow containers and enlarged text.
Use `--retries=0` for deterministic final verification (also the Playwright default).
The Playwright HTML report is under `apps/frontend/playwright-report`; JSON results,
per-case geometry/contrast evidence and screenshots are under
`apps/frontend/test-results`. Failures retain traces with zero retries. CI uploads
these generated directories as `frontend-ui-review` even when tests fail, retaining
them for seven days. Working data must not be used for these artifact-producing runs.

### Backend launch contract checks

`pnpm test:container-launch` uses the project's Python through uv, requires a
running Docker daemon, and builds a small temporary Python image with the locked
Uvicorn version and actual backend launcher/entrypoint. It verifies default/explicit
one-worker settings and rejection of invalid worker environments/CLI options before
application dependencies, secrets or data initialization. Test-owned containers and
the image tag are removed; base/build caches remain. CI runs this in the quality job.
It is not the full application image smoke test.

For a host-only check, run from the repository root:

```bash
uv run --project apps/backend python -m asterism.serve --check
```

The launcher enforces the [single-process contract](../docs/adr/0019-single-process-runtime-and-storage-seams.md).
