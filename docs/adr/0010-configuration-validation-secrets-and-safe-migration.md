# ADR-0010: Configuration validation, secret boundaries, and safe migration

- **Status:** Accepted
- **Date:** 2026-09-16
- **Spike:** SP-9.2
- **Decision owners:** Asterism maintainers

## Context

Asterism is consolidating app-local dotenv files into one repository-root local
configuration source. Consolidation can accidentally rotate auth secrets, point a
command at another database, expose a server secret, or turn an initialization
command into a destructive reset. Configuration validation must therefore be
command-specific, side-effect-free, redacted, and compatible with injected production
environments.

This spike inspected tracked source and templates only. Actual dotenv values and
actual configured databases were not read or modified.

## Decision

Subject to approval:

1. Introduce a shared configuration contract with separate server-side adapters for
   Node and Python. Parsing/loading remains owned by ADR-0009; validation produces
   equivalent results in both runtimes for shared variables.
2. Separate **pure parsing and validation** from resource initialization. Importing a
   config schema or running `config:check` must not create directories, open databases,
   contact JWKS endpoints, or initialize application services.
3. Validate for a named command profile (`development`, `production`, `auth-migrate`,
   `backend-init`, `reset`, `build`, or `test`) rather than requiring every variable
   for every command.
4. Use this precedence: explicit inherited process environment → root `.env` →
   canonical `/run/secrets` files → documented non-secret defaults. An explicitly
   present empty process value wins and then fails validation when the setting is
   required. This preserves the backend's effective Pydantic precedence while making
   the behavior available to the frontend.
5. Support file secrets only for `BETTER_AUTH_SECRET`, `SYSTEM_KEY`, and
   `ADMIN_PASSPHRASE`, using `/run/secrets/<UPPERCASE_NAME>`. Strip one terminal line
   ending. Do not print file contents. If legacy lowercase and canonical names coexist,
   fail as ambiguous rather than choosing silently.
6. Treat `BETTER_AUTH_SECRET`, `SYSTEM_KEY`, and `ADMIN_PASSPHRASE` as server-only.
   Never expose them through `NEXT_PUBLIC_*`, Next config `env`, React props, generated
   clients, browser responses, logs, or browser-delivered chunks.
7. Provide a non-mutating root `config:check` command. It reports setting name,
   classification, selected source category, and valid/invalid status only. It never
   reports values, lengths, hashes, credential-bearing URLs, or secret file contents.
8. Reject known example/build placeholders in runtime profiles. Production enforces
   strong minimums; migration reports weak legacy values without printing them and
   requires an explicit remediation decision. Never silently generate or rotate a
   persistent secret.
9. Replace ambiguous initialization/reset entrypoints with separate non-destructive
   migration/initialization and explicitly destructive reset commands. A reset validates
   and displays redacted/canonical targets before requiring confirmation.
10. Migrate existing installations manually with conflict detection, backups, target
    comparison, a smoke test, and rollback. Automation may identify `same`, `different`,
    `missing`, or `placeholder` per key but must not choose a conflicting value, overwrite
    a dotenv file, move/delete a legacy file, or rotate a secret.

## Variable catalog

### Application settings

