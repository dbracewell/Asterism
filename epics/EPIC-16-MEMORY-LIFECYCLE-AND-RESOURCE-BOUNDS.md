# EPIC-16 — Memory Lifecycle and Resource Bounds

## Goal

Ensure long-running Asterism processes have explicit ownership, eviction, and
shutdown behavior for in-memory state and background work. A busy application
must not retain one object, queue, listener, task, or cache entry indefinitely per
chat, user, model name, connection, or request.

**Status: Completed — US-16.1–US-16.5 verified and user-confirmed.**

## Why now

`ChatJobManager` currently retains every chat job it has ever created in its
process-local `_jobs` dictionary. A job is not removed after completion,
cancellation, disconnection, or chat deletion, and it retains its orchestrator,
agent, and in-memory chat history. This is an unbounded process-lifetime growth
path.

The initial code review also identifies lifecycle-sensitive mechanisms that must
be verified and either bounded or deliberately documented:

- The per-chat `message_queue` cache has a large (100,000) sliding TTL capacity;
  its queues can retain undelivered packets and are not explicitly removed with a
  job or deleted chat.
- The LLM token-encoding helper uses an unbounded `lru_cache`, keyed by model
  name. Model names can originate in administrator-managed provider data.
- Backend event dispatch creates untracked tasks per emitted event. The registered
  handler map is expected to be static, but task concurrency, cancellation, and
  shutdown need an explicit contract.
- The frontend server's process-global SSE `EventEmitter` and IP rate-limit map
  rely on connection cleanup and periodic expiry. Stream cancellation, listener
  removal, and map bounds must be proven under disconnect/error paths.

This list is an initial inventory, not a conclusion that every item is a leak.
The audit story must inspect all application-owned long-lived state, timers,
listeners, task registries, caches, and queues in both workspaces. Third-party
library internals are out of scope unless Asterism supplies unbounded keys or
retains their objects.

## Guardrails and decisions to make

- Preserve EPIC-15's contract: a transient socket disconnect does not cancel an
  active generation and a reconnect can observe it while the backend process is
  alive.
- Explicit chat cancellation and chat deletion must release associated in-memory
  resources safely. Deletion must cancel active work before it can write further
  chat state.
- Do not evict active generation, title-generation, approval, or delivery state.
  Define an idle criterion and make removal race-safe on the asyncio event loop.
- All new or retained in-memory stores require a documented maximum cardinality
  and/or TTL, key source, eviction trigger, and testable cleanup path.
- Prefer deterministic lifecycle cleanup over waiting for lazy TTL expiry. TTL is
  a fallback, not the sole mechanism for deleted resources.
- Define behavior across backend restart explicitly; process-local jobs are not
  durable work queues.
- Add bounded observability only (counts/ages/metrics); do not log message,
  attachment, prompt, token, or secret content.

## User stories

### US-16.1 — Audit process-lifetime state and define resource contracts

**As an operator**, I want a complete, evidence-based inventory of application
in-memory state so that each long-running resource has an owner and a bound.

**Dependencies:** None.

- [ ] US-16.1-T1: Inventory backend and frontend application-owned module globals,
      singleton registries, caches, maps/dictionaries, queues, timers, event
      listeners, background tasks, and connection state; exclude generated code and
      dependency internals unless Asterism controls the keys or retention.
- [ ] US-16.1-T2: For every item, record owner, key cardinality/source, retained
      object graph, creation path, normal/error/disconnect/deletion/shutdown cleanup,
      current bound/TTL, and whether expiry is eager or lazy.
- [ ] US-16.1-T3: Exercise representative lifecycle paths with tests or a small
      harness: completed/cancelled/deleted chat, reconnect, provider failure,
      WebSocket/SSE disconnect, event-handler failure, and high-cardinality model/IP
      input.
- [ ] US-16.1-T4: Publish the inventory and accepted resource contracts in an
      ADR-style note; turn every unresolved unbounded path into a subsequent epic
      task before implementation begins.

**Acceptance criteria**

- The inventory covers both `apps/backend` and `apps/frontend` and distinguishes
  bounded caches from process-lifetime registries.
- Every retained application object has an explicit owner and cleanup/bound, or a
  documented reason and user-approved follow-up.
- The audit neither changes production behavior nor records sensitive payloads.

### US-16.2 — Give chat jobs and outbound queues an explicit lifecycle

**As an operator**, I want completed, cancelled, and deleted chats to release
runtime state without breaking active-generation reconnects.

**Dependencies:** US-16.1.

- [ ] US-16.2-T1: Define a `ChatJob` lifecycle/state contract including active
      generation, title task, pending approvals, connected controllers, idle state,
      explicit cancellation, deletion, and backend shutdown.
- [ ] US-16.2-T2: Add race-safe `ChatJobManager` removal/retirement APIs and
      controller attach/detach tracking. Remove an idle completed job after its last
      controller detaches; never remove a job with active work or an approval wait.
- [ ] US-16.2-T3: Couple chat deletion to runtime retirement: verify ownership,
      cancel/await active job safely, discard queued packets, then delete persistence
      without allowing late writes or recreation of stale state.
