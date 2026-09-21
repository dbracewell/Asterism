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
| `_encoding` LRU cache | Administrator-configured model name; `tiktoken.Encoding` | Lookup on context estimate; never invalidated | **Unbounded** `lru_cache`. **US-16.3.** |
| `_user_cache` | authenticated user ID → existence boolean | Create/lookup; delete removes the entry | `TTLCache(maxsize=100, ttl=1h)`; expiry is lazy on cache operations. Finite, but cache accounting/idle expiry review belongs to **US-16.3**. |
| `component_registry` and `tool_registry` | Decorator-discovered, code-defined component/tool names; component singletons | Startup decorator loading; no teardown | Expected finite static registry. Singleton lifetime and shutdown semantics require verification in **US-16.3**. |
| `event_bus.handlers` | Decorator module/function names; registered at startup | Startup registration; no unregister | Expected finite static registry. `emit` creates one untracked task per handler/event, so burst concurrency and shutdown are **unbounded: US-16.3**. |
| `_draft_model` | One draft client | Lazy lookup; reset on `DRAFT_MODEL_UPDATED` | One process singleton; bounded. Provider client shutdown is reviewed with component shutdown in **US-16.3**. |
| `__existing_loggers` | Logger name; `ChatController` uses a chat-ID-specific name | First `get_logger`; never removed | **Unbounded** for unique chats/connections. **US-16.3-T4a** adds a bounded/non-cardinality logger policy. |
| DB/config/security/router/module constants | Process singleton or code/config-defined keys | Process shutdown/module unload | Bounded or dependency-owned; no user/request-keyed application retention found. SQLite/JWKS library caches are out of scope. |
| SSE `sseEmitter` | Process-global EventEmitter; one listener per GET stream | Listener added after stream initialization; removed on abort/enqueue failure | Max listener warning is 50, not a hard cap. `cancel()` is empty and initialization/abort cleanup is not fully idempotent. **US-16.4.** |
| SSE heartbeat | One interval per GET stream | Cleared by `cleanup` on selected paths | Can remain after stream cancellation because `cancel()` does nothing. **US-16.4.** |
| SSE rate-limit map and cleanup interval | forwarded-IP string → counter/window | POST creates/updates; module interval lazily removes expired entries | Map has no capacity; high-cardinality headers retain entries for up to cleanup cadence/window. Interval is process lifetime. **US-16.4.** |
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

The epic already assigns job/queue cleanup to US-16.2, cache/event work to
US-16.3, and SSE/client lifecycle work to US-16.4. The following accepted audit
findings make the previously broad tasks explicit:

- **US-16.3-T4a:** Replace the chat-ID-keyed logger cache with a bounded policy
  or use a stable logger name plus structured chat correlation; test many chats.
- **US-16.4-T1a:** Remove payload-bearing SSE POST logging and make stream cleanup
  shared, idempotent, and reachable from `start` failure, abort, and `cancel`.
- **US-16.4-T3a:** Cap normalized client-IP cardinality and replace the
  module-global cleanup interval with lifecycle-owned cleanup or a bounded
  on-access policy; test high-cardinality input.

No implementation begins on these paths until the dependent story starts.
