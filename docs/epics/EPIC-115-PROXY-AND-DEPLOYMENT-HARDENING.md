# EPIC-115: Proxy and deployment hardening

Status: proposed (2026-11-26). Source: repository review (2026-11-26),
verified against the code at `40101ac7`.

## Objective

The bundled proxy trusts forwarded headers only from configured proxies,
long timeouts apply only to streams, and the container, setup script, secrets
and backups keep their files private.

## Stories

### US-115.1: The proxy trusts only what it should

As an operator, I want the bundled nginx to pass on only trusted request
details.

- [ ] The forwarded scheme is honoured only from trusted proxies; requests for
      unknown hosts are refused.
- [ ] The internal system-key header is removed from public requests.
- [ ] The one-hour timeouts and unbuffered proxying apply only to chat, events
      and other streaming routes.
- [ ] Readiness checks reuse a result for a few seconds.
- [ ] Tests (`check:image` or edge-config) and release note.

### US-115.2: Container and setup defaults

As an operator, I want the default deployment locked down.

- [ ] `docker-compose.yml` drops capabilities, sets `no-new-privileges` and a
      process limit; the host gateway mapping is documented as optional.
- [ ] `setup.mjs --force` leaves `.env` readable only by its owner.
- [ ] Secret files with Windows line endings give the same key in every
      entrypoint command.
- [ ] API docs are off in production.
- [ ] Release note (Configuration, Image).

### US-115.3: Backups restore privately and refuse a missing key

As an operator, I want a restore to keep data private and to stop when it
can't check the key.

- [ ] Restored databases are readable only by their owner.
- [ ] A restore stops when the backup recorded a system key and none is set.
- [ ] Extraction has total size and file count limits; vector table names are
      checked.
- [ ] A cancelled data export leaves no partial file.
- [ ] Tests, backup guide and release note.
