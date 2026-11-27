# Operations

This guide explains what Asterism gives the person running it: logs that can be
followed from request to request, readiness checks that say what is wrong, the
admin Status page, and the settings export that moves configuration between
instances. Read it before changing logging, health checks or the Status page.

To install, back up or upgrade an instance, follow the
[deployment guide](../deployment.md). [Backup and restore](backup-and-restore.md)
and the [capacity check](capacity.md) cover those mechanisms in depth.

## Concepts

- **Request ID.** A short identifier for one HTTP request or one chat WebSocket
  session. nginx creates it, and every log line the request causes carries it,
  in nginx and in the backend.
- **Readiness.** Whether the instance can do its job right now: write to its
  databases, store files and sign tokens. It is reported by two public endpoints
  and checked by the container's health check.
- **Status.** A fuller picture for administrators: version, load against the
  admission limits, background queues, storage and the last backup.

## How it works

### Logs

The backend writes logs to standard output through a single handler, which also
formats Uvicorn's own messages ([ADR-0074](../adr/0074-production-logs-and-status.md)).
Two settings control it:

| Setting      | Values                                    | Default |
| ------------ | ----------------------------------------- | ------- |
| `LOG_LEVEL`  | `DEBUG`, `INFO`, `WARNING`, `ERROR`       | `INFO`  |
| `LOG_FORMAT` | `text`, or `json` for one object per line | `text`  |

A JSON line has `time`, `level`, `logger`, `request_id` and `message`, plus
`exception` for errors. Uvicorn's per-request lines are turned off, because nginx
already logs each request.

**Following a request.** nginx sets `X-Request-ID` on each request it forwards and
writes the same ID in its access log. The backend's request-ID middleware
([`core/request_id.py`](../../apps/backend/asterism/core/request_id.py)) keeps a
well-formed incoming ID, or makes one, and returns it in the response header. A
logging filter stamps every record with it. Python copies this context into each
task when the task is created, so a chat reply started from a socket, or a file
job started by an upload, logs under the ID of the request that started it. Work
that no request started, such as timers and startup, logs `-`.

A user reporting a problem can quote the `X-Request-ID` from their browser's
network panel, and the operator can find every line it produced.

**What logs never contain.** At `INFO` and above, logs contain no message text,
file content, About you text, tokens or secrets. This is tested: a test runs an
About you edit, an upload, a send and a model reply carrying marker strings and a
real token, and fails if any record at `INFO` or above contains one of them or
`SYSTEM_KEY`. `DEBUG` is for development and makes no such promise. Separately,
nginx's log format leaves out query strings, and the backend redacts `token=` and
`access_token=` values wherever they appear.

### Readiness

Two public endpoints answer "can you serve?". Each returns `ready` and a list of
checks, each passed or failed with a short reason, and answers 503 when any check
fails. They never include a path or error text. Because they are public, each reuses its
last result for 5 seconds and concurrent requests share one run of the checks, so
a flood of health requests cannot keep the databases locked.

