# ADR-0020 — Finite admission for chat work and controllers

Status: accepted and confirmed complete for US-34.4 on 2026-10-24.

## Decision

Keep the [single-process runtime](0019-single-process-runtime-and-storage-seams.md).
Use synchronous, non-waiting admission on its asyncio event loop. Check both the
global count and the authenticated owner's count before incrementing either.
There is no capacity waiting list or background retry task.

| Unit                          | Environment setting             | Default | Valid range               |
| ----------------------------- | ------------------------------- | ------- | ------------------------- |
| Active chat work              | `MAX_ACTIVE_CHAT_JOBS`          | 32      | 1–256                     |
| Active work per owner         | `MAX_ACTIVE_CHAT_JOBS_PER_USER` | 4       | 1–global work limit       |
| Reserved/attached controllers | `MAX_CHAT_CONTROLLERS`          | 128     | 1–512                     |
| Controllers per owner         | `MAX_CHAT_CONTROLLERS_PER_USER` | 16      | 1–global controller limit |

One work slot covers a chat's generation, title task and unresolved tool approvals.
Title-only work also requires a slot. A chat can have one generation and one title
task under that slot; reconnects reuse it. A work slot includes waits on provider
semaphores and user approval, and remains held during cancellation cleanup.
An idle attached chat retains its controller slot but releases its work slot.
Per-owner keys come from verified user identity, never command payloads.
These defaults are initial operator policy, not benchmark-derived capacity claims.

Reserve a controller immediately after JWT authentication, before history reads,
Agent construction, job creation or controller-owned queues/tasks. Owner-scoped
chat authorization still follows; failed authorization/loading releases the
reservation. Attach consumes that reservation exactly once. Reserve work before
creating the generation or title task. A rejected generation coroutine is closed
without running; persisted messages remain available for retry.

## Overload and retry

Both denials send an existing-compatible error packet:

```json
{
  "type": "error",
  "code": 503,
  "error_code": "chat_capacity",
  "retryable": true,
  "content": "Chat capacity is full. Retry shortly."
}
```

This is a WebSocket packet, not an HTTP response. Controller saturation accepts
only to send the packet, then closes with 1013. The browser's existing reconnect
policy allows ten attempts, three seconds apart, and displays the error.
Work saturation retains the admitted control channel: resume/regenerate may be
retried, and cancel/approval commands still bypass the sequential command queue.
It does not enqueue work to wait for capacity. REST message acceptance persists
the pending turn independently; retry resume/reconnect rather than posting a
duplicate message. No automatic work retry is added to an open socket.

Controller reservations release idempotently on disconnect, failed setup and
shutdown. A disconnect does not release active work or cancel its provider task.
Normal completion, provider failure and explicit cancellation release work once
generation, title and approvals are all terminal. Detached idle jobs and queues
retire as before. Deletion/shutdown cancel and await work, cancel leftover approval
futures and release its slot; shutdown also rejects new admissions and releases
all controllers. Task completion observes detached exceptions.

## Scope and consequences

This caps admitted chat runtimes/tasks/connections by count; it is not a byte,
history-size, request-rate or unauthenticated-handshake limit. Slow providers and
abandoned approval waits can occupy slots until cancellation or shutdown. There
is no priority, reservation for reconnects, guaranteed fairness or distributed
coordination. Saturated controller capacity may temporarily block reconnects.

Existing outbound and inbound queues retain their 256-packet bounds; the outbound
queue cache retains its 1,000-chat limit. Existing model request concurrency
(default eight), knowledge job execution concurrency (four), embedding/vector
operation concurrency (two each), and local caption concurrency (one) remain
separate gates. The knowledge keyed job manager deduplicates keys and limits
execution with a semaphore; its waiting task registry has no finite admission
cap. This story does not change that queue or certify general multi-user load.

`ChatJobManager.count`, `active_count` and `controller_count` are content-free
in-process diagnostic properties, not new HTTP/admin endpoints. Validation and
lifecycle evidence are recorded in the
[story verification](../reviews/us-34.4-verification-2026-10-24.md).
