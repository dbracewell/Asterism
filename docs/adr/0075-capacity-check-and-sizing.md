# ADR-0075 — Capacity check and sizing

Status: accepted and implemented for US-86.7 on 2026-11-18
([EPIC-86](../epics/EPIC-86-MULTI-USER-DEPLOYMENT-READINESS.md)).

## Context

EPIC-86 agreed a target of 30 active students on one 4 vCPU / 8 GB host. Nothing had
measured it. The admission limits (32 replies, 128 connections) were set by reasoning,
and the provider limit of 8 had no recorded rationale. US-86.5 had flagged Better
Auth's own sign-in limit as a possible problem for a class on one address.

## Decision

**A repeatable check, not a one-off.** `pnpm capacity:check` runs the release image in
a size-limited, disposable container with an OpenAI-compatible model double that
streams at hosted-model speed. Simulated students sign in, chat, upload and study the
way the browser does, from one shared address, with one burst where everyone asks at
once. It reports against fixed targets and exits non-zero when one fails. It is not
part of CI: it takes about 13 minutes and needs Docker with 4 CPUs. Run it before a
release that changes request patterns, limits or the runtime. The scenario, targets
and results are in [capacity](../architecture/capacity.md).

**Fixes, within the single-process design.**

- **Sign-in limit.** Better Auth's sign-in limit is raised from 3 per 10 s to 60 per
  minute per address, equal to nginx's auth limit, so the edge stays the binding
  limit. A test keeps the two in step. Other Better Auth limits keep their defaults.
- **Token reuse.** The browser reuses one backend JWT per tab until a minute before it
  expires, instead of signing one per backend request. The lifetime is measured from
  arrival using the token's own `exp − iat`, so a wrong browser clock cannot keep an
  expired token. A 401, or a chat socket refused with 1008, drops it. Server rendering
  never reuses a token, because a module-level value there would be shared between
  users. The backend still checks each token and refuses suspended accounts per
  request (ADR-0070), so reuse does not lengthen what a token can do.
- **Provider streams.** `MAX_CONCURRENT_LLM_REQUESTS` defaults to 32, matching
  `MAX_ACTIVE_CHAT_JOBS`. Calls past it still wait. Operators of a local model server
  lower it to what the server can stream.
- **Log noise.** A closing tab no longer logs an error from the controller's status
  loop.

SQLite settings were left alone: WAL, `synchronous=NORMAL` and a 5 s busy timeout
recorded no busy errors at the target.

## Consequences

- At the target, sign-in, chat, uploads and study pass with wide margins: peak memory
  under 2 GiB, CPU mean under one core, first token p95 1.3 s when everyone asks at
  once. That leaves room above 30 on this host, but no larger class was measured. The
  sizing guide says to measure before relying on it.
- A sign-in brute force from one address can try 60 passwords a minute, the rate nginx
  already allowed. Passwords stay at a minimum of 8 characters.
- Admin checks read the token's role (ADR-0058), so making or removing an admin reaches
  an open tab's backend calls within one token lifetime (15 minutes) or on reload.
  Suspension and group membership are read from the database on each request, so they
  apply at once.
- With the higher provider limit, a burst sends up to 32 streams to the provider at
  once, which may meet the provider's own rate limits.