| Variable              | Consumers                                                                   | Classification                     | Default                                            | Required profiles                                                               | Validation and notes                                                                                                                                                                                                                                                   |
| --------------------- | --------------------------------------------------------------------------- | ---------------------------------- | -------------------------------------------------- | ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PUBLIC_URL`          | Better Auth, backend JWT issuer/audience and CORS, Compose                  | Public server runtime              | `http://localhost:3000` in development only        | Production; auth migration should receive the deployed value                    | Absolute `http`/`https` origin only; no credentials, path other than `/`, query, fragment, or trailing slash. Require HTTPS in production except loopback development. Changing it invalidates JWT identity expectations.                                              |
| `BETTER_AUTH_SECRET`  | Better Auth frontend server                                                 | Secret                             | None                                               | Frontend/combined runtime and auth migration; synthetic value in isolated tests | Reject empty and known placeholders. Require at least 32 characters in production/new setup. Preserve existing value to retain auth integrity/sessions. Never needed by the Python backend.                                                                            |
| `SYSTEM_KEY`          | Frontend server actions/event endpoint and backend privileged user creation | Secret                             | None currently; must become none/required          | Frontend, backend, and combined runtime                                         | Reject empty/placeholders; require high-entropy 32+ character value for production/new setup. Both services must receive exactly the same value. Remove current request-header logging.                                                                                |
| `ADMIN_PASSPHRASE`    | Better Auth first-admin hook                                                | Secret                             | None                                               | Frontend/combined runtime while installation flow exists                        | Reject empty/placeholders; require 12+ characters for production/new setup. It remains capable of granting admin at signup, so retain privately and plan a separate lifecycle decision after installation.                                                             |
| `STORAGE_ROOT`        | Frontend auth DB default, backend DB/files default, container entrypoint    | Sensitive path, not secret         | `/storage` in container; no implicit local default | Development unless both DB paths are explicitly overridden; container runtime   | Canonical absolute path. Validation is non-mutating; startup may create it after validation. Check existing path/type or nearest existing parent and writability. Never print directory contents.                                                                      |
| `BETTER_AUTH_DB_PATH` | Better Auth and auth maintenance                                            | Sensitive path, not secret         | `<STORAGE_ROOT>/users.db`                          | Optional override                                                               | Canonical absolute filesystem path for runtime. Permit `:memory:` only in build/test. Reject directories and ambiguous URI/path forms. Resolve old relative values against the old frontend working directory during migration before writing an absolute replacement. |
| `DB_URL`              | SQLAlchemy backend and backend maintenance                                  | Sensitive; may contain credentials | `sqlite+aiosqlite:///<STORAGE_ROOT>/database.db`   | Optional override                                                               | Parse as a SQLAlchemy URL. SQLite runtime targets must resolve to an absolute file; remote URLs require an explicit supported-adapter decision. Diagnostics show scheme/host class only and redact user info, password, query, and path where sensitive.               |
| `PORT`                | Compose host binding only                                                   | Public deployment setting          | `3000`                                             | Optional Compose override                                                       | Integer 1–65535. If changed, `PUBLIC_URL` must represent the browser-facing origin/port. Do not inject it as an application-internal port.                                                                                                                             |

### Advanced backend settings

| Variable                  | Current default           | Validation                                                                                    | Classification           |
| ------------------------- | ------------------------- | --------------------------------------------------------------------------------------------- | ------------------------ |
| `MAX_CHARS_FOR_RETRIEVAL` | `50000`                   | Positive bounded integer; select an upper bound during implementation based on runtime limits | Non-secret tuning        |
| `CORS_ALLOWED_ORIGINS`    | Derived as `[PUBLIC_URL]` | JSON list of absolute origins using the same origin rules; no wildcard with credentials       | Public security policy   |
| `DEFAULT_ALLOWED_TOOLS`   | Three built-in tool names | JSON list of non-empty unique registered identifiers; retain default factory                  | Public capability policy |

`NODE_ENV`, `CI`, `NEXT_TELEMETRY_DISABLED`, and `BETTER_AUTH_TELEMETRY` are tool/runtime
controls, not application configuration. Tests may set them explicitly but they do not
belong in the shared local template unless operational documentation requires them.
Internal frontend/backend loopback URLs remain code-level topology, not environment
variables.

## Command validation matrix

| Command profile      | Required configuration                                                                                              | Must not happen during validation                                                 |
| -------------------- | ------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `development`        | Three server secrets, valid `PUBLIC_URL`, and valid resolved auth/backend storage targets                           | No directory/DB creation; no network calls                                        |
| `production`         | Same as development with production URL and strength rules; environment/file-only operation allowed                 | No local dotenv requirement; no secret values in errors/logs                      |
| `auth-migrate`       | Auth DB target, persistent `BETTER_AUTH_SECRET`, deployed `PUBLIC_URL`; other secrets not needed to alter schema    | No reset; no `auth@latest`; no DB deletion                                        |
| `backend-init`       | Backend DB target and storage/file target                                                                           | No deletion of an existing DB; no auth DB access                                  |
| `reset`              | Explicit selected component targets plus valid target-specific settings                                             | No deletion before target display and confirmation; no remote DB reset by default |
| `build`              | No real credentials or persistent DB; config-dependent code must be lazy or accept isolated synthetic build context | No real DB/file creation and no developer dotenv fallback in CI                   |
| `test`               | Test-owned synthetic secrets and temporary/in-memory DB targets                                                     | No developer dotenv, storage, network service, or production DB access            |
| `lint` / `typecheck` | None                                                                                                                | No config imports with side effects                                               |
| `codegen`            | No local secret in the codegen process; a separately started backend supplies OpenAPI                               | No secret embedding in generated client                                           |

