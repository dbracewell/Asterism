# Theme storage and lifecycle

## Decision — US-31.2, 2026-10-18

The frontend theme domain owns platform-wide presentation palettes, independent of
user file uploads, backend FileStore, and relational settings. The image supplies
read-only defaults through static JSON imports in
[`features/theme/bundled`](../../apps/frontend/src/features/theme/bundled).
Administrator-created palettes and overrides belong to **`STORAGE_ROOT/themes`**.
The combined container mounts this directory below its existing `/storage` volume.
Application upgrades replace defaults without replacing custom files.

`ThemeRepository` exposes `list`, `read`, and `save`; its filesystem implementation
lives in the theme domain. Catalog composition obtains the root from the existing
server configuration. Server actions independently enforce administrator sessions.
The editor uses TanStack mutations and the shared mutation-cache invalidation.
No database schema, data migration, legacy directory reader, or fallback to former
`public/themes` files is provided.

## Files and reads

Each custom file is `<catalog-id>.json`, containing only `name`, `type`, and the
complete `colors` map. The ID is the filename stem; `filename` is response metadata,
not a persisted JSON field. The strict runtime schema rejects unknown fields,
invalid hex colors and invalid names/IDs. New palette IDs are server-generated
UUIDs. Editing a bundled ID writes an override with that ID; the bundle is never
modified. Theme names must be unique, case-insensitively, across the effective
catalog; updates exclude their own ID from the check.

Readers validate each custom file independently. Invalid/unreadable files are
omitted with an ID-only diagnostic; they do not discard other palettes. A malformed
override leaves the valid bundled default available, and an administrator can repair
it by saving that default. Invalid new custom palettes disappear from the catalog.
A missing selection resolves to Light; saved user preferences for unavailable IDs
also resolve to Light without repeated refreshes. Directory-wide storage errors
remain failures rather than being reported as an empty custom catalog.

Reads reject symlink entries and open files with `O_NOFOLLOW`. The `themes`
directory itself must resolve to the direct child of the configured storage root.
The configured root and local deployment filesystem are trusted. Palette JSON is
public presentation data; never store secrets there. It is served only through
validated catalog APIs and server-rendered metadata, not from a writable public
asset directory.

## Writes, errors, and freshness

A save validates its payload, serializes the name check and write, and creates a
same-directory temporary file with exclusive creation and mode `0600`. It awaits
writing, file sync and close before an atomic rename replaces the target. That
rename is the commit point. Before it, a failure preserves the last committed file;
readers see complete previous or new JSON, never a partially written target.
Temporary files are cleaned up after handled failures. Files left by an abruptly
terminated process are ignored by readers and may be removed while the app is
stopped. Storage is expected to provide normal local-filesystem atomic rename
semantics.

Save actions return a discriminated result containing the saved theme or a typed
`INVALID_THEME`, `NOT_FOUND`, `DUPLICATE_NAME`, or `STORAGE_ERROR` failure. Internal
filesystem details are not returned. Failed edits remain in the form with a retry
action; success installs the returned ID, resets dirty state, and shows confirmation.
Navigation between themes and form controls is disabled while saving. Transport
failures receive the same retained-draft behavior. Layout revalidation occurs after
commit; a refresh failure cannot be reported as a failed persistence operation.

There is **no process-global palette cache** and public catalog responses use
`Cache-Control: no-store`. The root layout is dynamic. Each request reads committed
files; a completed save revalidates the root layout and refreshes the editing
browser. Existing pages in other tabs update on their next navigation/refresh;
there is no push subscription. A fresh/replacement process reads the same volume
without warming or invalidating another process's cache.

The supported combined deployment has **one Next.js writer process per storage
volume**. A small per-root write queue is shared across its route/action bundles,
including separately constructed repository instances. It serializes duplicate-name
checks and commits and releases entries on failure. It is not a multi-replica write
lock; concurrent writer processes on the same volume are unsupported. Read-only
processes observe the next completed filesystem read without a cache TTL.

## Permissions, backup, and reset

The application runs as UID/GID `10001`; the existing named volume is owned by that
user. Bind mounts must grant that user write/search access to `STORAGE_ROOT` and
`themes`. The repository lazily creates `themes` with mode `0700` on the first save;
listing bundled defaults does not create storage. Default JSON is compiled into
the application and can remain read-only.

Stop the writer before a consistent backup/restore. Back up the custom `themes`
directory along with the rest of persistent application storage, preserving IDs,
bytes and permissions. Restore it under the new deployment's `STORAGE_ROOT`, ensure
UID `10001` owns the directory/files, and then start the application. Keep the named
volume attached when recreating a container. `docker compose down -v` deletes it.

`pnpm reset:db` resets auth/backend databases and source/knowledge storage but
**preserves custom themes**, just as it preserves model bundles. To deliberately
reset theme customization, stop the app and separately remove only the reviewed
`STORAGE_ROOT/themes` directory. This removes custom palettes and bundled overrides;
next startup reads bundled defaults, and unavailable saved selections resolve to
Light. Do not remove the whole storage root to reset themes.

## Verification

[`US-31.2 verification`](../reviews/us-31.2-verification-2026-10-18.md) records
repository, editor, browser, production-build and isolated container results.
The reusable container check is
[`check-theme-storage-container.mjs`](../../scripts/check-theme-storage-container.mjs).
It transpiles the actual repository into a test layer on a local application image
and replaces three containers sharing a new disposable volume. It verifies
persistence, UID `10001` and read-only bundled assets; it does not rebuild or test
the whole application image. It removes only its own test image and volume.
