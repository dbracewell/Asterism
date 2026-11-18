# ADR-0074 — Production logs, readiness and status

Status: accepted and implemented for US-86.6 on 2026-11-18
([EPIC-86](../epics/EPIC-86-MULTI-USER-DEPLOYMENT-READINESS.md)).

## Context

`get_logger` pinned every backend logger to DEBUG, so production printed debug
output, some of it with request details. Log lines could not be tied to a
request. Uvicorn's own loggers kept their own format. The container health
check fetched three pages and could not tell a full disk or an unwritable
database from a working instance. An operator had no view of how busy the
instance was short of reading logs.

## Decision

**One log profile.** `LOG_LEVEL` (`DEBUG`, `INFO` by default, `WARNING`, `ERROR`)
and `LOG_FORMAT` (`text` by default, or `json`) configure a single stdout
handler, and no logger sets its own level. `serve.py` passes the same `dictConfig`
to Uvicorn, so its loggers use the handler and format too. Uvicorn's request
lines stay off, because nginx logs requests. JSON lines carry `time`, `level`,
`logger`, `request_id`, `message` and, for errors, `exception`.

Both settings are in the config contract (validated before start), the backend
environment scope, `.env.example` and Compose. `common.log` reads them from the
environment, because it is imported before configuration. `core.config`
validates the same names.

**A request id everywhere.** nginx sends `X-Request-ID: $request_id` upstream and
writes it in its access log. A pure ASGI middleware keeps a well-formed incoming
id, or makes one. It sets a context variable for the HTTP request or WebSocket
session and echoes the id in HTTP responses. A logging filter stamps every record
with it. asyncio copies context variables into tasks when they are created, so a
chat run started on a socket and a knowledge job started by an upload log under
that id. Timers and startup work log `-`.

**Log hygiene is tested, not just intended.** A test runs an About you edit, a
file upload, a send and a model reply, with a bearer token, all carrying canary
strings. It requires that no record at INFO or above contains any of them, or
`SYSTEM_KEY`. A test that planted a prompt log fails it. DEBUG is excluded by
design and is a development level.

**Readiness, split by owner.** Both endpoints are public, return pass/fail with a
short reason and never a path or error text, and answer 503 when not ready.

- Backend `GET /health/ready` (`/api/py/health/ready`) checks three things,
  concurrently. The database is `database.db` with `BEGIN IMMEDIATE` and rollback,
  a 1.5 s wait, and "busy" reported apart from "not writable". Storage is the free
  space on the storage root's disk against `MIN_FREE_STORAGE_BYTES` (default
  1 GiB). Auth keys means the JWKS loads from the frontend.
- Frontend `GET /api/health` checks two things. `users.db` must take a write lock.
  Better Auth must sign a throwaway JWT, which proves the private key decrypts
  with `BETTER_AUTH_SECRET`.

The container health check fetches `/sign-in` and both endpoints through nginx,
and prints the failing body to Docker's health log.

**Admin Settings → Status** (`GET /status`, admin only) shows:

- Readiness, version, schema revision, uptime and the log settings.
- Replies running and chat connections against their admission limits.
- Knowledge jobs running and waiting. `JobManager` now counts both.
- Storage use, free space and the readiness minimum. Storage use is measured
  in the background at most every five minutes, and shows the last value while a
  large tree is walked.
- The last backup. `backup create` writes `.last-backup.json` (time, archive name,
  size) in the storage root. It sits outside every backed-up tree, and status
  reads it. Backups more than two days old are flagged, measured by the server's
  clock.

The page refreshes every 15 seconds.

## Consequences

- Operators can pick JSON for collectors and match nginx and backend lines by
  request id. A bug report can quote the `X-Request-ID` header.
- Debug output no longer reaches production logs unless `LOG_LEVEL=DEBUG` is set.
- Readiness can fail briefly while a long write holds the database lock. The
  health check retries three times before marking the container unhealthy.
- The frontend's readiness signs one small JWT per health check, every 30 s.
- Status reflects this one process. That is the whole instance under the
  single-process design ([ADR-0019](0019-single-process-runtime-and-storage-seams.md)).
