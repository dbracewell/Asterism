# ADR-0016 — Process-lifetime resource contracts

**Status:** Accepted for US-16.1; remediation is scheduled in US-16.2–US-16.5.

## Context

Asterism has process-local chat generation, backend registries, and a Next.js SSE
fan-out endpoint. This audit records application-owned retained state only. It
excludes generated clients and dependency internals unless Asterism supplies the
key or retains the object. No payloads were collected.

## Decisions

- Process-local chat work is deliberately non-durable: a backend restart cancels
  it and does not resume it.
- Static registries may live for a process only when their keys are code-defined
  and finite. Request, chat, user, model-name, IP, and connection keys require a
  finite capacity and/or TTL plus a cleanup owner.
- TTL is a fallback, not deletion cleanup. A deleted chat must eagerly release
  its job and outbound queue.
- Aggregate counts/ages are the only permitted lifecycle diagnostics; prompts,
  event payloads, attachment contents, tokens, and secrets must not be logged.

## Inventory and current contracts

| Resource | Owner / key source / retained graph | Creation and current cleanup | Bound and audit outcome |
| --- | --- | --- | --- |
| `chat_jobs._jobs` | `ChatJobManager`; chat UUID; job → orchestrator → agent/history, generation/title tasks, approvals | First WebSocket creates it; no removal on completion, cancellation, disconnect, or deletion; no lifespan cleanup | **Unbounded.** US-16.2 owns lifecycle, deletion, and shutdown. |
| `_queue_cache` | chat UUID; `asyncio.Queue` of outbound packets | Lazy creation by controller/orchestrator; TTL cache only, no explicit removal; packets have no `maxsize` | `maxsize=100000`, 24-hour sliding TTL, but lazy expiry and unbounded packets make this inadequate. **US-16.2.** |
| Per-controller inbound queue and worker tasks | One WebSocket; commands and heartbeat/status/message workers | Created on connect; controller cancels worker manager on exit. Command-loop tasks are separately gathered | Per connection and normally released, but task-manager shutdown only cancels and does not await. **US-16.2.** |
| Approval queues/futures and agent tool/sub-agent tasks | One active orchestrator/turn | Created per tool call/turn; released when the turn ends or is cancelled | Bounded by the agent iteration/tool behavior, but retained indefinitely through an unretired job. **US-16.2.** |
| `_encoding` LRU cache | Administrator-configured model name; `tiktoken.Encoding` | Lookup on context estimate; LRU eviction | Bounded at 128 model names. **US-16.3 implemented.** |
| `_user_cache` | authenticated user ID → existence boolean | Create/lookup; delete removes the entry | `TTLCache(maxsize=100, ttl=1h)`; expiry is lazy on cache operations but capacity is finite and delete eagerly invalidates. |
| `component_registry` and `tool_registry` | Decorator-discovered, code-defined component/tool names; component singletons | Startup decorator loading; no teardown | Finite static registry: startup loads only shipped decorators, and singleton keys derive from finite component type/name pairs rather than user input. |
| `event_bus.handlers` | Decorator module/function names; registered at startup | Startup registration; no unregister | Static finite registry. Dispatch tracks at most 100 handler tasks, drops excess work without payload logging, and cancels/awaits work at shutdown. **US-16.3 implemented.** |
| `_draft_model` | One draft client | Lazy lookup; reset on `DRAFT_MODEL_UPDATED` | One process singleton; bounded. Provider client shutdown is reviewed with component shutdown in **US-16.3**. |
| `__existing_loggers` | Code-defined logger names | First `get_logger`; never removed | Bounded: chat and agent paths now use stable logger names rather than chat UUIDs/profile names. **US-16.3-T4a implemented.** |
| DB/config/security/router/module constants | Process singleton or code/config-defined keys | Process shutdown/module unload | Bounded or dependency-owned; no user/request-keyed application retention found. SQLite/JWKS library caches are out of scope. |
| SSE `sseEmitter` | Process-global EventEmitter; one listener per GET stream | Stream-owned idempotent cleanup runs for abort, enqueue failure, initialization failure, and `cancel()` | Hard cap of 50 listeners; new streams receive 503 at capacity. **US-16.4 implemented.** |
| SSE heartbeat | One interval per GET stream | Shared stream cleanup clears it on all terminal paths | Bounded by the 50-stream cap. **US-16.4 implemented.** |
| SSE rate-limit map | normalized first forwarded-IP token → counter/window | POST creates/updates; on-access expiry removes stale entries | Hard cap of 10,000 entries, 60-second window, no process-global interval; over-capacity requests are rejected. **US-16.4 implemented.** |
| Frontend event bus | Browser singleton; finite event type → mounted handler set | Hook subscriptions unsubscribe on effect cleanup | Mount-owned and eager cleanup. Navigation/reconnect churn remains a **US-16.4** regression check. |
| Shared worker, WebSocket hook, DOM listeners/timers | Browser component/hook instance | Effects remove listeners and clear timers; worker posts unload | No process-global request keys. Worker port closure and reconnect/unmount behavior need churn verification in **US-16.4**. |
| Query client, theme map, server action/request caches | App singleton / filesystem theme names / request-scoped React cache | Query client is app lifetime; theme map resets on theme refresh/save; React cache follows request | Query data is governed by React Query; theme count is filesystem-admin-controlled. No unbounded request-keyed map found, but component/client cache policy is reviewed in **US-16.4**. |