A single-app command validates only its consumer's requirements. The root full-stack
command validates the union and confirms that shared values are passed unchanged to
both children.

## Validation behavior and diagnostics

### URLs and paths

- Parse URLs structurally; do not validate with prefix/substring checks.
- Normalize origins for comparison but do not silently rewrite persisted configuration.
- Resolve paths before resource creation. Refuse relative runtime paths after migration.
- Never include a raw `DB_URL` in diagnostics because it may contain credentials.
- Check configuration first, then perform filesystem creation in an explicit startup
  phase. The current Python `Config` validator calls `mkdir`, and Better Auth opens its
  SQLite database at module import; both must be made lazy or moved behind startup.

### Secrets

- Errors name the variable and remediation, for example:
  `BETTER_AUTH_SECRET: invalid (replace example placeholder; value redacted)`.
- Known placeholders include values shipped in `.env.example` and Docker build-only
  sentinels. Build/test profiles may use explicitly scoped synthetic values that are
  never accepted by runtime profiles.
- Do not report secret length or hash. Hashes of human passphrases provide an offline
  guessing oracle and are unnecessary for conflict reporting.
- Compare frontend/backend/root candidates in memory and report only same/different.
- Restrict root dotenv permissions to the owner where supported (`0600` recommended);
  permission findings are warnings on platforms that cannot enforce POSIX modes.

### Source reporting

`config:check` may report only these source labels: `process`, `root-dotenv`,
`file-secret`, `default`, or `missing`. To preserve source information after loading,
the launcher should retain metadata internally or invoke validation before merging;
it must not export a client-visible source map containing secret values.

## Secret boundary findings

- All current frontend uses of the three secrets are in server modules/routes/actions;
  no `NEXT_PUBLIC_*` secret exists.
- `apps/frontend/src/app/api/stream/route.ts` currently logs the supplied system-key
  header on authorization failure. This is a direct credential disclosure and must be
  removed in US-9.2 with a regression test.
- Better Auth is instantiated at module import and opens the configured SQLite DB. This
  explains the Docker build placeholder and prevents pure validation/build behavior.
- The backend creates `STORAGE_ROOT` while constructing global config at import. Its
  `files_root` computed field can also mutate the filesystem when accessed.
- Backend `/run/secrets` support currently applies only to fields defined by Python
  settings and accepts case-insensitive names. The shared contract narrows this to
  canonical uppercase secret filenames with ambiguity detection and extends equivalent
  fallback behavior to the frontend/container path.

### Leakage regression design

Use unique synthetic canaries for each secret and assert they are absent from:

1. configuration errors and command stdout/stderr;
2. HTTP error bodies and unauthorized-request logs;
3. browser responses and client assets under `.next/static`;
4. generated OpenAPI/client output; and
5. Docker build output/history checks addressed by SP-9.3.

Server-only chunks may necessarily contain environment access logic, so tests must
inspect browser-delivered artifacts rather than claiming that every server artifact
contains no runtime secret. Tests must never use real secrets.

## Safe migration runbook design

US-9.3 will publish the final commands, but the required sequence is:

1. Stop all Asterism processes and prevent automatic container restart during migration.
2. Record the current code/image version. Back up both databases, uploaded files, and
   every existing dotenv file to an owner-readable location outside all app/root
   auto-loading paths. Verify backups before proceeding.
3. Run a read-only conflict inventory. For each known variable, report source presence
   and `same`/`different`/`placeholder` only. Unknown variable names are listed for
   manual classification; values are never shown by the tool.
4. Resolve every conflict manually. Keep the deployed `BETTER_AUTH_SECRET`,
   `SYSTEM_KEY`, `ADMIN_PASSPHRASE`, `PUBLIC_URL`, and database destinations unless a
   separately planned rotation/move is intended. Do not merge by frontend/backend
   priority.
5. Convert relative legacy DB paths to canonical absolute paths using their **old app
   working directory**. Compute and review the resulting auth DB path and redacted
   backend target before creating the root file.
