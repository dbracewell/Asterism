# ADR-0011: pnpm, Docker, and CI configuration parity

- **Status:** Accepted
- **Date:** 2026-09-16
- **Spike:** SP-9.3
- **Decision owners:** Asterism maintainers

## Context

ADR-0009 selected mprocs for interactive development and, after maintainer review,
pnpm workspaces for finite tasks. ADR-0010 selected one local root dotenv source,
command-specific validation, environment-only production/CI operation, and a portable
secret boundary. This ADR verifies the remaining pnpm, Docker, Compose, and CI behavior
before implementation stories begin.

No real dotenv value was read or printed during this spike. Parser tests used temporary
dummy files. The existing local image smoke test used newly generated disposable
secrets, a disposable account, container, and volume.

## Decision

Subject to approval:

1. Remove Turbo in US-9.5. Use explicit pnpm workspace commands for finite tasks.
   Root scripts name the expected workspaces rather than relying on caching, dependency
   ordering, or implicit task discovery.
2. Use mprocs only for interactive local development. CI and containers remain
   non-interactive and do not require mprocs.
3. Do not load the developer root `.env` for lint, typecheck, build, or unit tests.
   After eager configuration/resource imports are removed, these commands use no real
   credentials. Tests receive command-scoped synthetic values and temporary paths.
4. Continue excluding all real `.env*` files from the Docker build context. Docker
   builds must succeed without a root dotenv file and must never accept runtime secrets
   as build arguments. Build-only synthetic settings are removed when lazy auth/config
   initialization makes them unnecessary.
5. Support both Compose and direct `docker run --env-file .env` from the one root file
   only through the strict portable grammar below. Reject syntax whose values differ
   among Node, Compose, and Docker rather than documenting parser-specific surprises.
6. Keep container topology fixed: `/storage`, frontend/nginx port 3000, Next.js loopback
   3001, and backend loopback 8000. Compose `PORT` changes only the host binding;
   `PUBLIC_URL` remains the browser-facing origin and is runtime configuration.
7. A production container accepts explicit environment variables and canonical
   `/run/secrets/<UPPERCASE_NAME>` files without any dotenv file. Environment wins over
   file secrets. The entrypoint validates before migrations or storage mutation.
8. Scope secrets by child process where practical. The frontend receives all three
   server secrets; the backend receives `SYSTEM_KEY` but not Better Auth/admin secrets.
   Build/check processes receive none. The combined entrypoint necessarily performs
   validation before spawning but must not log values.
9. Keep the two required GitHub status checks and make their fixtures hermetic. CI
   asserts that no dotenv file exists, uses unique temporary databases/storage, and
   supplies only synthetic command-required settings.

## pnpm execution policy

### Root scripts

Use explicit workspace scripts so a missing expected script is visible in review and
regression checks:

```text
build      -> pnpm --filter @asterism/frontend build
lint       -> pnpm --filter @asterism/backend lint
              then pnpm --filter @asterism/frontend lint
typecheck  -> pnpm --filter @asterism/backend typecheck
              then pnpm --filter @asterism/frontend typecheck
test       -> pnpm --filter @asterism/backend test
              then pnpm --filter @asterism/frontend test
```

Sequential `&&` execution is acceptable because the maintainer explicitly does not
require concurrency or cross-package ordering. It provides simple fail-fast behavior.
Focused commands remain `pnpm --filter <workspace> <script>`. Root `dev` is reserved for
the ADR-0009 loader → mprocs flow; single-app development uses focused package scripts.

A lightweight regression check should parse root/package scripts and fail if an
expected workspace/task is absent. US-9.5 also removes `turbo.json`, the Turbo package
and lockfile entries, `.turbo` configuration, Docker/CI invocations, and active
repository guidance. Historical ADR/epic references may remain clearly historical.

### Prototype evidence

A temporary two-package pnpm 11.17 workspace proved:

