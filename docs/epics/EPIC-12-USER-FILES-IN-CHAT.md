# EPIC-12 — User Files in Chat (Upload, Vision, and MarkItDown)

## Status

**US-12.1–US-12.7 completed, verified, and user-confirmed.** EPIC-12 is complete.

## Goal

Let users **upload files** and **attach them to chat messages**, and let the
agent runtime **use the file content** when answering.

File processing combines two mechanisms:

- **Native vision** — image attachments (PNG, JPEG, WebP, GIF, BMP) are sent
  to the model as multimodal `image_url` content parts, but only when the
  selected model's `supports_vision` capability is `true` (metadata established
  in EPIC-11).
- **Microsoft MarkItDown** — non-image documents (PDF, DOCX, PPTX, XLSX/XLS,
  HTML, CSV, Markdown, and other supported formats) are converted to Markdown
  on the backend and injected into the conversation as text.

Plain text and code files are read directly without conversion. Files whose
type cannot be processed are still attached (name visible to user and agent)
but flagged as unsupported instead of failing the message.

## Current findings (code inspection)

| Area | Current behavior / problem |
| --- | --- |
| File storage | Files live at `{files_root}/{user_id}/{filename}` on the local filesystem. `GET /files/{filename}` serves them with JWT user scoping and path-traversal checks. There is **no upload, list, or delete endpoint**, and no file-store interface (the service touches `config` paths directly, which AGENTS.md says must sit behind an abstraction). |
| Chat composer | The frontend `ChatInput` already has attachment UI scaffolding (paperclip picker, drag-and-drop, preview badges), but attachments are **never uploaded, never sent**, and are dropped on submit. The WebSocket `chat` command carries only `{type, message: string}`. |
| Message model | `MessageModel.content` is plain text. There is no field referencing attached files, so attachments cannot be persisted, re-rendered, or re-sent to the model on regenerate. |
| LLM layer | `LLMMessage.content` is `str` and `to_api_message()` only emits string content. The OpenAI-compatible client therefore cannot send multimodal messages at all. |
| Vision capability | `LLMModel.supports_vision` (tri-state with provenance) exists from EPIC-11 but **no runtime code consumes it**. |
| Agent file awareness | `Agent` and `ToolContext` already accept `user_files: list[str]` and the `sub_agent` tool already forwards file names into sub-agent context, but the chat path never populates `user_files`. |
| Document conversion | No dependency or module converts binary documents. `markitdown` (Microsoft) is not installed. Latest release is 0.1.7 (requires Python ≥3.10; project requires ≥3.13). |
| Schema evolution | As with EPIC-11, new tables/columns require an explicit, repeatable, data-preserving migration in `asterism/db/schema_migrations.py`; `create_all` alone is insufficient. |

## Product and data decisions

### File kinds and processing routing

Every uploaded file is classified into exactly one kind. The kind drives
processing and how the content reaches the model:

| Kind | Detection | Processing | Model input |
| --- | --- | --- | --- |
| `image` | MIME `image/png`, `image/jpeg`, `image/webp`, `image/gif`, `image/bmp` | None — native vision | `image_url` content part (base64 data URL) on the attaching user message, **only if the active model has `supports_vision == true`** |
| `text` | MIME `text/*`, or a known code/plain-text extension (.py, .ts, .tsx, .js, .json, .yaml, .yml, .toml, .ini, .sh, .sql, .rs, .go, .c, .cpp, .h, .java, .rb, .php, .xml, .log, …) | Read directly as UTF-8 (BOM tolerated; decode failures fall back to conversion, then `failed`) | Text block |
| `document` | Extensions/MIME supported by the installed MarkItDown converters (.pdf, .docx, .pptx, .xlsx, .xls, .html, .htm, .csv, .md, .rst, .epub when supported) | MarkItDown conversion to Markdown | Text block |
| `other` | Everything else | Not processed | File name only, flagged `unsupported` |