6. Create root `.env` with restrictive permissions using the root example as a key
   guide. Do not copy comments/shell syntax blindly and never overwrite an existing
   root file.
7. Run non-mutating `config:check` and compare resolved storage/database targets with
   the pre-migration inventory. A difference blocks startup until explicitly accepted.
8. Move legacy app-local dotenv files manually to the external backup location. Do not
   rename them to another `.env*` filename inside an app because framework loaders or
   stale-file detection may still see them. Automation never deletes them.
9. Start services, verify health/JWKS, sign in with an existing account, exercise a
   backend-authenticated request and system-key event path, and verify existing data
   and uploads. Do not use reset commands as a migration test.
10. Retain backups through an agreed verification period. Roll back by stopping the
    services, restoring the previous code/image and original configuration locations,
    restoring databases only if the new version mutated them, and restarting with the
    unchanged secrets.

Weak legacy persistent secrets create a deliberate stop: preserve them for rollback,
then choose between a documented temporary migration allowance or planned rotation.
Rotating `BETTER_AUTH_SECRET` may invalidate sessions and must never be an automatic
side effect of dotenv consolidation.

## Destructive-command design

Current behavior is unsafe:

- backend `init_db` always deletes a SQLite database before recreating it;
- root reset runs backend then frontend, allowing a partial reset;
- frontend reset derives its target before loading the requested file, sources shell
  syntax, and invokes unpinned `auth@latest`;
- `init.sh` deletes developer-specific absolute paths before invoking reset;
- an existing frontend test references a missing `reset-db.mjs`, showing command/test
  drift.

Implementation requirements:

1. Name non-destructive schema setup/migration separately from `reset`.
2. Refuse to reset non-SQLite/remote URLs by default. Supporting a remote reset requires
   a future adapter-specific design and separate explicit authorization.
3. Build a complete reset plan before mutation: canonical auth DB, backend DB, sidecars,
   and whether each exists. Refuse ambiguous paths, directories, unsupported URI forms,
   symlinks escaping an allowed target policy, filesystem roots, and protected paths.
4. Display only canonical filesystem targets and redacted DB descriptors. Require an
   interactive exact confirmation for human use. Non-interactive tests require both a
   dedicated flag and disposable-root guard; CI never receives production targets.
5. Stop running services, create verified backups or require an explicit no-backup
   acknowledgment, and delete only after all target validation succeeds. Document that
   two databases cannot be atomically reset and provide recovery for partial failure.
6. Use the bundled, lockfile-pinned Better Auth CLI and backend environment, never
   `npx ...@latest`.
7. Test cancellation, invalid config, path changes, external overrides, sidecars,
   symlinks, partial failure, and non-SQLite targets exclusively with temporary data.

## Alternatives considered

### Validate only inside each framework

Rejected. Framework validation occurs at different times, has different dotenv rules,
and currently performs resource initialization during import.

### Require all values for every command

Rejected. Lint, typecheck, builds, and isolated tests should not need production
credentials. Over-validation encourages fake persistent values and secret leakage.

### Automatically merge app-local files

Rejected. There is no safe general precedence for conflicting secrets or database
paths. Even showing hashes/lengths adds unnecessary disclosure.

### Automatically generate missing secrets

Rejected for migration/runtime. Regeneration can invalidate authentication and break
cross-service privileged calls. A separate first-install command may generate new
values only when all persistent targets are demonstrably fresh and the user requests it.

### Prefer `/run/secrets` over explicit environment/root dotenv

Rejected to preserve explicit operator override and current Pydantic effective
precedence. Production should not ship a root dotenv file, making file secrets the
natural fallback there.

## Consequences and follow-up

- US-9.2 implements pure schemas, profile validation, redacted checks, lazy resource
  initialization, canonical file-secret behavior, and leakage tests.
- US-9.3 implements the migration runbook and safe maintenance commands.
- SP-9.3 verifies Compose/container dotenv grammar and image/log leakage behavior.
- Validation becomes stricter for runtime but lighter for build/test/check commands.
- Existing weak or conflicting configurations require an explicit maintainer decision;
  the migration will not silently preserve insecurity or silently break compatibility.
- No OpenAPI change is expected from this ADR.