- a parent `MARKER` value reached both recursive workspace scripts unchanged;
- `--filter` selected only the requested package; and
- a package exit status of 7 made pnpm exit 7 while another already-started package
  completed.

pnpm does not filter inherited environment variables. This is simpler than Turbo but
means secret minimization must occur in the launcher/CI command, not in pnpm. The final
root scripts do not need dotenv and should inherit only their caller's intentionally
injected environment.

## Portable dotenv grammar

### Verified incompatibilities

A temporary fixture produced materially different values:

| Syntax                  | Node 26 built-in loader | Compose 5.5.1 interpolation | Docker 29.8 `--env-file`               |
| ----------------------- | ----------------------- | --------------------------- | -------------------------------------- |
| `SPACE="hello world"`   | `hello world`           | `hello world`               | includes quote characters              |
| `HASH=before # comment` | `before`                | `before`                    | `before # comment`                     |
| `DOLLAR=$HOME`          | literal `$HOME`         | expands host `HOME`         | literal `$HOME`                        |
| `DOLLAR='$HOME'`        | literal `$HOME`         | literal `$HOME`             | includes single quotes                 |
| `ESCAPED="line\nnext"`  | newline                 | newline                     | includes quotes and backslash sequence |

Therefore “dotenv” is not one portable language. Direct Docker and Compose cannot
safely consume arbitrary Node-compatible dotenv syntax as the same file.

### Guaranteed shared subset

The configuration validator will accept only:

- UTF-8 text with LF or CRLF endings;
- blank lines and full-line comments whose first non-whitespace character is `#`;
- keys matching `[A-Za-z_][A-Za-z0-9_]*`;
- exactly one `KEY=VALUE` assignment per non-comment line;
- no whitespace around the key, `=`, or value;
- unquoted, single-line values containing printable characters except whitespace,
  `#`, `$`, single/double quotes, backticks, and backslashes;
- empty values syntactically, though required settings reject them semantically;
- additional `=` characters within the value.

A CRLF fixture with bare URL and base64-style values (`+/=_-.`) produced identical
values in Node, Compose, and direct Docker. The example secrets should use URL-safe or
base64 output compatible with this subset. Paths containing whitespace are unsupported
in the shared file; use an injected environment or choose a whitespace-free local
storage path.

Do not support `export`, interpolation, multiline values, inline comments, or shell
syntax. A future decision may drop direct `docker run --env-file` compatibility and
widen the local grammar, but implementation must not do so silently.

## Docker and Compose contract

### Build boundary

`.dockerignore` excludes `**/.env` and `**/.env.*` while allowing examples. A synthetic
Dockerfile attempting `COPY .env` failed with `CopyIgnoredFile` and “not found,” proving
the actual ignored root file was not sent as a copyable build input. The built image
contained no `.env*` file under `/app`, and its configured environment contained only
non-secret runtime defaults such as `STORAGE_ROOT=/storage`.

US-9.5 replaces the Docker frontend Turbo command with a focused pnpm build and stops
copying `turbo.json`. US-9.2/US-9.4 remove the current build-only Better Auth secret and
`:memory:` database workaround after auth creation becomes lazy. Runtime secrets must
never be supplied via `ARG`, build `ENV`, secret-bearing cache keys, or `RUN` text.

### Runtime boundary

Compose continues to map only public origin and required runtime secrets. It must not
pass the host's absolute `STORAGE_ROOT` into the container; `/storage` remains backed by
the named volume. `PORT` maps `127.0.0.1:<PORT>` to container port 3000 and is not an
internal service port.

The existing `asterism:local` image
`sha256:89de123ebd1e5b6a51173e49ebe3a7994b7fff6aaf1b566970952f3b38400a47`
passed `docker/smoke-test.py` with no dotenv file and randomly injected environment
secrets. The test verified proxy routing, runtime JWT issuer/audience from a deliberately
unresolvable `PUBLIC_URL`, existing-session/signing-key persistence after restart,
graceful shutdown, and whole-container failure when one service exits. This demonstrates
that `PUBLIC_URL` is currently runtime-selectable without rebuilding that image.