Kind detection uses the stored extension plus the sniffed MIME type
(`filetype`), preferring the extension for code files whose MIME is ambiguous.
Detection rules are isolated and fixture-tested; no guessing from content.

### Vision capability gating

The tri-state `supports_vision` from EPIC-11 is consumed by the agent runtime:

| `supports_vision` | Behavior |
| --- | --- |
| `true` | Images are sent as `image_url` parts. |
| `false` | Images are **not** sent. The message content includes an explicit note: `(image "name" not included: model does not support image input)`. |
| `null` (unknown) | Treated as **not supported** (secure-by-default). Same note, worded "model image support is unknown". The user can fix the metadata in admin settings without a code change. |

Vision gating is decided per agent run from the resolved model
(`settings_service.get_model_and_provider`), so switching models changes
behavior immediately without re-uploading.

Image size for vision is bounded by `max_vision_image_bytes` (default 10 MiB).
Larger images are not sent and are noted in the content instead. No image
resizing/compression in v1 (see non-goals).

### Document conversion (MarkItDown)

- Dependency: `markitdown[docx,pdf,pptx,xls,xlsx]` pinned to `>=0.1.7,<0.2`.
  The `all` extra is deliberately avoided: it pulls Azure, audio-transcription
  (SpeechRecognition), and YouTube dependencies that are not needed.
- Conversion runs in a worker thread (`asyncio.to_thread`) wrapped in
  `asyncio.wait_for` with `file_conversion_timeout_s` (default 60 s).
- Input bound: files larger than `max_process_file_size_bytes`
  (default 15 MiB) are not converted and become `failed` with a clear
  "too large" error.
- Output bound: converted text is truncated to `max_converted_chars`
  (default 100,000) with a visible `… [content truncated]` marker.
- **Result caching:** converted text and status are persisted on the
  `user_files` row (`content_cache`, `content_status`, `content_error`,
  `sha256`). A file is converted once; every later message that references it
  reuses the cache. A changed file (new hash) invalidates the cache.
- **When conversion happens:** on first use — when a user sends a message that
  references the file — not at upload time. Upload stays fast; the first
  message may wait for conversion, and the UI shows a "processing files"
  status. Regenerations and sub-agent reuse are instant.
- **Errors are per-file, never fatal:** a file that fails conversion is
  attached with status `failed` and a short user-facing reason; the agent
  proceeds with the remaining content. The model is told which files could not
  be read.
- **Logging:** file names, sizes, statuses, durations, and error *types* are
  logged. File **content is never logged**.

### Persistence

New `user_files` table (SQLAlchemy model + repeatable migration):

| Column | Type | Notes |
| --- | --- | --- |
| `id` | UUID PK | |
| `user_id` | str FK → users, CASCADE | ownership |
| `filename` | str, unique per `user_id` | sanitized storage name used by `GET /files/{filename}` |
| `original_name` | str | the user-visible name as uploaded |
| `size` | int | bytes |
| `mime_type` | str | sniffed via `filetype`, extension fallback |
| `kind` | enum `image`/`text`/`document`/`other` | from routing table |
| `sha256` | str | content hash for cache invalidation |
| `content_status` | enum `pending`/`ready`/`unsupported`/`failed` | `pending` immediately after upload |
| `content_error` | str nullable | short, user-safe reason |
| `content_cache` | Text nullable | converted/truncated text for `text`/`document` kinds |
| timestamps | mixin | created/updated |

`messages` gains a `files` JSONB column: a list of
`{filename, name, mime_type, size, kind, status}` references. The bytes stay on
the filesystem; the message stores references only, so history stays small and
re-rendering works after reload.

### Upload API and file-store abstraction

- New `FileStore` protocol (`save`, `open`, `delete`, `stat`, `list`) with a
  `LocalFileStore` implementation rooted at `{files_root}/{user_id}`. The
  existing files service is refactored onto it (behavior of
  `GET /files/{filename}` unchanged), satisfying the file-store abstraction
  required by AGENTS.md §3.1.
