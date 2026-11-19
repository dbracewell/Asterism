# Capacity check

How many people one Asterism instance serves, how that was measured, and how to
measure it again ([ADR-0075](../adr/0075-capacity-check-and-sizing.md)). Read it
before changing an admission limit, a rate limit or how the browser fetches
tokens, and rerun the check afterwards. The sizing guide for
operators is in the [deployment guide](../deployment.md#7-sizing-and-limits).

## The scenario

`pnpm capacity:check` ([scripts/capacity-check.mjs](../../scripts/capacity-check.mjs))
plays one class against a disposable container:

- **The host.** The release image runs with `--cpus 4 --memory 8g` (swap off) on a new
  volume. The target is 30 active students on 4 vCPU / 8 GB.
- **The model.** An OpenAI-compatible double on the host streams like a hosted model.
  The first token arrives after 700 ms, then 40 tokens per second, 250 tokens per
  reply (about 7 s). Title requests answer after 800 ms. Measured times include the
  model's own 0.7 s, so the platform's share is the difference.
- **The class.** An admin and 30 students are created first, each student with a
  project and a deck of 8 flashcards. The embedding model is downloaded and one probe
  file indexed before the clock starts. Then:
  - Students arrive over the first 60 s and sign in, all from **one school address**
    (`X-Forwarded-For` through `TRUSTED_PROXIES`), the hardest case for per-address
    limits.
  - For 10 minutes each student waits 20–60 s between actions, then:
    - chats (65 %, with 30 % of turns starting a new chat);
    - uploads 40 KB of notes and polls until indexed (10 %);
    - reviews due flashcards, or adds cards (20 %);
    - or browses the chat list, the file library and the home page (5 %).
  - At 5 minutes **everyone asks at once**: each student sends a message within 5 s.
- **Like the browser.** Each backend call carries a token from `/api/auth/token`, sign-in
  sets session cookies, opening a chat renders `/c/{id}`, and a turn is sent over HTTP
  and streamed over the chat WebSocket. A refused sign-in is retried after a few
  seconds; a "capacity is full" reply is retried, as the page offers.
- **Measurements.** Every request's status and time; per turn, the time from sending to
  the first token and to the whole reply; uploads and time to indexed. Memory and CPU
  come from `docker stats` every 5 s plus the cgroup's peak. Replies running,
  connections and the knowledge queue come from Admin Settings → Status. The
  container log is checked for SQLite busy errors and ERROR lines.

## Targets

| Target                        | Limit                                                         |
| ----------------------------- | ------------------------------------------------------------- |
| Every student signs in        | sign-in p95 ≤ 15 s, nobody gives up                           |
| First token, steady           | p95 ≤ 3 s                                                     |
| First token, everyone at once | p95 ≤ 5 s                                                     |
| Turns                         | every turn finishes; no admission refusals                    |
| Requests                      | no 429 apart from retried sign-ins, no 5xx, no network errors |
| SQLite                        | no busy errors                                                |
| Uploads                       | all indexed, p95 ≤ 120 s                                      |
| Memory                        | peak ≤ 6 GiB (three quarters of the host)                     |

The script exits `1` when a target fails.

## Results (2026-11-18)

Run on Docker Desktop (4 CPUs, Apple silicon), image built from `main`. The "Before" column is the same
scenario before the four fixes described below.

| Measure                       | Before                                       | After                            |
| ----------------------------- | -------------------------------------------- | -------------------------------- |
| Sign-in                       | p95 69 s, max 84 s; 73 attempts refused      | p95 0.10 s; none refused         |
| Chat turns                    | 288; **95 failed** on refused token requests | 251; none failed                 |
| First token, steady           | p95 0.92 s                                   | p95 0.99 s                       |
| First token, everyone at once | p95 7.4 s                                    | p95 1.3 s                        |
| Whole reply, everyone at once | p95 13.5 s                                   | p95 7.6 s                        |
| Uploads                       | 34; 11 failed; indexed p95 12 s              | 33; none failed; indexed p95 3 s |
| Refused requests (429)        | 224                                          | 0                                |
| Token requests                | 1,262                                        | 30                               |
| Provider streams at once      | max 8                                        | max 29                           |
| Peak memory                   | 1.75 GiB                                     | 1.82 GiB                         |
| CPU (100 % = one core)        | mean 20 %, max 154 %                         | mean 31 %, max 220 %             |
| SQLite busy errors            | 0                                            | 0                                |

### What the run found

1. **Better Auth's sign-in limit.** Better Auth keeps its own in-memory limiter per
   address and path: 3 sign-ins per 10 s. A class on one address queued behind it for
   over a minute. Sign-in now allows 60 per minute per address, the same as nginx's
   auth limit ([auth-rate-limit.ts](../../apps/frontend/src/lib/auth-rate-limit.ts)).
2. **A token per backend call.** The browser's API client fetched `/api/auth/token`, which
   signs a new JWT, before every backend request. Better Auth allows 100 calls per 10 s
   per address on that path, so a class on one address ran out, and chats and uploads
   failed. The tab now reuses its token until a minute before it expires (tokens last
   15 minutes), with concurrent callers sharing one fetch. A 401, or a chat socket
   refused with 1008, drops it. On the server nothing is reused
   ([backend-token.ts](../../apps/frontend/src/lib/backend-token.ts)).
3. **Eight provider streams.** `MAX_CONCURRENT_LLM_REQUESTS` defaulted to 8, below the 32
   replies admitted, so a class asking at once waited for each other's replies. The
   default is now 32. Calls past the limit still wait rather than fail.
4. **A closed tab logged an error.** The chat controller's status packet to a socket that
   was closing logged a traceback at ERROR. It now ends quietly.

SQLite was not a bottleneck: WAL with a 5 s busy timeout recorded no busy errors, and
writes (messages, usage records, reviews, uploads) stayed well under its limit. Memory
was steady at under 2 GiB, mostly the embedding model and the Next.js server.

### Limits of the measurement

- One class, one host and a model double. A real provider adds its own latency and
  rate limits, which the instance cannot change.
- The double does not call tools, so delegation, search and image generation are not
  in the mix. Those add model calls per turn, not more local work.
- The machine that runs the script also runs Docker, so client and server share it.

## Running it

```bash
docker build -t asterism:local .
pnpm capacity:check                         # the scenario above
pnpm capacity:check --students 60 --env MAX_ACTIVE_CHAT_JOBS=64 --env MAX_CONCURRENT_LLM_REQUESTS=64
pnpm capacity:check --tokens per-request    # the browser's old behavior: a token per request
```

Results go to `.capacity/<time>/`: `summary.md` (the tables above), `summary.json`
(every request label with its status counts and percentiles, plus the 5-second
samples) and `container.log`. All options are listed in the
[scripts README](../../scripts/README.md#capacity-checkmjs). The run uses port 3900
and needs about 2 GB of free Docker disk space.
