# Clean development initialization and reset

The backend initializes the current model schema with `Base.metadata.create_all`
and installs chat/project FTS5 indexes and triggers. It does not migrate an older
backend schema. Better Auth independently uses its pinned official CLI to initialize
and maintain the authentication schema. This distinction applies to local and
container startup.

## Initialize without deleting data

From the repository root, after installing dependencies and configuring the root
`.env`:

```bash
pnpm --filter @asterism/backend init:db
pnpm --filter @asterism/frontend migrate:db
```

Backend initialization creates missing tables, storage directories, search indexes,
and default settings. It does not upgrade incompatible existing tables. Do not use
initialization as a substitute for an intentional reset after a breaking schema
change. Container startup runs both initializers each time without deleting data.

## Reset disposable application data

Stop `pnpm dev`, standalone frontend/backend workers, and any container using the
same storage before resetting. Close other database clients. Preserve any data you
need separately; reset is destructive and is not a transactional backup/restore.

1. Review `STORAGE_ROOT`, optional `DB_URL`, and optional `BETTER_AUTH_DB_PATH` in
   the environment/root `.env`. Process environment takes precedence over `.env`.
   SQLite paths must be absolute. An override can select a database outside
   `STORAGE_ROOT`; it does not relocate the files and extraction directories.
2. Run the root command, which validates configuration and prints resolved targets:

   ```bash
   pnpm reset:db
   ```

3. Verify all four targets: authentication database, backend database, original
   files, and extraction storage. Type `RESET` only when they are the intended
   disposable development targets. A noninteractive invocation cancels unless
   `--yes` is explicitly supplied. For an already reviewed scripted target:

   ```bash
   pnpm reset:db -- --yes
   ```

4. The coordinator resets the backend first, then authentication. A failure stops
   the sequence; prior deletions are not rolled back. Resolve the reported failure
   before restarting. After success, start `pnpm dev`, sign in/register again, and
   repeat first-time administrator and provider configuration. Relational provider
   settings are reset even though downloaded model bundles remain on disk.

The root wrapper is the intended full reset entrypoint. The backend-only reset
leaves authentication accounts behind; use it only when deliberately managing
those independent stores. Do not invoke internal `reset:db:confirmed` commands
manually to bypass target review.

## Removed and retained paths

| Target                                                      | Reset behavior                                                                                           |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Backend `DB_URL`, default `STORAGE_ROOT/database.db`        | Delete SQLite file and `-wal`, `-shm`, `-journal` sidecars; create fresh model schema and search indexes |
| Auth `BETTER_AUTH_DB_PATH`, default `STORAGE_ROOT/users.db` | Delete selected database and sidecars; initialize using pinned Better Auth CLI                           |
| `STORAGE_ROOT/files`                                        | Remove original uploaded bytes, including sharded source keys                                            |
| `STORAGE_ROOT/knowledge`                                    | Remove derived extraction/vector storage                                                                 |
| `STORAGE_ROOT/themes`                                     | Preserve administrator-created themes and bundled-palette overrides                                      |
| `STORAGE_ROOT/models/knowledge-clip`                        | Preserve reusable embedding model bundle                                                                 |
| `STORAGE_ROOT/models/captioning-smolvlm2`                   | Preserve reusable local caption model bundle                                                             |

Bundle integrity is still verified when providers load them. Preserving bytes does
not enable captioning, restore provider credentials, or waive model verification.
Theme reset is separate: stop the app and remove only the reviewed `themes` directory
when explicitly desired; see [theme lifecycle](theme-storage.md#permissions-backup-and-reset).
Do not delete `STORAGE_ROOT` or run `docker compose down -v` as a substitute when
model-bundle retention is required. For container-backed development, stop the
container and use an environment/dependency setup that resolves the same mounted
targets; host paths and container paths can differ. Review the printed targets.

## Verification without touching the working database

The existing tests use temporary roots, SQLite files, source/vector canaries, and
model canaries to check fresh initialization, reset removal, and bundle retention:

```bash
node scripts/run-with-env.mjs --env none --scope backend --profile test -- \
  uv run --directory apps/backend pytest -q tests/test_init_db.py
pnpm test:config
```

Configuration tests also verify cancellation preserves selected databases.
`node scripts/run-isolated-e2e.mjs` creates its own temporary auth/backend/file/vector
state and removes it afterward. It neither loads the developer `.env` nor resets
the working data. See [scripts](../../scripts/README.md) and
[backend initializer](../../apps/backend/asterism/db/init_db.py).
