# Deploying and running Asterism

One guide for putting Asterism in front of real users and keeping it running. It
links to the detailed references rather than repeating them.

Asterism runs as **one container** (nginx, Next.js and FastAPI) with **one storage
volume**. It grows by host size, not by replicas: run exactly one container per
storage volume.

## 1. Prerequisites

- **A host with Docker** (Docker Engine with Compose v2). For about 30 active users,
  4 vCPU and 8 GB of memory, measured with the
  [capacity check](architecture/capacity.md). See
  [Sizing and limits](#7-sizing-and-limits) for other sizes.
- **Disk:** the image is about 4.4 GB on disk (under 1 GB to download), or
  about 8 GB with the [GPU build](#gpu-build). The published image runs on amd64
  and arm64 hosts. Storage holds uploaded files, the
  databases and vectors. Backups need about the size of storage per kept archive.
  Keep at least `MIN_FREE_STORAGE_BYTES` (1 GiB) free, or readiness fails.
- **A DNS name and a TLS proxy** in front of the container (examples below).
  Asterism serves plain HTTP on port 3000 and expects TLS to end at the proxy.
- **A model provider:** an OpenAI API key, or any OpenAI-compatible endpoint
  (hosted, or a local server such as one on the same network).
- **Outbound internet on first start**, to download the pinned embedding model
  used to index files.
- **A browser for the web fetch tool is included.** The tool reads most pages
  directly and renders short or JavaScript-heavy pages in the image's headless
  Chromium, which runs as the container's user with no network of its own: every
  request it makes goes through the tool's checked connection.

## 2. Configure

Releases are published as `ghcr.io/dbracewell/asterism:<version>`; the
[release notes](release-notes.md) list them. Check out the release you will run,
for its `docker-compose.yml` and `.env.example`:

```bash
git clone --branch v0.2.0 https://github.com/dbracewell/Asterism.git asterism && cd asterism
cp .env.example .env
openssl rand -base64 32   # run three times: one value for each secret below
```

Set in `.env`:

| Setting              | Value                                                                                                                                                                        |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ASTERISM_VERSION`   | The release to run, e.g. `0.2.0`. Compose runs `ghcr.io/dbracewell/asterism:<version>` and refuses to start without it.                                                      |
| `PUBLIC_URL`         | The browser-facing origin, e.g. `https://asterism.example.edu`, no trailing slash. It is also the JWT issuer and the cookie origin.                                          |
| `BETTER_AUTH_SECRET` | Random. Encrypts the auth signing keys. **Never change it**: every session and the signing keys depend on it.                                                                |
| `SYSTEM_KEY`         | Random. Signs internal requests and encrypts stored provider keys. **Never change it**: backups refuse to restore with a different one.                                      |
| `ADMIN_PASSPHRASE`   | Random. Used once, to create the first administrator.                                                                                                                        |
| `TRUSTED_PROXIES`    | The TLS proxy's address or network, e.g. `172.18.0.0/16`. Without it, every request seems to come from the proxy, and the per-address rate limits apply to everyone at once. |

All settings, with defaults: the [configuration reference](#configuration-reference)
and `.env.example`. The file has a [strict syntax](#env-file-syntax). The values are validated before anything starts, and a bad value
names the setting.

**Secrets.** Keep `.env` readable only by the account that runs Compose
(`chmod 600 .env`). Orchestrators can mount files instead, at
`/run/secrets/BETTER_AUTH_SECRET`, `/run/secrets/SYSTEM_KEY` and
`/run/secrets/ADMIN_PASSPHRASE`. Store copies of `BETTER_AUTH_SECRET` and
`SYSTEM_KEY` somewhere safe and apart from the backups: backups do not contain them,
and a restore needs the same values.

## 3. Start

```bash
docker compose pull
docker compose up -d
docker compose ps        # wait for "healthy"
docker compose logs -f
```

The first start downloads the embedding model, migrates both databases and then
reports healthy. Compose publishes port 3000 on `127.0.0.1` only, so only the proxy
on the same host reaches it.

- **Another port.** Set `PORT=8080` and `PUBLIC_URL` to match. Changing the public
  origin needs only a new container (`docker compose up -d`); the image never
  reads `.env` or needs secrets.
- **Other settings.** Compose passes only the settings named in
  `docker-compose.yml` (`PUBLIC_URL`, the three secrets, `TRUSTED_PROXIES`,
  `LOG_LEVEL`, `LOG_FORMAT` and `PORT`). To set anything else, such as an admission
  limit, add it under the service's `environment:`, for example in a
  `docker-compose.override.yml`.
- **Version and commit.** Admin Settings → Status and every backup name the
  app version and the commit the image was built from.
- **Without Compose:**

  ```bash
  docker run -d --name asterism --restart unless-stopped --stop-timeout 30 \
    -p 127.0.0.1:3000:3000 --env-file .env -e STORAGE_ROOT=/storage \
    -v asterism-storage:/storage ghcr.io/dbracewell/asterism:0.2.0
  ```

  With `--env-file`, every setting in `.env` reaches the container.

### Building from source

To build the image from your checkout instead, for example for a fork or the
GPU build, add `docker-compose.build.yml`. Set `ASTERISM_VERSION` to the
checkout's version (in `package.json`); the build refuses any other. Pass the
commit so Status can show it:

```bash
ASTERISM_COMMIT=$(git rev-parse HEAD) docker compose \
  -f docker-compose.yml -f docker-compose.build.yml up -d --build
```

Put `COMPOSE_FILE=docker-compose.yml:docker-compose.build.yml` in `.env` and
every `docker compose` command (backups included) uses both files. Without
Compose: `docker build --build-arg ASTERISM_COMMIT=$(git rev-parse HEAD) -t asterism:local .`
A build downloads several GB of dependencies.

### GPU build

The image installs CPU-only PyTorch. Embeddings, captioning and local image
generation all run on it, and a GPU isn't needed for them. To use an NVIDIA GPU
for local image generation, build with CUDA PyTorch instead. No GPU image is
published; build it from source (above). It adds about 4 GB to the image
(estimated from the CUDA libraries it installs):

```bash
docker compose -f docker-compose.yml -f docker-compose.build.yml build --build-arg TORCH_VARIANT=gpu
docker compose -f docker-compose.yml -f docker-compose.build.yml up -d
```

Without Compose: `docker build --build-arg TORCH_VARIANT=gpu -t asterism:local .`
Pass the container the GPU as your Docker host requires (for example
`--gpus all` with the NVIDIA Container Toolkit). Rebuild with the same argument
on every upgrade, or the next `--build` returns to the CPU build.

The image refuses to start with more than one backend worker
(`WEB_CONCURRENCY` or `UVICORN_WORKERS` other than 1), and running more than one
container on the same storage is not supported: the backend keeps chat work and
queues in memory ([ADR-0019](adr/0019-single-process-runtime-and-storage-seams.md)).

## 4. TLS proxy

The proxy must forward `Host`, set `X-Forwarded-Proto` and `X-Forwarded-For`, pass
WebSocket upgrades (`/api/py/chat/stream/`), allow long-lived connections (replies
stream for minutes) and accept uploads up to `MAX_UPLOAD_FILE_SIZE_BYTES` (100 MiB
by default). Don't buffer responses. Never expose internal ports 3001 or 8000.

**Caddy** (gets certificates automatically):

```caddyfile
asterism.example.edu {
	request_body {
		max_size 100MB
	}
	reverse_proxy 127.0.0.1:3000 {
		flush_interval -1
	}
}
```

Caddy sets `X-Forwarded-For` and `X-Forwarded-Proto` and passes WebSockets by
default. Set `TRUSTED_PROXIES=127.0.0.1` when Caddy runs on the host.

**nginx:**

```nginx
server {
    listen 443 ssl;
    http2 on;
    server_name asterism.example.edu;
    ssl_certificate     /etc/letsencrypt/live/asterism.example.edu/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/asterism.example.edu/privkey.pem;

    client_max_body_size 100m;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto https;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;
        proxy_buffering off;
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
    }
}

# In the http block:
map $http_upgrade $connection_upgrade {
    default upgrade;
    ''      close;
}
```

With an `https://` `PUBLIC_URL`, responses send HSTS and the auth cookies are
`Secure`. Check from outside: `curl -sI https://asterism.example.edu/sign-in` shows
`strict-transport-security` and `content-security-policy`. The edge protections
are listed under [security defaults](#security-defaults).

## 5. First administrator and setup

1. Open `PUBLIC_URL` and create the administrator account with `ADMIN_PASSPHRASE`.
2. Follow the setup card to connect a model provider and enable a model.
3. In Admin Settings:
   - **Groups:** set token budgets for Student and Educator if you need them, and
     the models and tools each group may use.
   - **Usage:** choose the time zone that days and months reset in.
   - **Educators:** approve educators' requests. People join through class invite
     links, which educators (and administrators, who can run classes too) create
     for a class.
4. Take a first backup (below) and check that Admin Settings → Status shows it.

Accounts: admins suspend, reactivate, reset passwords with one-time links, and
delete accounts. People can ask for deletion in Settings → General, and download
their data first ([ADR-0070](adr/0070-account-lifecycle.md),
[ADR-0076](adr/0076-download-my-data.md)).

## 6. Storage, backups and upgrades

The `storage` volume, mounted at `/storage`, holds everything:

| Path                      | Holds                                                            |
| ------------------------- | ---------------------------------------------------------------- |
| `users.db`, `database.db` | The two databases: accounts and everything else                  |
| `files/`, `knowledge/`    | Uploaded and generated files, and their search vectors           |
| `themes/`                 | Custom themes                                                    |
| `models/`                 | Downloaded models (fetched again if lost)                        |
| `exports/`                | People's "Download my data" archives, kept 7 days, not backed up |

A bind mount must be writable by UID **10001**, the user the container runs as.
Both databases are migrated on every start, keeping data. The container refuses a
database whose schema is newer than, or unknown to, the image, and names both
versions; migrations never go backwards. **Never run `docker compose down -v`**
unless you mean to delete every user's data. `pnpm reset:db` is a development tool,
never part of an upgrade.

Back up nightly, and before every upgrade, while the app runs:

```bash
docker compose exec -T asterism /app/docker/entrypoint.sh backup --keep 14
docker compose exec -T asterism /app/docker/entrypoint.sh verify /backups/<file>
```

Copy the `backups` volume off the host. The cron schedule, restore steps and the
upgrade and roll-back procedure are in
[Backup and restore](architecture/backup-and-restore.md). In short, to upgrade:

1. Read the [release notes](release-notes.md) for configuration changes.
2. Back up and verify.
3. Check out the new release's tag (`git fetch --tags && git checkout v<version>`)
   for its `docker-compose.yml`, set `ASTERISM_VERSION` in `.env` to the new
   version, then `docker compose pull && docker compose up -d`. Migrations run on
   start and only go forward. Building from source instead:
   `ASTERISM_COMMIT=$(git rev-parse HEAD) docker compose -f docker-compose.yml -f docker-compose.build.yml up -d --build`.
4. Check `docker compose ps` is healthy and Admin Settings → Status shows the new
   version and commit.

To go back, restore the pre-upgrade backup with the previous image. The upgraded
data cannot be opened by the older image.

People's "Download my data" archives are kept for 7 days under `exports/` in
storage. They are not in backups.

## 7. Sizing and limits

One instance is one process with one SQLite database, so it grows with its host,
not by adding copies. The [capacity check](architecture/capacity.md) measured **30
active students on 4 vCPU / 8 GB** with room to spare: peak memory under 2 GiB, CPU
under one core on average, and first-token p95 of 1.3 s when the whole class asked
at once. Plan on 8 GB anyway, for the embedding model, Next.js and page caches.

- **Larger groups** weren't measured. Raise the limits below together, then run
  `pnpm capacity:check --students <n> --env …` on the target host before relying on
  it.
- **The model provider** usually sets the pace: its latency and its own rate limits
  on your API key.
- **Disk** is the uploaded files, plus about the size of storage for each kept
  backup, plus `MIN_FREE_STORAGE_BYTES`.

| What                                                      | Default              | Where                                                                   |
| --------------------------------------------------------- | -------------------- | ----------------------------------------------------------------------- |
| Replies running / per person                              | 32 / 4               | `MAX_ACTIVE_CHAT_JOBS`, `MAX_ACTIVE_CHAT_JOBS_PER_USER`                 |
| Open chat connections / per person                        | 128 / 16             | `MAX_CHAT_CONTROLLERS`, `MAX_CHAT_CONTROLLERS_PER_USER`                 |
| Model streams at once                                     | 32                   | `MAX_CONCURRENT_LLM_REQUESTS` (lower it for a small local model server) |
| Files indexed at once                                     | 4                    | `MAX_CONCURRENT_KNOWLEDGE_JOBS`                                         |
| Upload size                                               | 100 MiB              | `MAX_UPLOAD_FILE_SIZE_BYTES`                                            |
| Auth writes, uploads, chat connections per client address | 60, 60, 120 a minute | nginx in the image                                                      |
| Sign-ins per client address                               | 60 a minute          | Better Auth                                                             |
| Token budgets                                             | none                 | Admin Settings → Groups                                                 |
| Free storage before "not ready"                           | 1 GiB                | `MIN_FREE_STORAGE_BYTES`                                                |

What people see when a limit is reached:

- **Replies at their limit:** "Chat capacity is full. Retry shortly." with a retry.
  Nothing is lost; the message waits.
- **Connections at their limit:** "Chat connection capacity is full. Close an unused
  chat connection and retry."
- **Model streams at their limit:** replies start later, with no error.
- **Budget used up:** sending says the limit is reached and when it resets.
- **Too many requests from one address:** "Too many requests. Wait a minute and try
  again."
- **Disk nearly full:** readiness turns not ready and the container health check
  fails.

Watch Admin Settings → Status during a first busy class.

## 8. Monitoring

- **Health:** `GET /api/py/health/ready` (backend database, free storage, auth
  keys) and `GET /api/health` (auth database, signing) answer 200, or 503 naming
  the failed check. Both are public and need no token. The container health check
  uses them; point your uptime monitor at them through the proxy.
- **Admin Settings → Status:** readiness, version, uptime, replies and connections
  against their limits, the file queue, storage use and free space, and the last
  backup (flagged after two days).
- **Logs:** `docker compose logs`. Set `LOG_FORMAT=json` for a log collector. Each
  backend line carries the request id, which nginx logs too and returns in the
  `X-Request-ID` header, so a person's bug report can quote it. At INFO and above,
  logs contain no message text, file text, About you, tokens or secrets.
- **Alert on:** the container not healthy; free storage under a few GB; the last
  backup older than a day; replies running near `MAX_ACTIVE_CHAT_JOBS` for long
  periods; repeated 5xx or ERROR lines.
- **Usage:** Admin Settings → Usage reports tokens and cost by group, person and
  model.

## 9. Incident checklist

1. **Is it up?** `docker compose ps`; `curl -s https://<host>/api/py/health/ready`
   and `/api/health`. A 503 names the failed check.
2. **What changed?** A recent upgrade, configuration change, provider outage or a
   class starting at once.
3. **Read the logs** around the time, by request id if someone quoted one:
   `docker compose logs --since 30m | grep <request-id>`.
4. **By symptom:**
   - _Storage below the minimum:_ free disk space (old images:
     `docker image prune`; move old backups off the host). The app recovers on its
     own once space is free.
   - _Database busy:_ a long write holds the lock. It usually clears within seconds;
     if not, restart the container.
   - _Auth keys can't load or sign-in fails for everyone:_ check that
     `BETTER_AUTH_SECRET` and `SYSTEM_KEY` match what the data was created with.
   - _Replies slow or "capacity is full":_ Status shows replies and connections
     against their limits. Check the provider's status and rate limits, then
     consider raising the limits (see Limits).
   - _"Too many requests" for a whole class:_ check that `TRUSTED_PROXIES` names
     your proxy, so each person has their own address.
   - _Models fail:_ Admin Settings → Providers. Check the key and endpoint.
   - _"The backend database predates versioned migrations":_ the storage volume
     holds data from a development build before 0.2.0, which can't be upgraded.
     Remove it to start fresh, which deletes that data: `docker compose down`,
     find the volume with `docker volume ls` (`<project>_storage`), then
     `docker volume rm` it and start again.
5. **A compromised account:** suspend it in Admin Settings → Users. That ends its
   sessions and running work. Reset its password with a one-time link before
   reactivating it.
6. **Leaked secrets:** a leaked `ADMIN_PASSPHRASE` can be replaced in `.env`, then
   recreate the container. `BETTER_AUTH_SECRET` and `SYSTEM_KEY` have no rotation
   yet, because the auth signing keys and stored provider keys are encrypted with
   them. Restrict access to the host and rotate the provider API keys at the
   provider. Then re-enter them in Admin Settings → Providers.
7. **Data loss or corruption:** stop the app, keep the damaged volume, and restore
   the latest verified backup into a new volume
   ([Backup and restore](architecture/backup-and-restore.md)).
8. **Afterwards:** note what happened and the request ids involved, and rerun
   `pnpm capacity:check` if load was the cause.

## Configuration reference

The settings an operator normally sets. `pnpm config:check` (from a source checkout)
reports each one's source and status without printing values. The complete list,
with validation rules, is in
[ADR-0010](adr/0010-configuration-validation-secrets-and-safe-migration.md).

| Setting                                                 | Default                               | Meaning                                                                                                                                                                    |
| ------------------------------------------------------- | ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PUBLIC_URL`                                            | `http://localhost:3000`               | The browser-facing origin, without a trailing slash. Also the token issuer and audience, and the cookie origin. Production requires HTTPS unless it is a loopback address. |
| `BETTER_AUTH_SECRET`                                    | none, required                        | Protects authentication data and signing keys                                                                                                                              |
| `SYSTEM_KEY`                                            | none, required                        | Authorizes internal requests and encrypts stored provider keys                                                                                                             |
| `ADMIN_PASSPHRASE`                                      | none, required                        | Creates the first administrator                                                                                                                                            |
| `STORAGE_ROOT`                                          | `/storage` in the container           | Where all data lives; for local development, an absolute writable directory                                                                                                |
| `PORT`                                                  | `3000`                                | The host port Compose publishes                                                                                                                                            |
| `TRUSTED_PROXIES`                                       | none                                  | Addresses or CIDR networks, comma-separated, whose `X-Forwarded-For` nginx trusts                                                                                          |
| `MAX_UPLOAD_FILE_SIZE_BYTES`                            | 104857600 (100 MiB), also the maximum | The largest upload request. A lower value also lowers the file processing and vision image limits unless they are set                                                      |
| `LOG_LEVEL`                                             | `INFO`                                | `DEBUG`, `INFO`, `WARNING` or `ERROR`. `DEBUG` is for development                                                                                                          |
| `LOG_FORMAT`                                            | `text`                                | `text`, or `json` for one object per line                                                                                                                                  |
| `MIN_FREE_STORAGE_BYTES`                                | 1 GiB                                 | Free space below which readiness fails                                                                                                                                     |
| `MAX_ACTIVE_CHAT_JOBS`, `MAX_ACTIVE_CHAT_JOBS_PER_USER` | 32, 4                                 | Replies and chat titles running at once                                                                                                                                    |
| `MAX_CHAT_CONTROLLERS`, `MAX_CHAT_CONTROLLERS_PER_USER` | 128, 16                               | Open chat connections                                                                                                                                                      |
| `MAX_CONCURRENT_LLM_REQUESTS`                           | 32                                    | Model streams at once; lower it for a small local model server                                                                                                             |
| `MAX_CONCURRENT_KNOWLEDGE_JOBS`                         | 4                                     | Files processed at once                                                                                                                                                    |
| `BETTER_AUTH_DB_PATH`, `DB_URL`                         | in `STORAGE_ROOT`                     | Override the database locations; normally unnecessary                                                                                                                      |

**Secrets as files.** When `BETTER_AUTH_SECRET`, `SYSTEM_KEY` or `ADMIN_PASSPHRASE`
isn't set, the container reads `/run/secrets/BETTER_AUTH_SECRET` and so on. Use
exactly those uppercase names; an explicit environment value wins.

**Precedence.** A variable set in the process environment wins over `.env`, even
when it is empty, and an empty required value is then refused.

## .env file syntax

The `.env` file is read by the repository's launcher, by Docker Compose and by
`docker run --env-file`, which interpret quoting and escapes differently. So it
allows only syntax that means the same thing to all three:

```dotenv
# Full-line comments and blank lines are allowed.
PUBLIC_URL=http://localhost:3000
BETTER_AUTH_SECRET=abcDEF0123+/=_-.
EMPTY_OPTIONAL_VALUE=
```

Each line is one unquoted `KEY=VALUE` with no spaces around it. Keys use letters,
digits and underscores and don't start with a digit. Values may contain `=`. LF and
CRLF line endings both work. These are refused before anything starts:

```dotenv
VALUE="quoted"              # quotes
VALUE=two words             # whitespace
VALUE=$HOME                 # interpolation or dollar signs
VALUE=secret # comment      # inline comments
VALUE=line\nnext            # escapes and backslashes
export VALUE=secret         # shell syntax
```

Use paths without spaces and generated base64 or URL-safe secrets. A value that
can't follow these rules must be passed in the process environment instead.

## Security defaults

These are on without configuration
([ADR-0071](adr/0071-edge-hardening.md),
[authentication and security](architecture/auth-and-security.md#the-edge-nginx-and-the-browser)):

- Every page sends a content security policy with a fresh script nonce: no inline or
  third-party scripts, no frames except the canvas preview, and connections only to
  the app's own origin. API responses may not run, load or be framed.
- Every response sends `X-Content-Type-Options: nosniff` and
  `Referrer-Policy: same-origin`.
- With an `https://` `PUBLIC_URL`, responses send HSTS for a year and the
  authentication cookies are `Secure`, `HttpOnly` and `SameSite=Lax`.
- nginx limits each client address to 60 authentication writes, 60 uploads and 120
  chat connections a minute, each with a burst of 60. Refused requests get a 429 with
  `Retry-After`.
- nginx's log leaves out query strings, and the backend redacts tokens from its logs.
