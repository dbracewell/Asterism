# Completed checklist — 2026-11-18

Multi-user deployment readiness. [EPIC-86](../epics/EPIC-86-MULTI-USER-DEPLOYMENT-READINESS.md)
is complete: US-86.1 through US-86.8 were each confirmed and merged with `--no-ff`
before the next began. One item stays with the user: the one-time reset of
pre-baseline development databases (US-86.1); startup refuses those databases and
asks for `pnpm reset:db`.

## Multi-user deployment readiness

Source: the 2026-11-06 multi-user web decision. [EPIC-86](../epics/EPIC-86-MULTI-USER-DEPLOYMENT-READINESS.md). Decided 2026-11-17: migrations from now on ([ADR-0069](../adr/0069-versioned-schema-migrations.md)), only admins delete accounts (others can request), target load 30 active students on 4 vCPU / 8 GB. Suggested order: US-86.1 → 86.2 → 86.5 → 86.4 → 86.3 → 86.6 → 86.7 → 86.8. Work one story at a time.

### US-86.1: Versioned migrations

- [x] Add Alembic to the backend with migrations in `asterism/db/migrations/`.
- [x] Baseline revision: today's schema, including the FTS5 tables and triggers `init_db` installs; `init:db` and container startup run `upgrade head` instead of `create_all`.
- [x] Startup refuses a database revision that is newer than, or unknown to, the code, naming both revisions; forward-only, no downgrades.
- [x] CI check: the models and the migration head produce the same schema (autogenerate diff is empty), including FTS objects.
- [x] Migration test harness: seed a database at revision N-1, upgrade, assert data; documented in the backend README.
- [x] Update the development reset doc, README storage section and `docs/architecture/data-and-storage.md`; reset is dev-only.
- [ ] One-time reset of pre-baseline development databases. (Startup refuses them and asks for `pnpm reset:db`; resetting the working database is left to the user.)

### US-86.2: Account lifecycle for admins

- [x] Suspend / reactivate: Better Auth ban plus session revocation; the backend refuses a suspended user's token (checked with the existing per-request user lookup) and stops their running jobs.
- [x] Admin-issued one-time password reset link (expiring, single use, shown once), modeled on invite links; reset revokes existing sessions.
- [x] Delete from the UI: deletes the Better Auth account and then the backend data (existing `delete_user`), with a confirmation naming what goes. A partial failure is reported and can be retried.
- [x] "Sign out everywhere" for the user in their own settings.
- [x] Deletion requests: a user who isn't an admin can ask for their account to be deleted (and withdraw the request); Users shows open requests, and the admin deletes or dismisses. A request changes nothing else.
- [x] Admins can't suspend or delete themselves or the last admin.
- [x] Tests: suspended token refused on HTTP and WebSocket, reset link reuse and expiry, delete leaves no auth account, last-admin guard.

### US-86.3: Usage limits and usage view

Done 2026-11-18 ([ADR-0073](../adr/0073-usage-ledger-and-budgets.md)). Decided: one instance timezone for budget days and months (Admin Settings → Usage, default UTC); usage counts from the upgrade (no backfill); background calls (titles, captions, compaction) count but are never refused. Also enforced: forks, verification, disagreements, reflection drafts and the prompt coach. Added the shadcn `table` component (the CLI tried to add an unrelated `cn` package; removed).

- [x] Usage read: tokens and estimated cost per user and per model over a period, from message token counts and model pricing. Include delegated, verification, study-generation and image calls.
- [x] Group budget: optional token budget per user per day and per month, set by an admin on the group.
- [x] Enforcement at send/regenerate admission and on study and image generation; refusal is one 409 shape (`reason: "usage_limit"`) saying when the budget resets. Running turns finish.
- [x] Users see their own usage and remaining budget in Your Asterism.
- [x] Admin Settings → Usage page (table, period picker, per-group totals).
- [x] Tests: budget boundaries, reset windows (decided: one instance timezone, ADR-0073), admin exemption, every generation path counted.

### US-86.4: Backup and restore

Done 2026-11-18 ([ADR-0072](../adr/0072-backup-and-restore.md), [guide](../architecture/backup-and-restore.md)). Added `verify` (every restore check, into a scratch directory). Vectors are exported at one table version; model bundles are not backed up; restore refuses a different `SYSTEM_KEY`.

