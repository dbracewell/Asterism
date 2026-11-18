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
  [Sizing and capacity](../README.md#sizing-and-capacity) for other sizes.
- **Disk:** the image is large (ML libraries). Storage holds uploaded files, the
  databases and vectors. Backups need about the size of storage per kept archive.
  Keep at least `MIN_FREE_STORAGE_BYTES` (1 GiB) free, or readiness fails.
- **A DNS name and a TLS proxy** in front of the container (examples below).
  Asterism serves plain HTTP on port 3000 and expects TLS to end at the proxy.
- **A model provider:** an OpenAI API key, or any OpenAI-compatible endpoint
  (hosted, or a local server such as one on the same network).
- **Outbound internet on first start**, to download the pinned embedding model
  used to index files.

## 2. Configure

```bash
git clone <your fork or release> asterism && cd asterism
cp .env.example .env
openssl rand -base64 32   # run three times: one value for each secret below
```

Set in `.env`:

| Setting | Value |
| --- | --- |
| `PUBLIC_URL` | The browser-facing origin, e.g. `https://asterism.example.edu`, no trailing slash. It is also the JWT issuer and the cookie origin. |
| `BETTER_AUTH_SECRET` | Random. Encrypts the auth signing keys. **Never change it**: every session and the signing keys depend on it. |
| `SYSTEM_KEY` | Random. Signs internal requests and encrypts stored provider keys. **Never change it**: backups refuse to restore with a different one. |
| `ADMIN_PASSPHRASE` | Random. Used once, to create the first administrator. |
| `TRUSTED_PROXIES` | The TLS proxy's address or network, e.g. `172.18.0.0/16`. Without it, every request seems to come from the proxy, and the per-address rate limits apply to everyone at once. |

All settings, with defaults: [Configuration](../README.md#configuration) and
`.env.example`. The values are validated before anything starts, and a bad value
names the setting.

**Secrets.** Keep `.env` readable only by the account that runs Compose
(`chmod 600 .env`). Orchestrators can mount files instead, at
`/run/secrets/BETTER_AUTH_SECRET`, `/run/secrets/SYSTEM_KEY` and
`/run/secrets/ADMIN_PASSPHRASE`. Store copies of `BETTER_AUTH_SECRET` and
`SYSTEM_KEY` somewhere safe and apart from the backups: backups do not contain them,
and a restore needs the same values.

## 3. Start

```bash
docker compose up -d --build
docker compose ps        # wait for "healthy"
docker compose logs -f
```

The first start downloads the embedding model, migrates both databases and then
reports healthy. Compose publishes port 3000 on `127.0.0.1` only, so only the proxy
on the same host reaches it.

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
are described in [Docker](../README.md#docker) and
[ADR-0071](adr/0071-edge-hardening.md).

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

## 6. Backups and upgrades

Back up nightly, and before every upgrade, while the app runs:

```bash
docker compose exec -T asterism /app/docker/entrypoint.sh backup --keep 14
docker compose exec -T asterism /app/docker/entrypoint.sh verify /backups/<file>
```

Copy the `backups` volume off the host. The cron schedule, restore steps and the
upgrade and roll-back procedure are in
[Backup and restore](architecture/backup-and-restore.md). In short, to upgrade:

1. Read the release notes for configuration changes.
2. Back up and verify.
3. `git pull && docker compose up -d --build`. Migrations run on start and only go
   forward.
4. Check `docker compose ps` is healthy and Status shows the new version.

To go back, restore the pre-upgrade backup with the previous image. The upgraded
data cannot be opened by the older image.

People's "Download my data" archives are kept for 7 days under `exports/` in
storage. They are not in backups.

## 7. Limits

| What | Default | Where |
| --- | --- | --- |
| Replies running / per person | 32 / 4 | `MAX_ACTIVE_CHAT_JOBS`, `MAX_ACTIVE_CHAT_JOBS_PER_USER` |
| Open chat connections / per person | 128 / 16 | `MAX_CHAT_CONTROLLERS`, `MAX_CHAT_CONTROLLERS_PER_USER` |
| Model streams at once | 32 | `MAX_CONCURRENT_LLM_REQUESTS` (lower it for a small local model server) |
| Files indexed at once | 4 | `MAX_CONCURRENT_KNOWLEDGE_JOBS` |
| Upload size | 100 MiB | `MAX_UPLOAD_FILE_SIZE_BYTES` |
| Auth writes, uploads, chat connections per client address | 60, 60, 120 a minute | nginx in the image |
| Sign-ins per client address | 60 a minute | Better Auth |
| Token budgets | none | Admin Settings → Groups |
| Free storage before "not ready" | 1 GiB | `MIN_FREE_STORAGE_BYTES` |

What people see when a limit is reached:
[Sizing and capacity](../README.md#sizing-and-capacity).

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
   - *Storage below the minimum:* free disk space (old images:
     `docker image prune`; move old backups off the host). The app recovers on its
     own once space is free.
   - *Database busy:* a long write holds the lock. It usually clears within seconds;
     if not, restart the container.
   - *Auth keys can't load or sign-in fails for everyone:* check that
     `BETTER_AUTH_SECRET` and `SYSTEM_KEY` match what the data was created with.
   - *Replies slow or "capacity is full":* Status shows replies and connections
     against their limits. Check the provider's status and rate limits, then
     consider raising the limits (see Limits).
   - *"Too many requests" for a whole class:* check that `TRUSTED_PROXIES` names
     your proxy, so each person has their own address.
   - *Models fail:* Admin Settings → Providers. Check the key and endpoint.
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
