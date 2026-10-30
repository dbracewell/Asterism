# Asterism

[![CI](https://github.com/dbracewell/Asterism/actions/workflows/ci.yml/badge.svg)](https://github.com/dbracewell/Asterism/actions/workflows/ci.yml)

Asterism is a self-hosted, full-stack AI chat application. It combines a Next.js
frontend with a FastAPI agent runtime, a main-agent configuration and delegated-worker definitions,
capability-scoped tools, streaming chat, administrator-managed OpenAI-compatible
models, and a file library. Every eligible upload is processed once into a
file-owned knowledge artifact; projects share references to those files without
duplicating processing.

Each user has one model-free main-agent configuration. Chats select their models
independently and record per-execution provenance. They support
branching/regeneration, cancellation with retained partial output, reconnection to
an in-process generation, projects, full-text search, and estimated context-window
usage. Sub-agents run within their own tool allowlist and emit correlated live
activity and persisted execution traces. Chat/project full-text search composes
owner and workspace scope in SQL before pagination and batches snippets only for
the selected page; see the [search design](docs/architecture/data-and-storage.md#search-indexes).

The supported deployment has one backend process and one application instance.
Package and container launches reject `WEB_CONCURRENCY`/`UVICORN_WORKERS` unless
unset or exactly `1`, and reject CLI worker counts other than one. Multiple
replicas and bypassing the supported launcher are unsupported; see the
[deployment/storage decision](docs/adr/0019-single-process-runtime-and-storage-seams.md).

## Architecture

Active and pending work is tracked in [`todo.md`](todo.md). Completed checklist
history is preserved in the dated files under [`docs/archive`](docs/archive).

The [2026-10-17 codebase review](docs/reviews/2026-10-17-codebase-review.md)
assesses architecture, UI reachability, theme contrast and known trust-boundary
defects. Its [quality roadmap](docs/plans/post-refactor-quality-roadmap.md) defines
EPIC-31–EPIC-35. EPIC-31 and EPIC-32 are confirmed complete, including
authentication, mobile workspace, settings, file panes, dialogs and rich chat
content reachability. EPIC-33 / US-33.1, repairing bundled palette mappings and
contrast, is confirmed complete, including the select-text repair. US-33.2, unifying
semantic states, labels and typography, is confirmed complete;
the Montserrat logo is preserved. US-33.3, the theme/layout review matrix, is confirmed complete. Palette sources and control contrast are documented in
the [bundled palette guide](docs/architecture/bundled-theme-palettes.md). The shared
[content policy](docs/architecture/markdown-content.md) defines allowed Markdown,
links, resources and math.
US-34.3 establishes the [current browser baseline](docs/reviews/us-34.3-verification-2026-10-24.md):
122 isolated cases passed without retries, with current model-picker/dialog
behavior, file-knowledge fixtures and a shared unhandled-page-error gate.
Current theme editing, placeholder admin panes and the unimplemented separate
persona/default-profile policy are described in the
[frontend/theme guide](docs/architecture/frontend-and-themes.md).

The implementation-oriented architecture guides are in
[`architecture/`](docs/architecture/README.md):

- [System overview](docs/architecture/overview.md) — topology, workspace layout, request flow, and chat lifecycle
- [Authentication and security](docs/architecture/auth-and-security.md) — Better Auth, JWT/JWKS, tenancy, and internal callbacks
- [Agent runtime](docs/architecture/agent-runtime.md) and [tool authorization](docs/architecture/tool-authorization.md) — bounded execution, delegation, and approvals
- [Chat and WebSocket](docs/architecture/chat-and-websocket.md) — streaming protocol, reconnectable jobs, cancellation, and controller lifecycle
- [Data and storage](docs/architecture/data-and-storage.md) — SQLite, FTS search, file storage, and attachments
- [Knowledge retrieval](docs/architecture/knowledge-retrieval.md) — file-owned processing, private retrieval, and captioning
- [LLM providers](docs/architecture/llm-providers.md) — supported provider modes and model capabilities

The [execution-context guide](docs/architecture/execution-context.md) traces one turn
from project/chat membership through prompts, Agent, scoped retrieval, and provider
access. [ADR-0017](docs/adr/0017-project-file-and-chat-boundaries.md) records current
accepted contracts. [Memory isolation](docs/architecture/context-isolation.md)
distinguishes implemented provenance/key boundaries from future memory storage.

Chat work and connections have [finite admission limits](docs/adr/0020-chat-capacity-admission.md):
defaults are 32 active chat-work slots (four per owner) and 128 controllers (16 per
owner). Saturation returns a retryable socket error; reconnecting preserves active
work. These process-local limits are separate from model/knowledge concurrency.

## Current versus planned capabilities

The admin navigation marks **Groups, Users, Image Generation, Code Execution and
Export** as **Planned**. Their panes explain future scope and offer no configuration
actions. Providers, Theme Editor, Tools and Image Captioning remain available;
user settings expose General, Personas, Skills, and Agents.

| Capability           | Available now                                                                                                                                      | Planned                                                    |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| Providers and models | Admin provider/model configuration; per-chat model selection                                                                                       | —                                                          |
| Agents and tools     | User main/sub-agent settings; admin tool policy and provider settings                                                                              | —                                                          |
| Skills               | Private skills editor/assignments, admin policy, slash discovery, branch-local activation and provenance ([contract](docs/architecture/skills.md)) | Automatic skill selection                                  |
| Appearance           | User theme/font preferences; admin Theme Editor                                                                                                    | —                                                          |
| Image captioning     | Admin captioning policy and file-processing integration                                                                                            | —                                                          |
| Users and access     | Admin/user access checks, owner scoping and backend user lifecycle                                                                                 | Users management screens and permission-policy controls    |
| Groups               | —                                                                                                                                                  | Group management and group policy settings                 |
| Image Generation     | Image search and captioning are separate existing capabilities                                                                                     | Image-generation providers, models and generation workflow |
| Code Execution       | —                                                                                                                                                  | Sandboxed execution and runtime settings                   |
| Export               | Individual file downloads                                                                                                                          | Data/conversation export tools                             |
| Personas and memory  | Persona CRUD/defaults, chat selection and immutable execution inputs                                                                               | Long-term memory engine                                    |

The Users badge describes unfinished administration screens, not missing access
control. Backend list/provision/delete routes already have authorization and
lifecycle checks. Navigation visibility does not grant access. Persona settings manage separate USER.md instructions and one default; chats can
follow that default or select a fixed persona. Accepted turns preserve their
instructions and provenance. Long-term memory remains future work. See the [product-surface inventory](docs/architecture/frontend-and-themes.md#current-versus-planned-product-surface) for ownership
and limits.

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

`/storage` contains `users.db`, `database.db`, uploaded files, and custom themes
under `themes` (see [theme lifecycle](docs/architecture/theme-storage.md)). Auth migrations
run on each startup using the bundled, pinned official Better Auth CLI and explicit
`src/lib/auth-cli.ts` configuration (no startup downloads). The backend initializer runs on every startup, creating missing model tables and
search indexes without upgrading incompatible existing tables. Backend data is not
automatically migrated or reset. Bind mounts must
be writable by UID **10001**. Back up databases before upgrades. For an intentional clean development cutover,
follow [initialization and reset](docs/architecture/development-reset.md); full reset
removes relational/source/vector data while preserving downloaded model bundles
and administrator theme customization.

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
   recreate both local SQLite databases and clear disposable source/knowledge storage, run `pnpm reset:db`, inspect the displayed
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
The same setup card then offers to connect a model provider and enable a model
(`/setup`), then confirms you're ready before opening the first chat; it can be skipped and is shown only to an administrator while no model
is active. Keep this passphrase private. The frontend and backend must use the same `SYSTEM_KEY`.

## Files, project context, and captions

**Files** is the canonical library for uploaded sources and derived knowledge.
Eligible uploads automatically queue knowledge ingestion or image embedding. Processing
status is visible; failed or canceled work can be retried from Files.

Projects share references to library files. Chats combine current project files
with attachments on their active message branch. Removing a project membership
preserves the library source and artifacts; deleting the file removes references,
source bytes, artifacts, and vectors. Runtime retrieval checks the authenticated
owner and live execution file scope before querying and again before release.

Image captions are derived outputs managed in **Files**. Successful captions are
indexed automatically; users can regenerate a file's embedding and caption.
Administrators configure the single versioned `knowledge.processing` policy under **Settings →
Admin Settings → Image Captioning**, choosing disabled, a vision provider, or a
reviewed local model. An external provider receives source images when selected.
Policy changes queue replacement generations while current ready generations
remain searchable until replacement succeeds.

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

## Personas

User Settings → Personas manages up to 20 owned personas, each with a name and
USER.md instructions. Choose one default; chats can follow it for each new message
or keep an explicit selection. Save uses revision checks and retains drafts after
conflicts. Choose another default and switch explicitly selected chats before
deleting a persona. Accepted turns preserve their instructions; resume reuses them
and regeneration captures current settings. Delegates inherit the recorded persona
within their existing capability ceilings. No long-term memory engine is active.
See [binding and storage limits](docs/adr/0021-personas-and-execution-binding.md).

This schema requires fresh initialization. For an older development database, use
the explicit reset workflow when ready to discard its data; story tests use
disposable storage and do not reset the working database.

## License

Asterism is licensed under the [Apache License, Version 2.0](LICENSE).
Copyright 2026 David Bracewell.
