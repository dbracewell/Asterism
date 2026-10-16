# Asterism Frontend (Next.js 16)

Requires Node.js 22.13+ and pnpm 11+.

## Configuration and development

Use only the repository-root `.env.example` / `.env`; app-local dotenv files are
rejected. The root README documents the required strict portable syntax and
initialization steps. `PUBLIC_URL` sets Better Auth's public base URL;
`BETTER_AUTH_SECRET`, `SYSTEM_KEY`, and `ADMIN_PASSPHRASE` are persistent secrets.
Auth storage defaults to `${STORAGE_ROOT:-/storage}/users.db`, with an optional
`BETTER_AUTH_DB_PATH` override.

Browser API, WebSocket, and SSE requests always use the current origin. No
`NEXT_PUBLIC_*` URL settings are needed. Server-side API calls use loopback port 8000. Next.js rewrites `/api/py/*` to FastAPI for local development; nginx handles
that path in Docker. The rewrites preserve trailing slashes so FastAPI collection
routes do not redirect browsers to the internal backend origin and lose their
Authorization header. After changing this routing, restart Next.js and reload
with browser caching disabled to discard any previously cached 308 redirects.

From the repository root:

```bash
pnpm install
pnpm dev                              # both applications in mprocs
pnpm --filter @asterism/frontend dev  # frontend only
```

Both commands use the root launcher. Explicitly exported variables take precedence
over the root file. Restart the root launcher after changing `.env`; restarting only
an mprocs pane retains its inherited environment. Docker Compose also consumes the
root file.

Runtime auth and the official migration CLI use the same database path. Create
its parent directory before local migrations (Docker creates `STORAGE_ROOT`). To
intentionally recreate auth storage, stop the app, run
`pnpm --filter @asterism/frontend reset:db`, inspect the absolute target, and type
`RESET`. Noninteractive cancellation never deletes the selected database.

Open `http://localhost:3000`. Next.js allows only one dev process per app directory.

## LLM provider administration

Administrators configure providers under **Settings → Admin Settings → Providers**.
Choose **OpenAI** for the fixed canonical API URL, or **Generic OpenAI** for an
administrator-supplied compatible HTTP(S) URL. Model discovery is performed by
the authenticated backend API, not directly by the browser. Context-window and
tri-state vision values show their catalog/provider/manual/unknown provenance;
unknown Generic OpenAI metadata can be completed manually and manual values are
preserved on refresh. See
[LLM Providers and Model Capabilities](../../docs/architecture/llm-providers.md).

## Files and knowledge bases

**Files** is the user-facing source of truth for upload processing and image
captions. Eligible uploads are processed in the background; the screen displays
the current artifact status and lets a user retry failed work or edit, clear, or
regenerate a canonical image caption. Caption regeneration warns that a selected
external provider may receive the image. Administrators configure captioning as
part of the single versioned `knowledge.processing` policy under **Settings →
Admin Settings → Image Captioning**. A policy change creates replacement file
generations while existing ready generations remain searchable.

**Knowledge** manages ordered collections of existing library files. Adding a
file only creates a membership, so processing and captions are shared across all
collections that contain it. Removing a membership leaves the file intact;
deleting the file from Files removes its memberships and derived knowledge.
Agent-profile knowledge-base assignments enable the scoped `search_knowledge`
tool. The generated client is the source for these REST contracts.

File lists (including the add-files picker) and knowledge-base details show query
failures with a Retry action. Cached files remain visible when a refresh fails;
failed requests do not appear as empty search results. Knowledge-base management
controls are available only after its details load successfully. Per-file
processing-status queries also support retry, and regeneration failures produce
an error notification.

## Docker and migrations

Only the repository-root Dockerfile and Compose configuration are supported.
Dependencies use the root workspace lockfile; the standalone frontend lockfile,
Dockerfile, and build-approval configuration have been removed.