- [ ] US-16.2-T4: Replace or constrain the per-chat message-queue cache so queues
      have explicit removal with job retirement/deletion, a bounded fallback policy,
      and a defined packet/backpressure limit for disconnected clients.
- [ ] US-16.2-T5: Add lifespan shutdown cleanup that cancels/awaits active jobs
      and releases queues without masking shutdown errors.
- [ ] US-16.2-T6: Add backend tests for completion, cancellation, reconnect,
      duplicate connections, deletion during/after generation, queued-event bounds,
      expiry fallback, and shutdown; assert manager/queue cardinality returns to the
      expected baseline.

**Acceptance criteria**

- A transient disconnect preserves an active job and reconnect semantics.
- Completed/cancelled idle jobs and their queues become unreachable promptly.
- Deleting a chat removes its runtime state and prevents late persistence writes.
- Active work is never silently evicted; queue growth has a tested bound and
  documented overflow behavior.

### US-16.3 — Bound backend caches and background event work

**As an operator**, I want backend caches and fire-and-forget work to remain
bounded under high-cardinality input and slow consumers.

**Dependencies:** US-16.1.

- [ ] US-16.3-T1: Apply an explicit finite cache size and suitable invalidation to
      token encodings; test many distinct administrator-provided model names and
      preserve known-model behavior.
- [ ] US-16.3-T2: Review `SlidingTTLCache` use for lazy-expiry behavior, cache
      size accounting, and expiration under idle traffic; fix or replace it where its
      contract cannot meet US-16.1's resource requirements.
- [ ] US-16.3-T3: Define bounded concurrency, ownership, error handling, and
      shutdown behavior for backend event-dispatch tasks. Keep static handler
      registration separate from request/user-keyed retained state.
- [ ] US-16.3-T4: Review component singletons and user caches against the
      inventory; add limits, invalidation, or lifecycle cleanup only where evidence
      requires it.
- [ ] US-16.3-T5: Add focused tests for cache eviction/expiry, task failure,
      cancellation, and shutdown; expose only safe aggregate diagnostics needed to
      verify bounds.

**Acceptance criteria**

- No backend cache keyed by user-controlled or administrator-configured data is
  unbounded.
- Event bursts cannot create unbounded retained tasks or prevent clean shutdown.
- Static registries are documented as finite and do not accidentally retain
  request/chat/user objects.

### US-16.4 — Bound frontend server SSE and request-lifecycle state

**As an operator**, I want the Next.js server to release listeners, intervals, and
rate-limit entries when clients disconnect or requests fail.

**Dependencies:** US-16.1.

- [ ] US-16.4-T1: Verify SSE cleanup for request abort, stream cancellation,
      enqueue failure, and initialization failure; make cleanup idempotent and ensure
      every path clears the heartbeat and removes the global emitter listener.
- [ ] US-16.4-T2: Bound the server-global SSE listener population and specify
      behavior when the listener threshold is reached; ensure diagnostics do not
      expose user/event payloads.
- [ ] US-16.4-T3: Verify and, if necessary, bound the IP rate-limit store under
      high-cardinality forwarded addresses; test expiry and cleanup scheduling across
      server lifecycle.
- [ ] US-16.4-T4: Audit client-side timers, WebSocket hooks, subscriptions, and
      global event-bus handlers for mount/unmount cleanup; add regression tests for
      navigation and reconnect cycles.
- [ ] US-16.4-T5: Add frontend unit/integration coverage and an isolated
      connection-churn harness where needed.

**Acceptance criteria**

- Repeated SSE/WebSocket connect-disconnect cycles return listener/timer state to
  baseline.
- Server-global request-keyed maps have finite capacity and tested expiry.
- Normal event delivery and authenticated user filtering remain unchanged.

### US-16.5 — Verify long-run bounds and document operations

**As an operator**, I want repeatable evidence that resource use stabilizes during
extended traffic rather than only passing short unit tests.

**Dependencies:** US-16.2, US-16.3, US-16.4.

- [ ] US-16.5-T1: Build deterministic backend and frontend churn scenarios for
      many unique chats, users/model names, reconnects, cancellations, deletions,
      SSE clients, and event bursts without external provider dependencies.
- [ ] US-16.5-T2: Assert resource counters/cardinality and task/listener counts
      plateau within documented bounds after cleanup/TTL windows; fail on regression.
- [ ] US-16.5-T3: Run focused and full lint, typecheck, unit/integration, and E2E
      checks; regenerate the Hey API client if an API contract changes.
- [ ] US-16.5-T4: Update runtime architecture and operator documentation with
      ownership, limits, eviction/overflow behavior, restart semantics, and safe
      diagnostics.

**Acceptance criteria**

- Churn tests demonstrate that each audited resource returns to its documented
  steady state or finite capacity.
- Production behavior, security boundaries, and EPIC-15 reconnect semantics are
  preserved.
- Documentation gives operators enough information to detect and investigate a
  resource-bound breach without exposing user content.

## Execution

Order: **US-16.1 → US-16.2 → US-16.3 → US-16.4 → US-16.5**. Work on one story at
a time. Create a feature branch only when starting a story. Regenerate the Hey API
client after OpenAPI changes and request user confirmation before merging each
completed story.