- `POST /files` (multipart, multiple allowed) returns typed metadata per file.
  Rules: per-file `max_upload_file_size_bytes` (default 20 MiB);
  extension denylist for OS executables/binaries
  (`.exe`, `.dll`, `.so`, `.dylib`, `.bin`, `.app`, `.msi`, `.com`, `.bat`,
  `.cmd`, `.scr`, `.jar`); filename sanitization (strip directories, collapse
  leading dots, trim control characters); collision dedupe by appending a
  short counter before the extension (`report(2).pdf`).
- `GET /files` lists the caller's files (metadata only, no bytes).
- `DELETE /files/{filename}` removes the file row and bytes; messages that
  referenced it keep their reference and render as "file no longer available".
- All endpoints are authenticated and strictly user-scoped. No cross-user
  access is possible via filename enumeration.

### Chat transport

The WebSocket `chat` command becomes
`{type: "chat", message: string, files?: string[]}` where `files` is a list of
already-uploaded `filename` values. The orchestrator:

1. verifies every filename exists in `user_files` for the authenticated user;
2. ensures processed content (triggers conversion for `pending` files);
3. persists the user message with `files` references (status reflected from
   `user_files`);
4. runs the agent as today.

Invalid or missing filenames are rejected with an actionable error before
anything is persisted.

### Agent message construction

When the orchestrator rebuilds `LLMMessage`s from chat history:

- A user message **without** files behaves exactly as today (string content).
- A user message **with** files builds structured user content:
  - text part = the user's prompt plus, for each readable file, a block:
    `### Attached file: {name}\n{converted text}` (documents/text) —
  - one `image_url` part per included image (data URL),
  - explicit notes for images skipped by vision gating and for files with
    `unsupported`/`failed` status, so the model never pretends to have seen
    content it did not receive.
- `LLMMessage.content` becomes `str | list[ContentPart]` where `ContentPart`
  is a discriminated union of `text` and `image_url` parts.
  `to_api_message()` maps parts 1:1 for user messages; every existing
  text-only path remains byte-identical.
- Any code that string-processes message content (title generation,
  sub-agent context windowing, token estimates) uses a shared
  `text_content(message)` helper that extracts only text parts.
- Sub-agents receive the existing `user_files` name list (already
  implemented); content injection into sub-agent context is a non-goal for v1.

### Configuration

New settings (all with safe defaults, overridable via env):

| Setting | Default | Meaning |
| --- | --- | --- |
| `max_upload_file_size_bytes` | 20 MiB | per-file upload cap |
| `max_process_file_size_bytes` | 15 MiB | conversion input cap |
| `max_converted_chars` | 100,000 | converted-output truncation |
| `file_conversion_timeout_s` | 60 | conversion wall-clock cap |
| `max_vision_image_bytes` | 10 MiB | per-image vision cap |
| `denied_upload_extensions` | list above | upload denylist |

## Scope / non-goals

**In scope:**

- File store abstraction; upload/list/delete API; `user_files` persistence
- MarkItDown conversion pipeline with caching, limits, timeouts, per-file errors
- Multimodal `LLMMessage` (text + image_url parts) and agent message construction
- Vision gating on EPIC-11 `supports_vision` metadata
- Message `files` references + migration; WebSocket `files` transport
- Frontend: upload-on-send, attachment chips with status, message attachment
  rendering (thumbnails, badges, download)
- OpenAPI/client regeneration, backend + frontend tests, E2E, docs, ADR

**Not in scope:**

- Image resizing/compression on upload or for vision
- A `read_file` agent tool for on-demand file access in later turns
  (content is injected on the attaching message; a tool is a likely follow-up)
- Sub-agent content injection (names are forwarded today)
- Shared files across users, folders, or admin-managed file libraries
- Object-storage (S3) backend for the file store (interface only, local now)
- Audio/video transcription, OCR of scanned PDFs beyond what MarkItDown does,
  Azure Document Intelligence
