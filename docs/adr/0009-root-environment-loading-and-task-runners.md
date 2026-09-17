# ADR-0009: Root environment loading and task runners

- **Status:** Accepted (revised after maintainer review)
- **Date:** 2026-09-16
- **Spike:** SP-9.1
- **Decision owners:** Asterism maintainers

## Context

Asterism has a Next.js frontend and FastAPI backend in pnpm workspaces. Turborepo
currently schedules all root tasks. Local configuration is duplicated at the root
and in each app, and entrypoints load it differently. The desired state is one
repository-root `.env` for local development while retaining environment-only CI
and production operation.

Environment loading and task scheduling are separate concerns. Turbo does not read
dotenv files. pnpm and mprocs also inherit an existing process environment but do
not, by themselves, establish the required root dotenv contract.

No real `.env` values were read during this spike. All behavioral tests used temporary
files and dummy values.

## Decision

1. Use a small, repository-owned **Node launcher** as the single local dotenv boundary.
   It resolves the repository root from the launcher's own location, validates and
   parses the strict cross-runtime grammar finalized by ADR-0011, preserves inherited
   environment values, and starts the requested command without a shell.
2. Use **mprocs for interactive local full-stack development**. The root `dev` command
   loads configuration once and starts mprocs; a tracked, secret-free `mprocs.yaml`
   runs the frontend and backend workspace dev commands in explicit working directories.
3. **Remove Turbo in a dedicated story and use pnpm workspace scripts for build,
   lint, typecheck, and test.** The maintainer confirmed that cross-package ordering,
   concurrency, and caching are not valuable for the current two-app repository.
   pnpm supplies the required workspace selection and recursive execution.
4. Preserve direct single-workspace development through package scripts. A frontend
   or backend package script calls the same root launcher, so behavior does not depend
   on the caller's current directory or on mprocs being installed.
5. Keep mprocs out of CI and containers. Their non-interactive commands continue to
   use pnpm/Turbo or direct application entrypoints with explicitly injected variables.
6. Before loading configuration, reject app-local dotenv files by **path only** (never
   inspect or print values), excluding the tracked `.env.example` files during the
   migration window. Later implementation consolidates examples at the root. This
   prevents Next.js or Pydantic from silently adding values from stale files.
7. Environment changes take effect only after restarting the root launcher. Restarting
   an mprocs pane retains the mprocs parent's original environment.

The implementation launcher should support two modes:

- local commands that require root `.env`, with an actionable missing-file error;
- file-optional commands where a valid injected environment is sufficient.

It should preserve child exit status and signals and redact values in diagnostics.
The implementation story must regression-test these properties before replacing the
current shell wrapper.

## Why this combination

mprocs improves the local-development problem—observing and restarting two
long-running services. pnpm workspaces are sufficient for finite build/check tasks,
and removing Turbo eliminates an environment-filtering and cache-policy layer that
the project does not need.

A repository-owned launcher provides one contract for mprocs, standalone workspace
scripts, code generation, and maintenance commands. It avoids the current shell
`export $(cat ... | xargs)` behavior and avoids making Python's interpolating parser
the canonical parser for frontend secrets.

## Supported command matrix for implementation

| Use case                          | Supported path                                                   | Dotenv behavior                                                                                                |
| --------------------------------- | ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Full local development            | Root `pnpm dev` → root launcher → mprocs → workspace dev scripts | Root file required; loaded before mprocs                                                                       |
| One app locally                   | `pnpm --filter @asterism/frontend dev` or backend equivalent     | Package script invokes root launcher; root file required                                                       |
| Build/checks                      | Root scripts → pnpm workspace package scripts                    | File optional where the command can use safe defaults/injected values; environment behavior verified in SP-9.3 |
| Frontend codegen                  | Frontend package script through root launcher                    | Root file required because the backend endpoint is contacted                                                   |
| Unit tests                        | Package/root test scripts                                        | Developer file disabled; isolated injected fixtures/defaults                                                   |
| E2E                               | Frontend script/Playwright web server                            | Isolated injected fixture; never developer databases                                                           |
| Database initialize/reset/migrate | Dedicated package/root maintenance command through launcher      | Root file or complete injected environment; validation before mutation                                         |
| Docker Compose                    | Compose interpolation/injection                                  | Root file handled by Compose, not the local launcher                                                           |
| Direct container                  | `docker run --env-file` or explicit environment                  | Container entrypoint receives injected values; no repository file required                                     |
| CI                                | Workflow-injected test settings                                  | No dotenv file required; mprocs not required                                                                   |

