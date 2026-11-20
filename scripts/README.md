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

### `capacity-check.mjs`

Runs a class of simulated students against a disposable container sized like the
target host (US-86.7), and reports against the capacity targets. It starts an
OpenAI-compatible model double on the host that streams like a hosted model, a
fresh container with `--cpus` and `--memory` limits and a new volume, and signs
up an admin and the students. Then for `--duration` seconds the students sign in
(spread over `--arrival` seconds) and chat, upload notes and review flashcards,
with think time between actions. At `--burst-at` seconds every student asks at
once. The container is removed afterwards unless `--keep` is given.

```bash
docker build -t asterism:local .
pnpm capacity:check                                   # 30 students, 10 minutes, 4 CPUs, 8 GB
pnpm capacity:check --students 60 --env MAX_ACTIVE_CHAT_JOBS=64
```

Options: `--image`, `--students`, `--duration`, `--arrival`, `--burst-at` (0 for
none), `--think-min`/`--think-max`, `--cpus`, `--memory`, `--port`,
`--addresses shared|each` (one school address, or one each), `--tokens
cached|per-request` (how the browser gets backend tokens; per-request reproduces
the behavior before US-86.7), the model double's `--model-ttft-ms`, `--model-tps`
and `--reply-tokens`, repeatable `--env KEY=VALUE` for the container, and `--out`
(default `.capacity/<time>`, which holds `summary.md`, `summary.json` and the
container log). Exit codes: `0` when every target passes, `1` when one fails, `2`
when the run could not complete. The scenario, targets and recorded results are
in [docs/architecture/capacity.md](../docs/architecture/capacity.md).

### `docs-screenshots.mjs`

Regenerates the [user guide](../docs/guide/README.md)'s screenshots with
`pnpm docs:screenshots`. Build the image first (`docker build -t asterism:local .`).

The run starts a scripted model on the host and a disposable container on a fresh
volume, so it never touches your working database or your own containers. It
then:

1. walks first-run setup in a browser, as the administrator would;
2. seeds the fictional demo dataset through the API: an administrator, an educator
   and two students, files in several formats, a project with a sub-agent, chats
   with sources, branches and a canvas, a long chat to compact, a skill, a web
   page tool that asks for approval, image creation, image captions, a file whose
   processing failed, an example chat for each learning mode, reflections,
   About you, a ChatGPT policy that allows connections, flashcards with
   reviews, a quiz with an attempt, topics, a
   summary, a class with a two-version course, class rules and one unused
   invite link, and a deletion request;
3. takes every shot in the shot list. Each person signs in once; later shots
   reuse the session, so a long list stays under the sign-in rate limit.

The pieces live in [`screenshots/`](screenshots/):

- [`shots.mjs`](screenshots/shots.mjs) is the shot list. Each entry names the image,
  its alt text, whose browser takes it (or `visitor`, signed out), the page and
  the text to wait for.
- [`demo-content.mjs`](screenshots/demo-content.mjs) holds the people, files and
  scripted replies.
- [`demo-provider.mjs`](screenshots/demo-provider.mjs) is the scripted model. It
  answers demo prompts with fixed text, searches project files and cites what it
  finds, and returns valid JSON to the flashcard, quiz, summary and study-guide
  generators. A script with `pace` streams slowly, so a shot can catch a reply
  while it is still being written; `fetch` makes it read a web page (which asks
  for approval) and `byModel` gives each model its own answer when comparing.
  Study drafts (cards, quiz questions, summary sections) are chosen by the file
  in each request, so they cite the right file. It also scripts the prompt
  coach, context compaction, image captions, short-answer grading and skill
  drafts, and
  stands in for a
  ComfyUI image server under `/comfy` that returns one fixed picture.
- [`seed.mjs`](screenshots/seed.mjs) creates the dataset.

Every picture uses the light Atlas theme, the default font size, a fixed locale and
time zone, and either a desktop viewport (1440×900) or a phone viewport (390×844).