- File-editing tools, versioning, or chat-scoped file lifecycles (files persist
  until the user deletes them)

## User stories

### US-12.1 — Upload, list, and delete user files

**As a user**, I want to upload files to my own storage and manage them so
that I can attach them to chats and retrieve them later.

**Dependencies:** None.

- [x] US-12.1-T1: Introduce the `FileStore` protocol and `LocalFileStore` (save/open/delete/stat/list, user-scoped root); refactor the existing files service onto it without changing `GET /files/{filename}` behavior.
- [x] US-12.1-T2: Add the `user_files` SQLAlchemy model and Pydantic/OpenAPI schemas, plus a repeatable, data-preserving migration for the new table.
- [x] US-12.1-T3: Implement `POST /files` multipart upload with size cap, executable-extension denylist, filename sanitization, per-user collision dedupe, MIME sniffing, kind classification, and `sha256` hashing; return typed per-file metadata.
- [x] US-12.1-T4: Implement `GET /files` (list own metadata) and `DELETE /files/{filename}` (row + bytes) with strict user scoping.
- [x] US-12.1-T5: Add tests for auth/ownership isolation, path traversal and filename sanitization, size limits, denylist, dedupe, MIME/kind detection, delete semantics, and migration idempotency; regenerate the Hey API client and verify the new endpoints appear in generated types.

**Acceptance criteria**

- A user can upload one or multiple files and see typed metadata back; uploads are stored under the user's own directory only.
- Oversized, denied-extension, and malformed filenames are rejected with actionable errors; valid names are sanitized and deduplicated without overwriting existing files.
- A user can never list, read, or delete another user's file, including via crafted filenames.
- Existing `GET /files/{filename}` behavior and generated-client contract are preserved.
- Re-running the migration on an existing database is a no-op and preserves all data.

---

### US-12.2 — Convert files to model-readable text with MarkItDown

**As a user**, I want my documents converted to text automatically so that the
agent can actually read PDFs, Office files, and other documents I attach.

**Dependencies:** US-12.1.

- [x] US-12.2-T1: Add the pinned `markitdown[docx,pdf,pptx,xls,xlsx]` dependency and isolate conversion behind a `FileProcessor` interface in the files domain (kind routing: image/text/document/other).
- [x] US-12.2-T2: Implement text reading (UTF-8/BOM, decode-failure fallback) and MarkItDown conversion in a worker thread with `file_conversion_timeout_s`, `max_process_file_size_bytes`, and `max_converted_chars` truncation marker.
- [x] US-12.2-T3: Persist processing results on `user_files` (`content_status`, `content_error`, `content_cache`, hash invalidation); implement "ensure processed" used by the chat path with per-file, non-fatal, user-safe errors.
- [x] US-12.2-T4: Add fixture tests with real small sample files (pdf, docx, pptx, xlsx, html, csv, md, txt, code, image, unknown binary) plus timeout, oversized, corrupt-file, truncation, and cache-invalidation cases; assert file content never appears in logs.

**Acceptance criteria**

- Supported documents convert to clean Markdown/text; plain text and code files are read directly without MarkItDown.
- A file is converted once and reused; a changed file re-converts.
- Failures (unsupported type, oversize, timeout, corrupt file) produce a per-file `unsupported`/`failed` status with a short reason and never fail the surrounding request.
- Conversion respects all configured bounds; logs contain metadata only, never content.

---

### US-12.3 — Use attached files in the agent runtime (vision + document text)

**As a user**, I want the agent to see images natively and read attached
documents, gated by what the selected model actually supports.

**Dependencies:** US-12.2.

