# Repository Scripts

These Node.js scripts support configuration loading, validation, CI checks, database
maintenance, and isolated tests. Run commands from the repository root unless noted
otherwise. Use the corresponding pnpm command when one is available; package scripts
provide the intended configuration profile and environment scope.

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

Configuration is validated by `run-with-env.mjs` before this script runs. Back up any
data that must be retained.

### `run-isolated-e2e.mjs`

Creates a unique temporary directory, generates synthetic test secrets, migrates a
temporary Better Auth database, runs the frontend Playwright suite, and removes all
temporary state in a `finally` block. It does not load developer dotenv files or use
repository/production databases.

```bash
node scripts/run-isolated-e2e.mjs
# Included in:
pnpm ci:local:e2e
```

`RUNNER_TEMP` is used when available; otherwise the operating-system temporary
directory is used.

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