Options: `--only name,name` takes only those shots (the setup and seed still run),
`--out` sets the image folder (default `docs/guide/images`; a shot with its own
`file` still writes there), `--image` picks the
image (default `asterism:local`), `--port` sets the host port (default `3970`), and
`--keep` leaves the instance and the scripted model running (until Ctrl+C) and
prints the seeded ids, so you can follow a page's steps by hand. The run exits `1` if any shot can't be taken, and lists
images in the folder that no shot produces any more.

### `check-docs.mjs`

Checks every link, heading anchor and image in the documentation (`pnpm
docs:check`): the root README and other entry documents, and everything under
`docs/` except the archive. CI runs it in the quality job.

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
reintroduce `auth@latest`, shell sourcing, or developer-specific paths. It also
fails when a copy of the app version differs from the root `package.json`
(`app-version.mjs`, US-91.1).

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
production strength, absolute/writable storage targets, SQLite URLs, ports, the
upload limit, trusted proxy networks, and JSON list settings.

### `edge-config.mjs`

Renders the nginx snippets that depend on settings into a directory: the request
body limit and its JSON 413 from `MAX_UPLOAD_FILE_SIZE_BYTES`, HSTS when `PUBLIC_URL`
is HTTPS, and real-IP rules from `TRUSTED_PROXIES`
([ADR-0071](../docs/adr/0071-edge-hardening.md)). The container entrypoint runs it
after configuration validation; `next.config.ts` imports its request limit.

```bash
node scripts/edge-config.mjs /tmp/asterism-nginx
```

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

Playwright serves a production build (`next build`, then `next start`) under the
`test` profile, so results do not depend on worker count: `next dev` compiles
routes and chunks on demand and Fast-Refreshes open pages, which made parallel
runs fail different specs each time. The test profile disables Better Auth's
production rate limiter because parallel specs create many accounts from one
address. Set `E2E_DEV_SERVER=1` to iterate against `next dev` without rebuilding;
results there may vary with parallel workers.

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

### `check-image.mjs`

Starts a built image the way CI does before a release (US-91.2). It runs the
image on a fresh volume with generated, throwaway secrets (passed through the
environment, never the command line), waits for its health check, and checks
that the Better Auth migration ran and the backend database has a schema
revision, that `/sign-in`, `/api/py/health/ready` and `/api/health` answer 200,
and that every process runs as UID 10001. It also fails when the unpacked image
is over a size budget (5 GB by default), listing the largest layers. On failure
it prints the container's last log lines. The container and volume are removed
afterwards.

```bash
pnpm check:image                                   # asterism:local, 5 GB budget
pnpm check:image --image asterism:ci --max-size-gb 5
```

### `check-release-notes.mjs`

Fails when the work since the branch left its base adds an Alembic revision
under `apps/backend/asterism/db/migrations/versions/` or changes
`scripts/config-contract.mjs`, but doesn't change `docs/release-notes.md`
(US-91.3). It counts committed, uncommitted and new files. Other changes that
need a note, such as the image or documented behavior, are left to review.

```bash
pnpm check:release-notes                    # against origin/main
pnpm check:release-notes --base <ref>       # CI: the pull request's base, or the pushed-over commit
```

### `check-theme-storage-container.mjs`

Verifies the actual theme repository in a disposable test layer on the locally
available `asterism:local` runtime image. Requires Docker and installed frontend
dependencies; optional `THEME_TEST_RUNTIME_IMAGE` selects another local application
runtime image. It makes no network requests during the image build or container runs.

```bash
pnpm check:theme-storage-container
THEME_TEST_RUNTIME_IMAGE=asterism:ci pnpm check:theme-storage-container
```

Three fresh containers run as UID/GID `10001` with a read-only application filesystem
and share a newly created test volume. The check saves, replaces and reads a palette,
verifies default assets are immutable and removes its own image, volume and temporary
artifacts. No existing application data is used. See [theme lifecycle](../docs/architecture/theme-storage.md).

## Theme and layout review evidence

The isolated browser runner includes the [theme/layout review matrix](../docs/reviews/theme-layout-review-matrix.md),
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