- [x] US-12.3-T1: Extend `LLMMessage.content` to `str | list[ContentPart]` (discriminated `text` / `image_url` union), update `to_api_message()` to emit structured user content, and add a `text_content()` helper; prove existing text-only API payloads are unchanged.
- [x] US-12.3-T2: Add `Message.files` references (JSONB) with a repeatable migration and OpenAPI schemas; extend the WebSocket `chat` command with `files?: string[]` and orchestrator validation (ownership, existence, ensure-processed, persist references, actionable errors).
- [x] US-12.3-T3: Implement agent message construction: image data-URL parts gated on `supports_vision == true` (explicit skip notes for `false`/unknown and over-size), document/text injection blocks, unsupported/failed notes; make title generation and sub-agent context windowing text-safe; populate `Agent.user_files` from the attaching message.
- [x] US-12.3-T4: Add tests for multimodal payload shape (mocked client), tri-state vision gating, image size cap, document/text injection, unsupported/failed notes, multi-message history rebuild, regenerate behavior, title/sub-agent text extraction, and WS filename validation/ownership.

**Acceptance criteria**

- A vision-capable model receives image parts and converted document text; a non-vision model receives explicit skip notes and never image bytes.
- Models with unknown vision capability are treated as non-vision (secure-by-default).
- Message history, including file references, round-trips through persistence and rebuilds identical model input on regenerate.
- Files that cannot be read are disclosed to the model by name and reason; the agent run does not crash.
- Title generation and sub-agent context handling are unaffected by structured content.

---

### US-12.4 — Attach files to chat messages in the frontend

**As a user**, I want to pick, drop, and send files from the chat composer and
see them on my messages so that the attachment experience is complete and
durable.

**Dependencies:** US-12.3.

- [x] US-12.4-T1: Wire `ChatInput` attachments to the generated upload client: upload on submit with per-file progress/error chips, include returned filenames in the WebSocket `chat` command, and clear attachments only on full success with an actionable failure path.
- [x] US-12.4-T2: Render attachments on persisted user messages: image thumbnails via the file endpoint, document badges with name/size and download action, plus unsupported/failed and file-missing states.
- [x] US-12.4-T3: Add frontend unit/integration tests for upload success/partial failure, chip state transitions, the WebSocket payload including `files`, attachment rendering states, and keyboard/label accessibility; verify regenerated client types are consumed (no hand-written fetches).

**Acceptance criteria**

- Drag-and-drop and picker attachments upload on send; the user sees per-file progress and errors and can retry without losing the prompt.
- Sent messages persist and re-render their attachments after reload, matching what was sent.
- Images render as thumbnails; documents render as downloadable badges; unavailable/failed files render a clear state.
- The generated API client is used for all file API calls.

---

### US-12.5 — Verify the file workflow end to end and document it

**As a user and maintainer**, I want the full upload → attach → process →
model flow verified deterministically so that file features are trustworthy and
documented.

**Dependencies:** US-12.1 through US-12.4.

- [x] US-12.5-T1: Add a backend integration scenario: upload an image and a PDF, send one message, and assert a mocked vision-capable model receives an image part plus the PDF's Markdown; assert a mocked non-vision model receives the skip note instead of image bytes; assert cache reuse on the second message.
- [x] US-12.5-T2: Add a Playwright E2E scenario with mocked provider and file endpoints: attach + upload + send, rendered attachment chips on the persisted message, streamed assistant reply, and an upload-failure path.
- [x] US-12.5-T3: Update architecture documentation (data-and-storage, chat-and-websocket, llm-providers) and add ADR-0012 recording the vision + MarkItDown routing, caching, limits, and secure-by-default vision gating decisions.
- [x] US-12.5-T4: Run and record all quality gates (root lint/typecheck/test/build), migration re-run checks, OpenAPI ↔ generated-client consistency, and relevant Playwright coverage; record any live-provider limitations.

### US-12.5 verification record

- `SYSTEM_KEY=test-system-key-for-tests pnpm lint`, `typecheck`, `test`, and `build` pass (lint retains one pre-existing unused-variable warning in `component-settings.tsx`). Backend tests include repeatable migration coverage; frontend migration tests pass.
- `pnpm --filter @asterism/frontend exec playwright test e2e/file-workflow.spec.ts` passes two deterministic mocked-file scenarios. The harness deliberately does not require a live provider or credentials; live-provider compatibility remains dependent on the selected OpenAI-compatible service and configured model metadata.

