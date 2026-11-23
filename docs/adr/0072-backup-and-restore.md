# ADR-0072 — Backup and restore

Status: accepted and implemented for US-86.4 on 2026-11-18
([EPIC-86](../epics/EPIC-86-MULTI-USER-DEPLOYMENT-READINESS.md)). Builds on
[ADR-0069](0069-versioned-schema-migrations.md), whose way back from an upgrade
is restoring a backup.

## Context

An instance keeps its data in two SQLite databases (Better Auth's `users.db` and
the backend's `database.db`), the file store, a LanceDB vector table and custom
themes, all under the storage root (the databases can be elsewhere). Copying the
directory while the app runs is not safe. SQLite keeps recent commits in a WAL
sidecar. LanceDB adds new data files and manifests as knowledge is processed, so
a copy can catch a manifest whose data files it missed. Classes use the app during
the day and an operator cannot always stop it.

## Decision

**One command, `python -m asterism.backup`, with `create`, `verify` and
`restore`.** It is wrapped by the container entrypoint (`backup`, `verify`,
`restore`) and by root package scripts (`pnpm backup`, `pnpm backup:verify`,
`pnpm restore`). The package script runs it with the backend's environment and
passes the Better Auth database path explicitly. The backend still never sees
the frontend's secrets.

**Snapshot order gives consistency without stopping the app.** The databases are
copied first with the SQLite online backup API in a single step. This is a read
transaction at one commit, and in WAL mode it does not block writers. Files and
vectors are copied after that, so every copied reference already existed. The file
store creates a file before its row is committed, so a file still being written can
only be an orphan. A file deleted in between is recorded as skipped. Cross-database
consistency is close to exact: the two snapshots are taken milliseconds apart, and
Better Auth and the backend only share user IDs. Memory vectors are the exception to
"every copied reference already existed": they are a cache, and each start rebuilds
any missing one and drops any without a memory
([ADR-0078](0078-long-term-memory.md), US-93.6).

**Vectors are exported, not copied.** Each LanceDB table is pinned to its current
version (`checkout`) and written to a fresh table in the archive. This drops old
versions. The export is held in memory; at the target size (one class) that is
tens of megabytes.

**Archive format.** A gzip tar with a fixed layout and `manifest.json` as its
last member. The manifest has the format version, schema revision, app version,
vector row counts, skipped files and the size and SHA-256 of every member. Writing
the manifest last means each file is read once. The archive is written to a hidden
partial file with mode `0600`, synced, then renamed into place.

**Restore checks everything before it changes anything.** Restore requires an
empty storage root and absent database files. It extracts only regular files with
safe paths in the known areas into a staging directory inside the root. Then it
checks the manifest: every member, no missing or extra files, and matching
checksums. It checks that the schema revision is known to this code and matches
the database inside; a newer revision is refused naming both. It also checks the
`SYSTEM_KEY` fingerprint, `PRAGMA integrity_check` on both databases and the vector
row counts. Only then does it move the data into place. After that it runs the
normal startup path: `init_db` applies pending migrations and the API's revision
check passes. In the container, Better Auth migrate runs too. `verify` runs the
same checks into a temporary directory.

**A `SYSTEM_KEY` fingerprint, not the key.** The manifest stores a truncated
HMAC of a fixed label under `SYSTEM_KEY`. Restoring with another key would leave
provider keys unreadable, so it is refused. Secrets are never in the archive, and
`BETTER_AUTH_SECRET` (which the backend does not see) is not checked.

**Not backed up:** model bundles (they are downloaded again) and LanceDB history.

## Consequences

- An operator can schedule backups with cron and roll back an upgrade by restore;
  the procedure is in [backup and restore](../architecture/backup-and-restore.md).
- A restore is offline and never merges into existing data. Restoring over an
  instance means removing its storage first, after `verify` passes on the archive.
- The archive contains all user data, password hashes and sessions; protecting it
  is the operator's job (mode `0600` only covers the host).
- US-86.6 can show the last backup time by reading the newest archive name or
  manifest; nothing records it in the database today.
- Archive format changes bump `format_version`; restore refuses formats it does
  not know.
