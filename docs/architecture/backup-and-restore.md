# Backup and restore

An admin can take a consistent backup while Asterism runs, check it, and restore
it into an empty storage root. The design is recorded in
[ADR-0072](../adr/0072-backup-and-restore.md); this page is the operator guide.

## What a backup contains

One archive, `asterism-backup-<UTC time>.tar.gz`, written with mode `0600`:

| Archive path | Source |
| --- | --- |
| `databases/users.db` | Better Auth database (`BETTER_AUTH_DB_PATH`, default `users.db` in the storage root) |
| `databases/database.db` | Backend database (`DB_URL`, default `database.db` in the storage root) |
| `knowledge/lancedb/` | Knowledge vectors, exported from one table version |
| `files/` | Uploaded and produced files |
| `themes/` | Custom themes |
| `manifest.json` | Format version, schema revision, `SYSTEM_KEY` fingerprint, size and SHA-256 of every other member |

Not included: downloaded model bundles under `models/` (Asterism fetches them
again) and old LanceDB table versions. **Secrets are not in the backup.** Keep
`SYSTEM_KEY` and `BETTER_AUTH_SECRET` separately; a restore needs the same values.
Restore refuses a different `SYSTEM_KEY`, because stored provider keys could not
be decrypted with it. A different `BETTER_AUTH_SECRET` cannot be checked and
makes the auth signing keys unreadable.

The archive holds every user's chats and files, password hashes and sessions.
Store it like the live data: on encrypted storage, readable only by operators.

## Consistency while the app runs

Both databases are copied first, each with SQLite's online backup in one step.
That is a read snapshot of one commit, and writers keep going (WAL). Files and
vectors are copied after that, so everything a copied row refers to already
existed. A file being written during the backup is not yet referenced by any
copied row. A file deleted between the snapshot and its copy is left out and
listed under `skipped` in the manifest. The vector table is pinned to its
current version and exported, rather than copied file by file while it changes.

Busy classes keep working during a backup. It costs disk reads and one CPU core
for compression, so schedule it outside lessons when you can.

## Commands

| Where | Back up | Check an archive | Restore |
| --- | --- | --- | --- |
| Container | `docker compose exec asterism /app/docker/entrypoint.sh backup [--keep N]` | `docker compose exec asterism /app/docker/entrypoint.sh verify /backups/<file>` | `docker compose run --rm asterism restore /backups/<file>` |
| Source checkout | `pnpm backup --output-dir <dir> [--keep N]` | `pnpm backup:verify <file>` | `pnpm restore <file>` |

- **backup** writes into `/backups` in the container (the `backups` volume in
  `docker-compose.yml`, or `BACKUP_DIR`), or into `--output-dir`. The directory must
  be outside the storage root. `--keep N` deletes all but the newest N archives
  there after a successful backup; it only touches files named
  `asterism-backup-<time>.tar.gz`. Only one backup runs at a time per directory.
- **verify** runs every restore check by unpacking into a temporary directory,
  then deletes it. It changes nothing.
- **restore** runs with the app stopped, into an empty storage root, and does
  not overwrite either database file. It checks every member against the manifest,
  the schema revision (a backup from a newer Asterism is refused, naming both
  revisions), the `SYSTEM_KEY` fingerprint, SQLite integrity and vector row
  counts. Only then does it move the data into place. After that it runs the
  normal startup path: pending backend migrations are applied, and Better Auth
  migrates its tables. A refused restore leaves the storage root empty.

## Schedule and retention

A nightly backup that keeps two weeks, from the host's crontab (`-T`: no TTY):

```cron
15 2 * * * cd /srv/asterism && docker compose exec -T asterism /app/docker/entrypoint.sh backup --keep 14 >> /var/log/asterism-backup.log 2>&1
```

The `backups` volume is on the same host as the data. Copy archives somewhere
else as well, for example after the backup:

```cron
45 2 * * * docker run --rm -v asterism_backups:/backups:ro -v /mnt/offsite/asterism:/out alpine sh -c 'cp -n /backups/asterism-backup-*.tar.gz /out/'
```

Compose names volumes `<project>_backups` (here the project is `asterism`).
Clean up the off-host copies with that location's own retention. From time to
time, check the newest archive with `verify`; that proves it can be restored.

## Upgrade procedure

Migrations only go forward, so the way back from a failed upgrade is a restore.

1. **Back up**: `docker compose exec asterism /app/docker/entrypoint.sh backup`,
   and note the file name it prints. Check it with `verify` and copy it off the host.
2. **New image**: change the image tag (or `git pull && docker compose build`).
3. **Start**: `docker compose up -d`. Startup applies pending migrations; watch
   `docker compose logs -f asterism` until the container is healthy.
4. **Verify**: sign in as an admin and as a student, open an existing chat and a
   file, and send a message.
5. **Roll back by restore**, if step 3 or 4 fails:

   ```bash
   docker compose down
   # Put the previous image tag back in docker-compose.yml (or check out the previous release and build).
   docker volume rm asterism_storage            # the upgraded data; the old image refuses it
   docker compose run --rm asterism restore /backups/<file from step 1>
   docker compose up -d
   ```

   Removing the storage volume deletes the upgraded data. Do it only after
   `verify` has passed on the archive from step 1. Anything users did after the
   backup is lost.

Restoring onto other hardware is the same: start from an empty `storage` volume,
copy the archive into the `backups` volume, set the same secrets, and run `restore`.