The container runs the official `auth` CLI before Next.js, pinned to 1.6.11 to
match Better Auth. The image includes `src/lib/auth-cli.ts` and passes it explicitly
with `--config`; startup requires no package downloads or custom migration script.
Migrations create missing tables without resetting users. Migration failure prevents
startup. Back up persistent storage before upgrades; do not use `reset:db` for
container startup. Update the CLI alongside Better Auth when upgrading.

Local migrations, from the repository root:

```bash
pnpm --filter @asterism/frontend migrate:db
pnpm --filter @asterism/frontend exec node --test scripts/test-docker-auth-migrations.mjs
```

Local proxy regression check (stop local dev servers first; uses ports 8000 and
30999 with an in-memory test database):

```bash
node scripts/test-dev-proxy.mjs
```

The combined deployment smoke test is documented in the root README.

## Quality and API generation

From the repository root:

```bash
pnpm --filter @asterism/frontend lint
pnpm --filter @asterism/frontend typecheck
pnpm --filter @asterism/frontend test
node scripts/run-isolated-e2e.mjs       # isolated E2E fixture, from repo root
pnpm --filter @asterism/frontend codegen
```

The correct architecture links are under [`docs/architecture`](../../docs/architecture/README.md).

## Chat file contracts (US-25.1)

The composer uses the generated TanStack upload mutation and sends returned file UUIDs
in create/stream `files` payloads. Message chips carry immutable `file_id` snapshots;
chat downloads and previews call generated chat-scoped endpoints with chat/file IDs.
Library file views retain their owner-scoped library endpoints. Missing historical
references render without download links. ChatInfo/NewChatRequest use `project_id`;
obsolete folder chat actions/listing are removed. Project navigation and guarded
move controls are delivered in later workspace stories.

### Chat upload/send lifecycle

The composer keeps the prompt and attachment chips until persistence is acknowledged.
It uploads through the generated TanStack mutation, caches successful source IDs, retries
only failed uploads, and reuses one request UUID for an unchanged failed send. Editing the
prompt, selections or new-chat main/model/project scope creates a new send key. Follow-ups use
the generated `chatMessageSend` mutation with an explicit parent before signaling
WebSocket `resume`; new chats await `chatSessionCreate`. Failed acceptance retains the
prompt and uploaded sources for retry, and duplicate clicks are blocked while acceptance
is pending. Local chip removal/abandonment revokes browser preview URLs and never deletes
library sources. Historical attachments with `available: false` have no download link.

Server draft upload/select/remove/discard contracts, expiry, and atomic consumption are
implemented in US-25.3. The existing composer stages its picks locally and submits source
IDs atomically; the richer server-draft/library-picker and persisted-removal controls are
integrated in US-27.3. Project/local-file context displays remain EPIC-27. Generated API
clients include the draft and send contracts; there is no handwritten API transport.

### Singleton main settings (US-29.1)

Agent settings expose one model-free main editor and separate fixed-model sub-agent
create/edit/delete controls. New chats display the main identity without offering an
agent selector. The chat model picker is independent of main settings; a user
default only prefills new chats, and unavailable selections require an explicit
replacement. Existing chat selections persist.
Generated TanStack mutations save the new contracts; unavailable sub-agent bindings
are visible and never silently replaced with the user's default model. Tool queries
show loading/error/retry states, and disabled tools must be deliberately removed
before saving a configuration.

### Chat model controls (US-29.2)

New chats send an explicit model ID. Existing chats switch through generated TanStack
mutations with the observed model revision, and the picker is disabled during a run
or send acceptance. Model/query loading, empty, failed, cached-refresh failure, retry,
and unavailable-selection states are explicit; no first-available fallback is used.
A model change updates the composer request scope without dropping prompt/attachments.
Assistant cards and streaming output use their recorded model/provider/configuration
revision instead of relabeling old messages from today's selection. Reopen does not
require a global default model. The broader model browser, project sub-agent selection
and workspace composition remain US-27.5.

Project and General workspace routes, revision-safe project settings, and explicit
chat-history transfer are described in
[project workspaces](../../docs/architecture/project-workspaces.md). Project file
management and sub-agent selection are delivered by their own stories.