US-9.4 extends the smoke matrix to run one built image with two distinct runtime public
origins and to exercise environment and mounted-file-secret modes. It also checks a
synthetic canary against build logs, image history/config, browser assets, and runtime
logs. It must inspect actual browser-delivered assets rather than treating all server
chunks as public.

## Hermetic CI design

### Quality-gates job

1. Assert root and app-local dotenv files are absent in the checkout.
2. Install pinned dependencies as today, including native `better-sqlite3` verification.
3. Run root `lint`, `typecheck`, and `test` pnpm scripts without loading dotenv.
4. Unit tests that need config receive per-test synthetic values and temporary paths;
   backend tests instantiate settings with `_env_file=None` until implicit file loading
   is removed entirely.
5. Set a test-owned temporary storage root that is deleted afterward, and assert no
   `/storage`, repository DB, or configured external path was created or changed.
6. Run config parser/validator fixtures for precedence, redaction, portable grammar,
   missing files, and unsupported syntax. Use canaries only, never real secrets.

### Frontend E2E job

1. Create a unique directory under the runner's temporary directory.
2. Inject synthetic `BETTER_AUTH_SECRET`, `SYSTEM_KEY`, and `ADMIN_PASSPHRASE`, local
   `PUBLIC_URL`, absolute `BETTER_AUTH_DB_PATH`, and `STORAGE_ROOT` for that invocation.
3. Start Playwright's frontend server without reading developer/root dotenv. If backend
   interaction becomes part of E2E, start a test backend with its own temporary DB and
   the same synthetic `SYSTEM_KEY`.
4. Disable reuse in CI, clean only the unique temporary directory, and verify it is the
   sole location mutated. Never run `rm` against a configuration-derived production path.

### Container checks

Docker builds from a context with no dotenv dependency. Container smoke tests generate
new secrets and disposable storage. Add a preflight assertion that the selected image,
container, and volume names are test-owned before cleanup. Preserve the existing status
check names:

- `CI / Lint, Typecheck, Test`
- `CI / Frontend E2E (Playwright)`

A full image smoke test may remain a separate/local release gate if CI duration exceeds
the existing 20-minute jobs, but the Dockerfile build path and secret-boundary tests
must still be automated at an appropriate gate.

## Alternatives considered

### Keep Turbo for finite tasks

Rejected by maintainer decision. Its cache, ordering, and concurrency are not needed,
and its strict environment layer adds no value after explicit command scoping.

### Use `pnpm -r --if-present` for every finite task

Not selected for the two-app root scripts. It is concise but silently skipping an
expected script is less explicit. It remains useful for ad hoc commands or future
package growth after a separate policy change.

### Let each runtime parse the same broad dotenv syntax

Rejected by executable evidence. Quoting, comments, escapes, and dollar expansion
produce different secret bytes across Node, Compose, and Docker.

### Stop supporting direct `docker run --env-file`

Deferred. Doing so would permit a broader Node/Compose-oriented grammar, but the current
README supports direct Docker and the strict subset is adequate for existing settings.

### Put test settings in a checked-in `.env.test`

Rejected. Next auto-load behavior and accidental fallback make checked-in test dotenv
files another implicit source. Test harnesses should inject explicit isolated fixtures.

## Consequences and follow-up

- SP-9.3 removes the need for a Turbo cache/environment policy from later stories.
- US-9.5 performs the bounded Turbo-to-pnpm migration first.
- US-9.1 implements and tests the strict parser/launcher and mprocs path.
- US-9.2 applies command profiles and removes build/test import side effects.
- US-9.4 aligns container file secrets, process scoping, CI fixtures, runtime-origin
  smoke tests, and canary leakage checks.
- The strict shared grammar trades convenience for byte-for-byte portability. Invalid
  syntax fails before any app or destructive command starts.
