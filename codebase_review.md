# Asterism Codebase Review & Improvement List

Findings are grouped by priority tier across the backend (`apps/backend/asterism`), frontend (`apps/frontend/src`), and root scripts (`scripts/`).

---

## Tier 1: High-Priority Bugs & Runtime Issues

### 1. Per-Token Database Query Storm in `Agent.run` Streaming Loop (Backend)
- **Where:**
  - [`apps/backend/asterism/domains/agent/agent.py`](apps/backend/asterism/domains/agent/agent.py#L122-L136) (`_check_authorization`)
  - [`apps/backend/asterism/domains/agent/agent.py`](apps/backend/asterism/domains/agent/agent.py#L774-L780) (`Agent.run` streaming loop)
  - [`apps/backend/asterism/domains/chat/personas.py`](apps/backend/asterism/domains/chat/personas.py#L77-L83) (`validate_persona_access`)
  - [`apps/backend/asterism/domains/chat/skills.py`](apps/backend/asterism/domains/chat/skills.py#L100-L104) (`validate_execution_skills`)
- **Problem:** Inside `async for event in client.chat(...):`, `await self.authorization_check()` runs on **every single yielded token** (`TEXT_DELTA` and `THINKING_DELTA`). Because every user has a default persona, `_check_authorization()` opens a fresh SQLAlchemy session and queries `PersonaModel` (plus 3 queries in `validate_execution_skills` when skills are active, plus sub-agent checks) on every token. A 1,000-token response opens **1,000–3,000+ DB sessions and executes thousands of SQLite queries** inline during token streaming.
- **Improvement:** Run `await self.authorization_check()` at the start of each agent loop iteration (`line 754`), on `LLMEventType.START`, and on `LLMEventType.COMPLETE` (before recording steps or executing tool calls), or throttle checks to once every 1–2 seconds during delta streaming.

### 2. Failed/Empty Agent Turns Stay `PENDING` and Re-Execute on Every WebSocket Reconnect (Backend)
- **Where:**
  - [`apps/backend/asterism/domains/chat/orchestrator.py`](apps/backend/asterism/domains/chat/orchestrator.py#L731-L738)
  - [`apps/backend/asterism/domains/chat/orchestrator.py`](apps/backend/asterism/domains/chat/orchestrator.py#L811-L820)
  - [`apps/backend/asterism/domains/chat/controller.py`](apps/backend/asterism/domains/chat/controller.py#L56-L57)
- **Problem:** When `Agent.run()` yields `AgentEventType.ERROR`, returns an empty `COMPLETE` event, or raises an unhandled exception, `ChatOrchestrator.run_agent` pushes an error packet to the queue and exits **without transitioning `parent_message.status` (or `_fork_step`) out of `MessageStatus.PENDING` in the database**. Because `ChatController.run()` automatically calls `resume_pending_turn()` whenever a WebSocket connects and the job is idle, a failed turn retries the failing LLM call on every page reload or reconnect.
- **Improvement:** Add a failure finalizer in `ChatOrchestrator.run_agent` (similar to `_persist_interrupted_turn` at lines 822–867) so failed turns transition out of `PENDING` in the database before `run_agent` returns.

### 3. Multi-Tab WebSocket Stream Corruption via Shared `asyncio.Queue` (Backend)
- **Where:**
  - [`apps/backend/asterism/domains/chat/controller.py`](apps/backend/asterism/domains/chat/controller.py#L40-L41) & [`lines 153-182`](apps/backend/asterism/domains/chat/controller.py#L153-L182)
  - [`apps/backend/asterism/domains/chat/message_queue.py`](apps/backend/asterism/domains/chat/message_queue.py#L12-L45)
  - [`apps/backend/asterism/domains/chat/jobs.py`](apps/backend/asterism/domains/chat/jobs.py#L181-L193)
- **Problem:** `ChatJobManager` supports multiple concurrent `ChatController` connections per chat (`job.controllers += 1`), but all controllers for a `chat_id` consume from the **same singleton `asyncio.Queue`**. Because `asyncio.Queue.get()` delivers each item to only one waiting consumer, having the same chat open in two browser tabs causes the two controllers to steal alternating `DELTA` and `COMPLETE` packets from each other.
- **Improvement:** Give each connected `ChatController` its own subscriber `asyncio.Queue` registered on `ChatJob` (fan-out broadcast), buffering on `ChatJob` only while zero controllers are attached.

### 4. `APIImage` Immediately Revokes Its Full-Resolution `blob:` URL on Load (Frontend)
- **Where:** [`apps/frontend/src/components/api-image.tsx`](apps/frontend/src/components/api-image.tsx#L105-L146)
- **Problem:**
  1. The `useEffect` that fetches the full-size image includes `fullImageUrl` in its dependency array (`[isOpen, fullImageUrl, chatId, fileId, filename]`). As soon as `fetchFull()` resolves and calls `setFullImageUrl(objectUrl)`, the effect re-runs and executes the previous cleanup (`URL.revokeObjectURL(objectUrl)`), **immediately revoking the `blob:` URL that was just stored in state**.
  2. If `filename` or `fileId` changes while mounted, `fullImageUrl` is never reset.
  3. It violates `AGENTS.md` §3.2 by fetching manually inside `useEffect` instead of using TanStack Query.
- **Improvement:** Fetch the blob with `useQuery` (`enabled: isOpen`, `staleTime: Infinity`) and manage `URL.createObjectURL` / `URL.revokeObjectURL` in a separate `useEffect([data])` hook (matching [`apps/frontend/src/components/markdown-viewer/inline-files.tsx`](apps/frontend/src/components/markdown-viewer/inline-files.tsx#L197-L225)).

### 5. "Test Connection" (`componentsTestMutation`) Triggers Global Query Invalidation and Wipes Unsaved Form Edits (Frontend)
- **Where:**
  - [`apps/frontend/src/features/settings/ui/admin-settings/component-settings.tsx`](apps/frontend/src/features/settings/ui/admin-settings/component-settings.tsx#L76-L84) & [`lines 266-271`](apps/frontend/src/features/settings/ui/admin-settings/component-settings.tsx#L266-L271)
  - [`apps/frontend/src/features/settings/ui/admin-settings/tools-settings.tsx`](apps/frontend/src/features/settings/ui/admin-settings/tools-settings.tsx#L61-L70)
  - [`apps/frontend/src/features/settings/ui/admin-settings/image-gen-settings.tsx`](apps/frontend/src/features/settings/ui/admin-settings/image-gen-settings.tsx#L189)
- **Problem:** `componentsTestMutation` in `ParameterForm` omits `meta: { skipGlobalInvalidation: true }`. When an admin edits tool/embedding settings and clicks **"Test"**, `mutationCache` invalidates all queries globally, causing `componentsByType` and `appToolSettingsGet` to refetch. Those new object references trigger `useEffect` resets in `ParameterForm` (`form.reset(defaults())`) and `ToolsSettings` (`setIsDirty(false)`), erasing the unsaved form values the admin just tested.
- **Improvement:** Add `meta: { skipGlobalInvalidation: true }` to `componentsTestMutation` and derive `provider` via `useMemo` keyed by name rather than syncing `useState` in `useEffect`.

### 6. All Backend SSE Webhook Calls Share One 50 req/min `"unknown"` Rate-Limit Bucket (Frontend)
- **Where:**
  - [`apps/frontend/src/app/api/stream/route.ts`](apps/frontend/src/app/api/stream/route.ts#L31-L50)
  - [`apps/frontend/src/features/sse/lib/rate-limiter.ts`](apps/frontend/src/features/sse/lib/rate-limiter.ts#L5-L19)
- **Problem:** In `POST /api/stream`, when `isAuthorizedSystem` is true (`x-asterism-system-key` matched), the rate-limit key is `clientIpKey(req.headers.get("x-forwarded-for"))`. Internal backend-to-frontend calls (`http://127.0.0.1:3000/api/stream`) do not send `x-forwarded-for`, so `clientIpKey(null)` returns `"unknown"`. All system-originated SSE events across all users share a single 50 req/min bucket and start failing with HTTP `429` under normal multi-user activity.
- **Improvement:** Skip per-IP rate limiting when `isAuthorizedSystem` is true (since the caller already authenticated with `SYSTEM_KEY`), and validate `EventPayloadSchemas` on ingress.

---

## Tier 2: Background Jobs, Lifecycle & Security Hardening

### 7. `JobManager.enqueue` Done-Callback Race & Unretrieved Task Exceptions (Backend)
- **Where:**
  - [`apps/backend/asterism/common/job_queue.py`](apps/backend/asterism/common/job_queue.py#L39-L59)
  - [`apps/backend/asterism/core/tasks.py`](apps/backend/asterism/core/tasks.py#L25-L31)
- **Problem:** If a previous task for `key` just finished (`job.done() == True`) before its scheduled `done_callback` runs on the event loop, `enqueue(key, ...)` overwrites `self._tasks[key]` with the new task, and then the old task's `add_done_callback(lambda _: self._tasks.pop(key, None))` fires and removes the **new** active task from `self._tasks`. Neither `JobManager` nor `BackgroundTaskManager` retrieves `task.exception()` in its done callback.
- **Improvement:** Only pop `self._tasks[key]` if `self._tasks.get(key) is completed_task`, and log any unhandled `completed_task.exception()`.

### 8. `EventBus.shutdown()` Cancels `SYSTEM_STOP` Handlers Before They Execute (Backend)
- **Where:**
  - [`apps/backend/asterism/core/lifespan.py`](apps/backend/asterism/core/lifespan.py#L85-L86)
  - [`apps/backend/asterism/core/events.py`](apps/backend/asterism/core/events.py#L210-L261)
- **Problem:** `lifespan.py` calls `event_bus.emit(NoArgEvent(type=EventType.SYSTEM_STOP))` (which schedules tasks via `asyncio.create_task`) and on the very next line calls `await event_bus.shutdown()`, which immediately cancels every task in `self._tasks` before the event loop yields to run them.
- **Improvement:** Await pending event tasks with a timeout in `shutdown()` before cancelling, or use an `await event_bus.emit_and_wait(...)` helper for shutdown events.

### 9. Interrupted Image Captioning Jobs Are Never Resumed on Startup (Backend)
- **Where:**
  - [`apps/backend/asterism/domains/knowledge/runtime.py`](apps/backend/asterism/domains/knowledge/runtime.py#L62-L105)
  - [`apps/backend/asterism/domains/knowledge/ingestion.py`](apps/backend/asterism/domains/knowledge/ingestion.py#L306-L343)
- **Problem:** Image files set `FileKnowledgeArtifactModel.status = READY` (`searchable=False`) before enqueueing `caption_file()`. On restart, `recover_interrupted()` marks interrupted `CAPTIONING` rows as `"Captioning interrupted by restart; retry queued"`, but `resume_ingestion_jobs()` only queries `FileKnowledgeArtifactModel.status == PENDING`, so interrupted captioning jobs are never re-enqueued.
- **Improvement:** Also re-enqueue captioning in `resume_ingestion_jobs()` for artifacts with `status == READY` and `searchable == False` whose captioning extraction was interrupted or remained `PENDING`.

### 10. `delete_user` Leaves In-Flight Chat/Knowledge Jobs Running & Group Cache Populated (Backend)
- **Where:**
  - [`apps/backend/asterism/domains/user/service.py`](apps/backend/asterism/domains/user/service.py#L330-L380)
  - [`apps/backend/asterism/domains/groups/service.py`](apps/backend/asterism/domains/groups/service.py#L31-L42)
- **Problem:** `delete_user` deletes the user row and calls `vector_store.delete_user(...)` without retiring active `chat_jobs`, cancelling in-flight file ingestion/captioning tasks (which can finish afterward and write orphaned vectors into LanceDB), or calling `evict_user_group(user_id)`.
- **Improvement:** Retire user chat jobs, cancel file knowledge jobs, and evict the user's group cache entry during `delete_user`.

### 11. `fetch.py` Unbounded Response Body, SSRF DNS Rebinding (TOCTOU), & Double HTML Parsing on the Event Loop (Backend)
- **Where:**
  - [`apps/backend/asterism/domains/tools/builtin/fetch.py`](apps/backend/asterism/domains/tools/builtin/fetch.py#L105-L228) & [`lines 332-388`](apps/backend/asterism/domains/tools/builtin/fetch.py#L332-L388)
- **Problem:**
  1. `fetch_page()` calls `await client.get(current_url)` without streaming or a byte/content-type cap, allowing a large binary payload to buffer completely into memory.
  2. `validate_public_http_url()` resolves DNS first, and then `httpx` / Playwright resolves the hostname a second time when connecting (TOCTOU DNS rebinding risk).
  3. `fetch_page()` parses the response with `BeautifulSoup`, strips tags, and serializes via `soup.prettify()`, and then `extract_clean_markdown()` immediately parses that string a **second time** with `BeautifulSoup` synchronously on the main event loop thread (up to 20 synchronous parses during a 10-URL `web_search`).
- **Improvement:** Stream with a byte cap and textual `Content-Type` check in `fetch_page()`, pin the resolved IP at transport connection time, parse HTML once, and offload `extract_clean_markdown` via `await asyncio.to_thread(...)`.

### 12. WebSocket Pre-Accept Exceptions, Auth Redirects, `/sign-in` Crash, & `SharedWorker` Reconnect Leak
- **Where:**
  - [`apps/backend/asterism/domains/chat/router.py`](apps/backend/asterism/domains/chat/router.py#L134-L184): Calls `chat_service.get_one` and `agent_service.get_agent_profile` before `await websocket.accept()` outside the `try` block, causing unhandled ASGI WebSocket exceptions on `NotFoundException`/`ForbiddenException` instead of clean WebSocket close codes.
  - [`apps/frontend/src/proxy.ts`](apps/frontend/src/proxy.ts#L6-L11) & [`lines 56-79`](apps/frontend/src/proxy.ts#L56-L79): Drops `request.nextUrl.search` when constructing `/sign-in?redirect=...`, and `config.matcher` excludes `sign-in` while `proxy()` contains unreachable `/sign-in` branch logic.
  - [`apps/frontend/src/app/(auth)/sign-in/page.tsx`](apps/frontend/src/app/(auth)/sign-in/page.tsx#L9-L25): Uses `searchSchema.parse(resolvedSearchParams)`, which throws an unhandled `ZodError` (HTTP 500) if `?redirect` is passed twice (`string[]`).
  - [`apps/frontend/src/features/auth/server/actions.ts`](apps/frontend/src/features/auth/server/actions.ts#L16-L38): `installApp` does not apply rate limiting before invoking Better Auth `signUpEmail` (unlike `signUpWithInvite`).
  - [`apps/frontend/public/sse-worker.js`](apps/frontend/public/sse-worker.js#L4-L47): When the last tab closes during the 2-second `onerror` backoff window, `initSSE()` still runs because it only checks `if (eventSource) return;` and not `if (ports.size === 0) return;`, leaving an orphaned 2-second reconnect loop running until the worker terminates.
  - [`scripts/reset-databases.mjs`](scripts/reset-databases.mjs#L8-L21): Reads `process.env.STORAGE_ROOT` without `?? "/storage"`, throwing a `TypeError` in `join(storageRoot, ...)` when relying on the `CATALOG.STORAGE_ROOT` default.

---

## Tier 3: Database & Query Optimizations

### 13. SQLite FTS5 Triggers Rebuild Full Chat Search Row on Every Message Update & Delete (Backend)
- **Where:** [`apps/backend/asterism/domains/chat/search_index.py`](apps/backend/asterism/domains/chat/search_index.py#L13-L75)
- **Problem:**
  1. `chat_search_messages_au` triggers on **any** `UPDATE ON messages` (such as changing `status` from `PENDING` to `COMPLETE` or toggling `pinned`), scanning and concatenating all messages in the chat even when `content` did not change.
  2. When a chat with `N` messages is deleted, `ON DELETE CASCADE` fires `chat_search_messages_ad` `N` times, re-scanning and re-indexing the dying chat `N` times (`O(N^2)`).
- **Improvement:** Restrict `chat_search_messages_au` to `AFTER UPDATE OF content, chat_id ON messages WHEN OLD.content IS NOT NEW.content OR OLD.chat_id IS NOT NEW.chat_id`, and guard `chat_search_messages_ad` with `WHEN EXISTS (SELECT 1 FROM chats WHERE id = OLD.chat_id)`.

### 14. `_simple_count` in `db/queries.py` Ignores `DISTINCT`, `GROUP BY`, and `HAVING` (Backend)
- **Where:** [`apps/backend/asterism/db/queries.py`](apps/backend/asterism/db/queries.py#L29-L51)
- **Problem:** `_simple_count()` optimizes single-table counts by counting `primary_keys[0]` with `statement.whereclause`, without checking `statement._distinct`, `statement._group_by_clauses`, or `statement._having_criteria`.
- **Improvement:** Return `None` from `_simple_count()` when any of `_distinct`, `_group_by_clauses`, or `_having_criteria` is present so `paginate()` falls back to the subquery count.

### 15. Targeted N+1 Queries in Courses, Skills, and File Deletion (Backend)
- **Where:**
  - [`apps/backend/asterism/domains/courses/publish.py`](apps/backend/asterism/domains/courses/publish.py#L209-L219): `list_versions` queries `version_files(row.id, session)` in a loop per version.
  - [`apps/backend/asterism/domains/chat/skills.py`](apps/backend/asterism/domains/chat/skills.py#L55-L74): `describe_skills` calls `validate_snapshots(user_id, (item,), session)` inside a per-item loop instead of batching.
  - [`apps/backend/asterism/domains/files/service.py`](apps/backend/asterism/domains/files/service.py#L766-L783): `delete_user_files` queries and describes each filename in a serial loop.

---

## Tier 4: `AGENTS.md` Alignment, Naming & Code Deduplication

### 16. `FileStore.open() -> Path` Leaks Local Filesystem Paths Across 7 Modules (Backend — `AGENTS.md` §3.1)
- **Where:**
  - [`apps/backend/asterism/domains/files/store.py`](apps/backend/asterism/domains/files/store.py#L55-L73)
  - [`apps/backend/asterism/domains/courses/copies.py`](apps/backend/asterism/domains/courses/copies.py#L331) & [`line 395`](apps/backend/asterism/domains/courses/copies.py#L395)
  - [`apps/backend/asterism/domains/courses/publish.py`](apps/backend/asterism/domains/courses/publish.py#L160) & [`line 189`](apps/backend/asterism/domains/courses/publish.py#L189)
  - [`apps/backend/asterism/domains/knowledge/captioning.py`](apps/backend/asterism/domains/knowledge/captioning.py#L70-L72)
  - [`apps/backend/asterism/domains/files/service.py`](apps/backend/asterism/domains/files/service.py#L397) & [`line 493`](apps/backend/asterism/domains/files/service.py#L493)
- **Problem:** `FileStore.open()` returns a `pathlib.Path` that callers read synchronously on the event loop (`read_bytes()`), `courses/copies.py:331` omits `FileNotFoundError` handling, and `courses/copies.py:395` / `courses/publish.py:189` catch `Exception` rather than `(Exception, asyncio.CancelledError)` when rolling back written files.
- **Improvement:** Add `async def read_bytes(self, user_id: str, storage_key: str) -> bytes` and `async def exists(self, user_id: str, storage_key: str) -> bool` (using `asyncio.to_thread` in `LocalFileStore`) directly to the `FileStore` interface, and catch `asyncio.CancelledError` in course file rollback blocks.

### 17. `files/service.py` Mixes Query Builders, Enrichment, and Multi-Caller Boolean Flags (Backend — `AGENTS.md` §6.8 & §6.9)
- **Where:** [`apps/backend/asterism/domains/files/service.py`](apps/backend/asterism/domains/files/service.py#L1-L824)
- **Problem:** Embeds inline `select(UserFileModel)` queries instead of composing from [`domains/files/queries.py`](apps/backend/asterism/domains/files/queries.py), and uses boolean flags (`require_write: bool = False`, `require_project_write: bool = False`) to change authorization behavior across callers.
- **Improvement:** Move remaining `UserFileModel` query builders into `domains/files/queries.py` and split `require_write` into explicit `require_readable_*` / `require_writable_*` helpers.

### 18. Unscoped Mutations, Redundant `invalidateQueries`, & Raw Radio Inputs (Frontend — `AGENTS.md` §3.2)
- **Where:**
  - [`apps/frontend/src/features/settings/ui/admin-settings/image-gen-settings.tsx`](apps/frontend/src/features/settings/ui/admin-settings/image-gen-settings.tsx#L84-L97): Calls `queryClient.invalidateQueries` manually in `onSuccess` without `meta: { invalidates: [...] }`, causing `mutationCache` to also invalidate all queries globally.
  - [`apps/frontend/src/features/chat/components/chat-model-picker.tsx`](apps/frontend/src/features/chat/components/chat-model-picker.tsx#L122-L131), [`chat-persona-picker.tsx`](apps/frontend/src/features/chat/components/chat-persona-picker.tsx#L136-L141), [`chat-learning-mode-picker.tsx`](apps/frontend/src/features/chat/components/chat-learning-mode-picker.tsx#L148-L153): Update the chat query cache directly via `setQueryData`, but omit `meta: { skipGlobalInvalidation: true }`, triggering a full-app refetch on every picker toggle.
  - [`apps/frontend/src/features/settings/ui/admin-settings/captioning-settings.tsx`](apps/frontend/src/features/settings/ui/admin-settings/captioning-settings.tsx#L115-L142): Uses raw `<input type="radio">` instead of the installed `@/components/ui/radio-group` component.

### 19. Duplicated Utilities, Oversized Components, & Dead Code Cleanup (Frontend, Backend & Scripts)
- **Duplicate rate limiter:** [`apps/frontend/src/features/sse/lib/rate-limiter.ts`](apps/frontend/src/features/sse/lib/rate-limiter.ts) is an exact copy of [`apps/frontend/src/lib/rate-limit.ts`](apps/frontend/src/lib/rate-limit.ts).
- **17+ duplicate `errorDetail` / `errorText` functions:** Consolidated easily into `@/lib/utils` alongside `isErrorDetail` (currently `admin-settings` even imports `errorDetail` across feature boundaries from [`apps/frontend/src/features/classes/error-detail.ts`](apps/frontend/src/features/classes/error-detail.ts)).
- **3 near-identical boolean admin policy panels:** [`chatgpt-policy-settings.tsx`](apps/frontend/src/features/settings/ui/admin-settings/chatgpt-policy-settings.tsx), [`canvas-policy-settings.tsx`](apps/frontend/src/features/settings/ui/admin-settings/canvas-policy-settings.tsx), and [`skills-policy-settings.tsx`](apps/frontend/src/features/settings/ui/admin-settings/skills-policy-settings.tsx) (~410 lines total) can share a single `<BooleanAdminPolicySettings />` component.
- **Duplicate `_parse_csv_list` in backend settings:** Defined identically in [`apps/backend/asterism/domains/settings/service.py`](apps/backend/asterism/domains/settings/service.py#L67-L71) and [`apps/backend/asterism/domains/settings/discovery.py`](apps/backend/asterism/domains/settings/discovery.py#L42-L46).
- **Unbounded lock dictionary in ChatGPT service:** [`apps/backend/asterism/domains/chatgpt/service.py`](apps/backend/asterism/domains/chatgpt/service.py#L64) uses `defaultdict(asyncio.Lock)` instead of `WeakValueDictionary` (unlike [`apps/backend/asterism/domains/files/produced.py`](apps/backend/asterism/domains/files/produced.py#L61)).
- **Unused frontend exports:** [`apps/frontend/src/hooks/use-clickoutside.ts`](apps/frontend/src/hooks/use-clickoutside.ts), `formatURL` in [`apps/frontend/src/lib/utils.ts`](apps/frontend/src/lib/utils.ts#L17-L36), `"chat-session:scroll"` in [`apps/frontend/src/features/sse/types.ts`](apps/frontend/src/features/sse/types.ts#L4), and `useSubscribeEventState` (with a leftover `console.log`) in [`apps/frontend/src/features/sse/hooks/use-subscribe-event.ts`](apps/frontend/src/features/sse/hooks/use-subscribe-event.ts#L11-L35).
- **Oversized frontend components (~1,000+ lines each):** [`chat-session.tsx`](apps/frontend/src/features/chat/components/chat-session.tsx) (1,099 lines), [`provider-setup-step.tsx`](apps/frontend/src/features/setup/components/provider-setup-step.tsx) (1,059 lines), and [`chat-input.tsx`](apps/frontend/src/features/chat/components/chat-input.tsx) (1,015 lines) would benefit from extracting focused hooks and subcomponents.