- [x] `backup` command (package script and container entrypoint subcommand): SQLite online backup of `users.db` and `database.db`, plus files, vectors and themes, into one timestamped archive with a manifest and checksums.
- [x] `restore` command: offline, into an empty storage root, verifies checksums and the migration revision, then runs the normal startup checks (applying pending migrations).
- [x] Documented schedule and retention example (cron / Compose) and an upgrade procedure (backup → new image → start → verify → roll back by restore).
- [x] Tests: backup during an active chat restores to a working instance; corrupted archive refused; a backup from a newer revision refused.

### US-86.5: Edge hardening

Done 2026-11-18 ([ADR-0071](../adr/0071-edge-hardening.md)). Frames: only the sandboxed canvas preview (`frame-src 'self'`); styles allow inline. Found: Better Auth's own sign-in limit (3 per 10 s per address) is stricter than nginx for a class on one address; measure in US-86.7.

- [x] Security headers from nginx and Next.js: CSP (scripts self, no inline except hashed/nonce'd as Next requires; frames none; connect-src self and the WebSocket path), `frame-ancestors 'none'`, `X-Content-Type-Options`, `Referrer-Policy`, and HSTS when `PUBLIC_URL` is HTTPS.
- [x] One upload limit: nginx, the Next proxy and the backend agree, from one setting.
- [x] Request rate limits in nginx for auth endpoints, uploads and the WebSocket handshake, keyed on the trusted client address.
- [x] Verify secure, HttpOnly, SameSite cookies under HTTPS `PUBLIC_URL`.
- [x] Playwright check that the app works under the CSP (no blocked script, style, image or WebSocket), plus a header assertion in the container smoke test.

### US-86.6: Production logs and status

Done 2026-11-18 ([ADR-0074](../adr/0074-production-logs-and-status.md)). Readiness is split: backend `/api/py/health/ready` (database, storage free space `MIN_FREE_STORAGE_BYTES`, JWKS) and frontend `/api/health` (users.db, signing a JWT). nginx passes its `$request_id`. `backup create` writes `.last-backup.json` for the status view. Found: every logger was pinned to DEBUG.

- [x] Production log profile: INFO by default, `LOG_LEVEL` setting, optional JSON format; request ID per HTTP request and WebSocket session, propagated to job logs.
- [x] Log hygiene test: no message content, file text, About you, tokens or secrets at INFO and above.
- [x] Readiness endpoint: both databases writable, storage free space above a threshold, auth keys loadable; container health check uses it.
- [x] Admin Settings → Status: version, uptime, active chats against admission limits, knowledge queue depth, storage use and free space, last backup time.

### US-86.7: Capacity check and sizing guide

Done 2026-11-18 ([ADR-0075](../adr/0075-capacity-check-and-sizing.md), [capacity](../architecture/capacity.md)). `pnpm capacity:check`: 30 students from one address on 4 CPUs / 8 GB, with a streaming model double. Found and fixed: Better Auth's 3-per-10 s sign-in limit (now 60/min, like nginx), a token fetched per backend call (now reused per tab; 224 refusals → 0), 8 provider streams (now 32; burst first token p95 7.4 s → 1.3 s), an ERROR line per closed tab. SQLite: no busy errors; peak memory 1.8 GiB.

- [x] Repeatable load script (disposable instance, stub model provider with realistic streaming latency): N students chatting, uploading and studying.
- [x] Measure at the agreed target (30 active students, 4 vCPU / 8 GB): p95 time to first token, admission refusals, SQLite busy errors, memory.
- [x] Fix what the run finds (e.g. SQLite busy timeout/WAL settings, admission limits) within the single-process design.
- [x] Sizing guide in the README: host size, admission settings, what "full" looks like to users.

### US-86.8: Personal data and deployment guide

Done 2026-11-18 ([ADR-0076](../adr/0076-download-my-data.md), [deployment guide](../deployment.md)). Settings → General → Your data builds one zip in the background (one build at a time): chats as Markdown (active branch) and JSON (every branch), files, canvases, skills, About you, settings, account, and an allowlist of record tables (projects, study, reflections, usage and more). Kept 7 days, latest only; downloaded through a 5-minute signed link the browser follows. Help: usage limit, suspended account, deletion request, Download my data.

- [x] "Download my data": chats (Markdown and JSON), my files, study records, skills, About you and settings, as one archive built in the background.
- [x] `docs/deployment.md`: prerequisites, TLS proxy examples, secrets, first admin, backups and upgrades, limits, monitoring, incident checklist; README links to it.
- [x] Help entries for usage limits, suspension, deletion requests and data download.