Raw `next`, `uvicorn`, `python -m`, and auth CLI commands that bypass documented
package/maintenance entrypoints are unsupported for local dotenv loading. They remain
usable when callers inject a complete environment themselves.

## Inventory of current consumers and entrypoints

### Configuration consumers

- Frontend server/auth: `PUBLIC_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_DB_PATH`,
  `STORAGE_ROOT`, `ADMIN_PASSPHRASE`, and `SYSTEM_KEY`.
- Backend Pydantic settings: `PUBLIC_URL`, `SYSTEM_KEY`, `STORAGE_ROOT`, `DB_URL`,
  CORS/tool settings, plus `/run/secrets` support.
- Compose/container: public origin and three required secrets; container storage is
  fixed to `/storage` unless explicitly changed at direct runtime.
- Turbo: seven shared variables are currently duplicated in `globalEnv` and
  `globalPassThroughEnv`; root `.env` is a global file dependency.
- Test/build tools: Playwright reads `CI`; Docker's frontend build injects temporary
  auth settings; frontend scripts pass inherited environments to child tools.

### Current executable paths

- Root: `dev`, `build`, `lint`, `test`, `typecheck`, `sync`, `reset:db`, and local CI helpers.
- Frontend: dev/build/start, lint, unit/watch/E2E tests, typecheck, codegen, and auth reset.
- Backend: dev/start, lint/test/typecheck, sync, and database reset.
- Other: documented direct auth/backend initialization, Docker build/entrypoint,
  Compose, GitHub Actions, Playwright's direct Next.js web server, and Docker smoke tests.

Current bypasses and defects are tracked in the epic: frontend shell parsing, backend
CWD-relative loading, stale framework-local files, reset ordering, and documentation
conflicts.

## Prototype evidence

Tests were run on macOS with mprocs 0.9.6, uv 0.12.13, Turbo 2.10.11, installed
Node 26.8.2, and an exact Node 22.13.0 invocation (the repository minimum).

### Parser and precedence fixture

The fixture covered CRLF, comments, spaces, quotes, `#`, `=`, `$`, empty values,
`export`, escaped newlines, multiline quoted values, and an inherited override.

- Node 22.13 and 26 preserved the inherited override, parsed quoted spaces/comments,
  preserved `=` in values, accepted CRLF/empty/export/multiline values, interpreted
  `\n` in double quotes, and kept `$HOME` literal.
- `uv run --env-file` preserved inherited values but expanded `$HOME`. It is therefore
  not equivalent to Node's parser and is not selected as the shared parser.
- The current frontend shell wrapper emitted identifier errors, split quoted values,
  retained carriage returns, overwrote the inherited value, and corrupted comments.
- Node 22.13 supports both `--env-file`, `--env-file-if-exists`, and
  `process.loadEnvFile`. A missing optional file continued with a diagnostic.

### Next.js dotenv precedence fixture

The installed Next.js 16.2.7 environment loader used this development order:
`.env.development.local`, `.env.local`, `.env.development`, `.env`. In test mode it
skipped `.env.local` but loaded `.env.test.local`, `.env.test`, then `.env`. Existing
process values won over every file. Next also expanded references such as `$BASE`.
This confirms that inherited root values are stable but stale app-local files can
still inject undeclared values, so explicit stale-file rejection is required.

### mprocs fixture

