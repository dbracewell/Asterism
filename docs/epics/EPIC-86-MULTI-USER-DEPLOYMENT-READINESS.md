# EPIC-86: Multi-user deployment readiness

Status: proposed (2026-11-17); open questions decided the same day. Source: the multi-user web direction decided on
2026-11-06 ([ADR-0053](../adr/0053-classes-and-educators.md)) and the open item
in `todo.md` ("a multi-user deployment readiness epic").

## Objective

Make one Asterism instance safe to run for a real group of people, such as a
school or a class of 30 students and their educators, for a full term. The
admin should be able to manage accounts, limit spend, back up and restore,
and see when something is wrong. It should hold up against the usual web risks.

Out of scope: horizontal scaling. One backend process per deployment stays the
supported shape ([ADR-0019](../adr/0019-single-process-runtime-and-storage-seams.md)).
This epic makes that one instance operable; it does not distribute it.

## Where things stand (verified 2026-11-17)

| Area | Today | Gap |
| --- | --- | --- |
| Packaging | One non-root container (Next.js, FastAPI, nginx), Compose and `docker run`, file secrets, health checks, smoke test | No upgrade or rollback procedure |
| Process model | `asterism.serve` enforces one worker; finite chat admission ([ADR-0020](../adr/0020-chat-capacity-admission.md)) | No measured capacity for a class-sized load |
| Accounts | Better Auth email/password; signup by admin key, signed-in admin or invite link | No password reset, no suspend/reactivate, no "sign out everywhere" |
| Deleting users | `DELETE /users/{id}` (admin) removes backend rows, files and vectors and writes a tombstone | No UI; the Better Auth account stays, so the person can still sign in and is refused by the tombstone (corrected 2026-11-17) |
| Spend | Token counts on each message; per-model pricing in settings | No per-user or per-group limits, no usage view |
| Data safety | `/storage` holds `users.db`, `database.db`, files, vectors and themes; README says "back up before upgrades" | No backup or restore command; no migrations or schema version, so upgrades mean a reset and a mismatched database starts half-working |
| Edge | nginx proxy, `client_max_body_size 100m`; Better Auth's default rate limit | No security headers (CSP, HSTS, frame-ancestors, nosniff); upload limit differs from Next's 500 MB; no request limits on uploads or auth beyond Better Auth |
| Observability | Uvicorn-style text logs, the `asterism` namespace at DEBUG | No production log level or format, no request IDs, no admin status view |
| Personal data | AI-use log export per chat | A user can't download or delete their own data |

## Decisions

- **Single instance stays.** Capacity work measures and documents the limits of
  one process rather than adding replicas.
- **No email dependency by default.** As with invite links (ADR-0053), an admin
  issues one-time password reset links to copy and send themselves. An optional
  SMTP sender can come later behind the same link flow.
- **Suspension is reversible; deletion is total.** Suspending blocks sign-in and
  revokes sessions but keeps data. Deleting removes the Better Auth account and
  all backend data in one admin action, ordered so a failure can be retried.
- **Limits are per group.** Groups already exist ([ADR-0058](../adr/0058-user-groups.md)).
  A group can have a token budget per user per day or month. A send over budget is
  refused before admission with a clear message. Admins are exempt. Limits never
  grant anything.
- **Backups are online and consistent.** A command snapshots both SQLite
  databases with the SQLite backup API and copies the files and vectors into one
  archive. Restore runs offline and checks the result.
- **The schema is versioned.** The Alembic revision in the database is the
  schema version. Startup applies pending migrations and refuses a database
  that is newer than, or unknown to, the code.

## Decided (2026-11-17)

1. **Migrations from now on** ([ADR-0069](../adr/0069-versioned-schema-migrations.md)).
   Alembic manages the backend database from a baseline of today's schema; every
   later schema change ships with a migration and an upgrade test. Better Auth keeps
   migrating its own tables. AGENTS.md is updated.
2. **Only admins delete accounts.** Users who aren't admins can ask for deletion;
   admins see the request in Users and decide. The request grants nothing and
   changes no data.
3. **Target load:** 30 active students on a 4 vCPU / 8 GB host with a remote model
   provider.

## User stories

Suggested order: US-86.1 → 86.2 → 86.5 → 86.4 → 86.3 → 86.6 → 86.7 → 86.8.
US-86.1 comes first so every later schema change ships as a migration.

### US-86.1: Versioned migrations

As an operator, I can upgrade Asterism without losing data; as a contributor,
I ship each schema change as a migration.

- [x] Add Alembic to the backend with migrations in `asterism/db/migrations/`.
- [x] Baseline revision: today's schema, including the FTS5 tables and triggers
      `init_db` installs; `init:db` and container startup run `upgrade head`
      instead of `create_all`.
- [x] Startup refuses a database revision that is newer than, or unknown to,
      the code, naming both revisions; forward-only, no downgrades.
- [x] CI check: the models and the migration head produce the same schema
      (autogenerate diff is empty), including FTS objects.
- [x] Migration test harness: seed a database at revision N-1, upgrade, assert
      data; documented in the backend README.
- [x] Update the development reset doc, README storage section and
      `docs/architecture/data-and-storage.md`; reset is dev-only.
- [ ] One-time reset of pre-baseline development databases. (Startup refuses them and asks for `pnpm reset:db`; resetting the working database is left to the user.)

