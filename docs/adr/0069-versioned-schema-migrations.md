# ADR-0069 — Versioned schema migrations

Status: accepted on 2026-11-17 (user decision on
[EPIC-86](../epics/EPIC-86-MULTI-USER-DEPLOYMENT-READINESS.md), open question 1).
Implemented by US-86.1. Supersedes the development-stage rule "no migrations;
reset instead" in AGENTS.md and the "no migration" consequences of earlier ADRs
for all future schema changes. Those ADRs stay accurate as history.

## Context

Until now the backend created its schema with `Base.metadata.create_all` plus
SQLite FTS5 indexes and triggers, and every schema change meant resetting the
database ([development reset](../architecture/development-reset.md)). That
works while all data is disposable. Asterism is now heading to real multi-user
deployments, where people's chats, files and study records must survive
upgrades.

## Decision

**Migrations from now on.** Every backend schema change ships with a versioned
migration that upgrades existing data in place. Changing a model without a
migration is a defect, and CI checks for it.

**Tooling.** Alembic manages the backend database (`database.db`). Better Auth
keeps migrating `users.db` with its pinned CLI, as today. Migrations live in
`apps/backend/asterism/db/migrations/`.

**Baseline.** The first revision creates the schema as it is at adoption,
including the FTS5 tables and triggers that `init_db` installs today. After
that, fresh and existing databases take the same path: `upgrade head`.
`create_all` stops being an initialization path. Databases created before the
baseline are reset once, the last reset under the old policy.

**Startup.** The container and `init:db` apply pending migrations before
serving. Startup refuses a database whose revision is newer than the code, or
unknown to it, and names both revisions. The supported way back is restoring a
backup (US-86.4). Migrations are forward-only: no downgrade scripts.

**Data migrations.** A migration that changes stored data (backfill, reshape
JSON, split a column) is written and tested like a schema migration. Tests
upgrade a database seeded at the previous revision and check the data.

**Compatibility.** The frontend and backend ship in one image, so their API
contract still needs no compatibility layer. Stored data and file formats on
disk must stay readable across upgrades. Configuration changes are listed in
release notes.

**Reset stays for development.** `pnpm reset:db` remains a development tool for
disposable local data. It is never part of an upgrade.

## Consequences

- AGENTS.md's development-stage policy and engineering rule 6 change to match.
- Story verification still uses disposable isolated storage. A story that
  changes the schema adds a migration and a migration test.
- SQLite-specific migrations (FTS triggers, table rebuilds for constraint
  changes) use Alembic batch mode or explicit SQL. Each migration states what it
  rebuilds.
- Backups before upgrades become the documented procedure (US-86.4).