## Lifecycle evidence

The audit exercised existing deterministic backend tests in
`apps/backend/tests/test_chat_jobs.py` for shared jobs, completed generation,
explicit cancellation, controller disconnect/reconnect semantics, title-provider
failure, and partial-message persistence. Source-path tracing additionally found:

- chat deletion currently has no runtime retirement call;
- `EventBus.emit()` schedules handler work without retaining its task;
- distinct model names grow `_encoding.cache_info().currsize` without a maximum;
- distinct forwarded IP values add rate-limit map entries until lazy expiry;
- SSE abort removes a listener, but `ReadableStream.cancel()` does not invoke the
  same cleanup.

The last four observations are intentionally not production behavior changes;
they are the reproducible source/harness conditions for the remediation stories.

## US-16.2 chat-runtime contract

A `ChatJob` is created only for an attached controller and owns the generation
and title tasks plus pending approvals. A transient controller detach leaves
active work untouched. When the last controller detaches, the manager retires
only an idle job: no active generation/title task and no unresolved approval.
Retirement removes the job and eagerly drains/removes its outbound queue.

Explicit cancellation retains the job until its cancellation finalization is
complete, then follows the same idle rule. Chat deletion verifies ownership,
cancels and awaits the runtime, removes queued packets, and only then deletes
persistence. Backend shutdown rejects new jobs, cancels/awaits all existing
jobs, and removes their queues; jobs are not durable across restart.

Queues retain at most 256 packets per chat, with at most 1,000 cached chat
queues and a five-minute sliding TTL fallback. On overflow, the oldest packet
is discarded to preserve current progress; tests can inspect the queue's
content-free dropped-packet counter. Active work is never TTL-evicted.

## Required follow-up tasks

The epic assigned job/queue cleanup to US-16.2, cache/event work to US-16.3,
and SSE/client lifecycle work to US-16.4. All accepted audit follow-ups are now
implemented: payload-bearing SSE POST logging was removed, stream cleanup is
shared and idempotent, and normalized IP keys use capped on-access expiry rather
than a process-global cleanup interval.

## Operations

A backend restart deliberately cancels in-process chat generation and does not
resume it. Operators can investigate resource pressure using content-free
aggregate counters: `ChatJobManager.count`, `message_queue_count()`, a queue's
`dropped_packets`, `encoding_cache_size()`, EventBus `pending_task_count` and
`dropped_handler_dispatches`, SSE listener count, and rate-limit entry count.

Expected hard limits are 1,000 cached chat queues with 256 packets each, 128
token encodings, 100 event-handler tasks, 50 SSE listeners, and 10,000
rate-limit entries. Queue and event overflow discard old packets or handler
dispatches respectively; SSE and rate-limit overflow reject the new connection
or request. These diagnostics intentionally exclude user content, attachment
metadata, prompts, tokens, event payloads, and secrets.