### US-86.2: Account lifecycle for admins

As an admin, I can suspend, reactivate, reset and delete accounts from Admin
Settings → Users, so I can run the instance without touching the database.

- [x] Suspend / reactivate: Better Auth ban plus session revocation; the
      backend refuses a suspended user's token (checked with the existing
      per-request user lookup) and stops their running jobs.
- [x] Admin-issued one-time password reset link (expiring, single use, shown
      once), modeled on invite links; reset revokes existing sessions.
- [x] Delete from the UI: deletes the Better Auth account and then the backend
      data (existing `delete_user`), with a confirmation naming what goes. A
      partial failure is reported and can be retried.
- [x] "Sign out everywhere" for the user in their own settings.
- [x] Deletion requests: a user who isn't an admin can ask for their account
      to be deleted (and withdraw the request); Users shows open requests, and
      the admin deletes or dismisses. A request changes nothing else.
- [x] Admins can't suspend or delete themselves or the last admin.
- [x] Tests: suspended token refused on HTTP and WebSocket, reset link reuse
      and expiry, delete leaves no auth account, last-admin guard.

### US-86.3: Usage limits and usage view

As an admin, I can see who is using how much and cap it per group, so one
account can't spend the whole budget.

- [ ] Usage read: tokens and estimated cost per user and per model over a
      period, from message token counts and model pricing. Include delegated,
      verification, study-generation and image calls.
- [ ] Group budget: optional token budget per user per day and per month,
      set by an admin on the group.
- [ ] Enforcement at send/regenerate admission and on study and image
      generation; refusal is one 409 shape (`reason: "usage_limit"`) saying when the
      budget resets. Running turns finish.
- [ ] Users see their own usage and remaining budget in Your Asterism.
- [ ] Admin Settings → Usage page (table, period picker, per-group totals).
- [ ] Tests: budget boundaries, reset windows (user timezone vs UTC: decide and
      document), admin exemption, every generation path counted.

### US-86.4: Backup and restore

As an admin, I can take a consistent backup while the app runs and restore it.

- [ ] `backup` command (package script and container entrypoint subcommand):
      SQLite online backup of `users.db` and `database.db`, plus files, vectors
      and themes, into one timestamped archive with a manifest and checksums.
- [ ] `restore` command: offline, into an empty storage root, verifies
      checksums and the migration revision, then runs the normal startup
      checks (applying pending migrations).
- [ ] Documented schedule and retention example (cron / Compose) and an
      upgrade procedure (backup → new image → start → verify → roll back by restore).
- [ ] Tests: backup during an active chat restores to a working instance;
      corrupted archive refused; a backup from a newer revision refused.

### US-86.5: Edge hardening

As an operator, I can put Asterism on the internet behind a TLS proxy with
sensible protections on by default.

- [ ] Security headers from nginx and Next.js: CSP (scripts self, no inline
      except hashed/nonce'd as Next requires; frames none; connect-src self and the
      WebSocket path), `frame-ancestors 'none'`, `X-Content-Type-Options`,
      `Referrer-Policy`, and HSTS when `PUBLIC_URL` is HTTPS.
- [ ] One upload limit: nginx, the Next proxy and the backend agree, from one
      setting.
- [ ] Request rate limits in nginx for auth endpoints, uploads and the
      WebSocket handshake, keyed on the trusted client address.
- [ ] Verify secure, HttpOnly, SameSite cookies under HTTPS `PUBLIC_URL`.
- [ ] Playwright check that the app works under the CSP (no blocked script,
      style, image or WebSocket), plus a header assertion in the container smoke test.

### US-86.6: Production logs and status

As an operator, I can tell what the instance is doing and why something failed.

- [ ] Production log profile: INFO by default, `LOG_LEVEL` setting, optional
      JSON format; request ID per HTTP request and WebSocket session, propagated
      to job logs.
- [ ] Log hygiene test: no message content, file text, About you, tokens or
      secrets at INFO and above.
- [ ] Readiness endpoint: both databases writable, storage free space above a
      threshold, auth keys loadable; container health check uses it.
- [ ] Admin Settings → Status: version, uptime, active chats against admission
      limits, knowledge queue depth, storage use and free space, last backup time.

### US-86.7: Capacity check and sizing guide

As an operator, I know how many people one instance serves and what to do when
it's full.

- [ ] Repeatable load script (disposable instance, stub model provider with
      realistic streaming latency): N students chatting, uploading and studying.
- [ ] Measure at the agreed target (30 active students, 4 vCPU / 8 GB): p95 time to first token,
      admission refusals, SQLite busy errors, memory.
- [ ] Fix what the run finds (e.g. SQLite busy timeout/WAL settings, admission
      limits) within the single-process design.
- [ ] Sizing guide in the README: host size, admission settings, what "full"
      looks like to users.

### US-86.8: Personal data and deployment guide

As a user, I can take my data with me; as an operator, I have one guide to
deploy and run Asterism.

- [ ] "Download my data": chats (Markdown and JSON), my files, study records,
      skills, About you and settings, as one archive built in the background.
- [ ] `docs/deployment.md`: prerequisites, TLS proxy examples, secrets, first
      admin, backups and upgrades, limits, monitoring, incident checklist; README
      links to it.
- [ ] Help entries for usage limits, suspension, deletion requests and data download.