A temporary `mprocs.yaml` with two commands proved that mprocs 0.9.6:

- passes inherited values to both processes;
- honors distinct `<CONFIG_DIR>`-relative working directories;
- can stop a shell process and its deliberately managed descendant on remote `quit`;
- retains the original inherited value after the dotenv file changes and a pane is
  restarted (`old`, `old`), confirming that the root launcher must be restarted.

The implementation must still test real pnpm → Next.js and pnpm → uv process trees;
the synthetic shell explicitly trapped termination, so it does not prove all real
wrapper descendants clean themselves up.

### Turbo fixture

Turbo dry-run reported strict environment mode. Root `.env` content contributes to
the global cache hash, but the seven configured variables were absent from the shell
and thus had no configured values: Turbo tracks/passes names but does not load the
file. The current frontend loads it only after Turbo starts. The entire root file
currently invalidates every task, including changes to runtime-only secrets. SP-9.3
must narrow this policy.

## Portable dotenv grammar

Use Node's parser as the local canonical parser. Until SP-9.3 verifies Compose and
`docker run --env-file` parity, the guaranteed cross-path subset is intentionally
conservative:

- UTF-8 file with blank lines and full-line comments;
- identifiers matching `[A-Za-z_][A-Za-z0-9_]*`;
- one `KEY=VALUE` assignment per line;
- empty values and `=` inside a value are allowed;
- no `export`, variable references/interpolation, multiline values, or command syntax;
- values containing whitespace or `#` require quoting for local Node parsing, but
  deployment parity must be confirmed before promising those forms for every path.

The future validator should reject unsupported syntax rather than let parsers derive
different secrets. `$` is literal in Node but expanded by uv/Next/Compose-style
parsers, so variable references and dollar-bearing values are not portable yet.
SP-9.3 owns the final deployment grammar decision.

## Alternatives considered

### Remove Turbo and use pnpm for finite tasks

Selected after maintainer review. This does not load dotenv by itself, but caching,
cross-package ordering, and concurrency are not required. A dedicated story keeps
the bounded migration explicit across scripts, CI, Docker, documentation, and the
lockfile.

### Retain Turbo for build/checks

Initially selected to minimize migration, then rejected by the maintainer because its
task graph and cache provide no needed behavior in the current repository.

### Turbo for local dev

Not selected. It can run persistent tasks but provides a less convenient two-process
interactive UI and adds strict-environment/cache concerns to a task that is never cached.

### uv as the root loader

Rejected as canonical loader because its `$` expansion differs from Node and it couples
frontend-only command launching to Python tooling. It remains the backend package runner.

### Framework-native loading only

Rejected. Next and Pydantic resolve files and variants differently and cannot guarantee
one root source across arbitrary working directories.

### Shell sourcing or symlinking app files

Rejected. Shell execution is unsafe and not portable dotenv parsing. Copies/symlinks
allow framework-specific precedence and recreate drift.

### New dotenv CLI dependency

Deferred. A maintained CLI could reduce launcher code, but none enforces ADR-0011's deliberately
small cross-runtime grammar. Add a dependency only if implementation tests show that
robust cross-platform signal/exit handling cannot be achieved with the repository
launcher.

## Consequences and follow-up

- Developers install mprocs for the interactive root dev command; a documented
  non-interactive alternative starts either app separately.
- Build/check commands move to pnpm workspace scripts; SP-9.3 verifies environment
  inheritance, failure propagation, and file-free CI/container execution.
- Application-local dotenv files become migration blockers rather than fallback sources.
- The launcher becomes security-sensitive infrastructure and needs unit/integration tests.
- SP-9.2 defines variable-level validation, source reporting, `/run/secrets` precedence,
  and migration safety.
- SP-9.3 finalizes portable deployment syntax and Turbo cache scoping.
- US-9.5 removes Turbo first; US-9.1 implements the shared launcher and mprocs flow.
  No runtime code was changed by SP-9.1.