| Endpoint                   | Owner    | Checks                                                                                                                                                                                                          |
| -------------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/py/health/ready` | Backend  | `database.db` takes a write lock within 1.5 seconds ("busy" is reported apart from "not writable"); the storage disk has at least `MIN_FREE_STORAGE_BYTES` free (default 1 GiB); Better Auth's public keys load |
| `GET /api/health`          | Frontend | `users.db` takes a write lock; Better Auth can sign a throwaway token, which proves its key decrypts with `BETTER_AUTH_SECRET`                                                                                  |

The container's health check
([`docker/healthcheck.py`](../../docker/healthcheck.py)) runs every 30 seconds.
It fetches `/sign-in` and both endpoints through nginx's loopback server, and writes the failing
response to Docker's health log. It allows three failures before marking the
container unhealthy, because a long write can briefly hold the database lock.

Separately, the entrypoint stops the whole container if nginx, Next.js or FastAPI
exits, so that Docker's restart policy can bring it back.

### The Status page

Admin Settings → Status (`GET /api/py/status`, administrators only) shows:

- **Readiness** (the backend checks above), the version, the schema revision, how
  long the process has been running, and the log settings.
- **Load:** replies running and chat connections, each against its admission
  limit ([chat and WebSocket](chat-and-websocket.md#limits-and-failures)).
- **Background work:** file processing jobs running and waiting.
- **Storage:** space used, space free and the readiness minimum. Space used is
  measured in the background at most every five minutes, because walking a large
  storage tree is slow; the page shows the last measurement meanwhile.
- **The last backup:** its time, archive name and size, read from
  `.last-backup.json`, which each backup writes in the storage root. A backup more
  than two days old is flagged.

The page refreshes every 15 seconds. Everything on it describes this one process,
which is the whole instance in the single-process design
([ADR-0019](../adr/0019-single-process-runtime-and-storage-seams.md)).

### Exporting and importing settings

Admin Settings → Export saves the instance's application settings to a file, and
import applies such a file to another instance, or to the same one after a reset
([ADR-0052](../adr/0052-settings-export-format.md)). The first-run setup offers
the same import as an alternative to connecting a provider by hand.

**What the file holds.** Providers with their API keys and models, the draft
model, active tools, the instance policies (such as Skills and ChatGPT plans),
search providers, the captioning choice, and every group's name and model and
tool lists. Models are referred to by provider and model name, because record IDs
differ between instances. The file never holds users, group membership, anything
a user owns, or a user's personal ChatGPT connection.

**Encryption.** Provider keys are stored encrypted with the instance's
`SYSTEM_KEY`, which another instance doesn't share. So the export decrypts them and
seals the whole bundle again with a passphrase the administrator chooses (12 to
1,024 characters), using scrypt and Fernet. The file shows only that it is an
Asterism settings file. A wrong passphrase and an altered file give the same
error. There is no recovery for a lost passphrase.

**Import merges.** Providers are matched by name and models by name within them,
so existing model IDs, and the sub-agents bound to them, survive. Nothing the file
lacks is removed. Values the file has replace the current ones; a file with no
draft model or search provider leaves the current one alone. Everything is
validated first and written in one transaction, so a failed import changes
nothing. Groups are matched by name; import adds missing ones and replaces the
lists of those it names, but never deletes a group or moves anyone.

Export is the one path that returns stored keys, so it is admin-only and each
export is logged with the administrator's ID. Neither the passphrase nor any key
is logged. `POST /settings/app/transfer/preview` shows what an import would change
without returning keys or values.

## Rules

- No logger sets its own level; `LOG_LEVEL` decides for all of them.
- Nothing at `INFO` or above logs user content, tokens or secrets.
- Readiness responses name the failing check, never a path or an error message.
- The Status page and settings export are for administrators only.
- A settings import never deletes a provider, model or group, and never changes
  who is in a group.

## Where the code lives

1. [`common/log.py`](../../apps/backend/asterism/common/log.py): the log handler,
   formats and token redaction.
2. [`core/request_id.py`](../../apps/backend/asterism/core/request_id.py): the
   request-ID middleware.
3. [`domains/status/`](../../apps/backend/asterism/domains/status/): readiness and
   the Status page's data.
4. [`src/app/api/health/route.ts`](../../apps/frontend/src/app/api/health/route.ts):
   the frontend's readiness.
5. [`docker/healthcheck.py`](../../docker/healthcheck.py): the container health
   check.
6. [`domains/settings_transfer/`](../../apps/backend/asterism/domains/settings_transfer/):
   settings export, preview and import.

## Related

- [Deployment guide](../deployment.md): installing, upgrading and monitoring
- [Backup and restore](backup-and-restore.md)
- [Capacity check](capacity.md)
- [ADR-0074](../adr/0074-production-logs-and-status.md): logs, readiness and status
- [ADR-0052](../adr/0052-settings-export-format.md): the settings file