**Acceptance criteria**

- Deterministic automated coverage proves both the vision and non-vision paths without external credentials.
- The end-to-end browser flow works with mocked backends; failure paths are visible to the user.
- Documentation and the ADR explain kind routing, capability gating, caching, limits, and what is deliberately out of scope.

### US-12.6 — Deduplicate identical uploads

**As a user**, I want re-uploading the same filename and bytes to reuse my existing file so that duplicate documents do not consume storage or clutter attachments.

**Dependencies:** US-12.1.

- [x] US-12.6-T1: Reuse an existing `user_files` row when the authenticated user uploads a file with the same sanitized filename and SHA-256; do not write a second file or create a `name(2)` copy.
- [x] US-12.6-T2: Add tests for repeat uploads, duplicate items in a single multipart request, same-name different-content behavior, and strict per-user isolation.
- [x] US-12.6-T3: Document the exact deduplication key and run relevant quality gates (`tests/test_user_files.py`, Ruff).

**Acceptance criteria**

- Re-uploading identical bytes under the same filename returns the original metadata and leaves one database row and one file on disk.
- Same-name files with different bytes retain the existing collision-deduplication behavior.
- Matching hashes never deduplicate across users or different sanitized filenames.

### US-12.7 — User file manager

**As a user**, I want to browse, download, and delete my uploaded files so that I can manage files outside a chat.

- [x] US-12.7-T1: Add a `/files` File Manager linked in the sidebar directly below Search.
- [x] US-12.7-T2: Use generated file-list/delete/download clients to render user-scoped files and support deletion.
- [x] US-12.7-T3: Provide list and icon views, with name and kind sorting.
- [x] US-12.7-T4: Add bounded backend pagination (page/page_size, max 100) with total metadata and frontend previous/next controls; run backend tests and frontend typecheck.

**Acceptance criteria**

- The sidebar Files link opens a user-scoped manager with download and delete actions.
- Users can switch list/icon view and sort by name or kind.
- The manager requests at most 50 files per page and reports total pages.

## Execution plan and definition of done

Recommended sequence: **US-12.1 → US-12.2 → US-12.3 → US-12.4 → US-12.5**.

Create a feature branch when each story starts and update `todo.md` as work
proceeds. Work on one story at a time. For every story: complete all tasks,
pass relevant lint/typecheck/tests, keep OpenAPI and the generated client
synchronized, document changed behavior, and request user completion
confirmation before merging into `main`.

The epic is complete: all stories meet their acceptance criteria and the user
confirmed completion.

## Risks to resolve, not hide

- **MarkItDown dependency weight.** `markitdown[all]` pulls Azure, speech, and
  YouTube dependencies. Install only the document extras we support and pin
  `<0.2`; re-evaluate on upgrade.
- **Malicious or corrupt documents.** Conversion runs in-process. Compensate
  with size caps, wall-clock timeouts in a worker thread, per-file error
  containment, and content-free logs. A subprocess sandbox remains a possible
  hardening step; document it in the ADR.
- **Vision metadata is tri-state.** Unknown must not be treated as supported.
  Gate strictly on `true`, emit explicit skip notes, and rely on EPIC-11 admin
  metadata for corrections.
- **Base64 images bloat context and payloads.** Bound per-image bytes, cap
  converted characters, and keep images on the attaching message only (not
  duplicated into later history beyond what the provider requires).
- **Schema upgrades can strand installations.** The `user_files` table and
  `messages.files` column must migrate repeatably and preserve existing
  messages on SQLite (and the supported relational path).
- **Upload abuse.** Per-user storage is unbounded in v1; enforce per-file size
  and extension denylist now, and record storage-quota as a follow-up risk in
  the ADR.
