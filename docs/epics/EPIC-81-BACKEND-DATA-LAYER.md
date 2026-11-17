# EPIC-81: Backend data layer and storage

Status: in progress. Source: [codebase review](../../codebase_review.md), verified 2026-11-14 (items 13, 14, 15, 16, 17).

## Objective

Tighten queries, search triggers and file storage access, and bring `files/service.py` in line with AGENTS.md §6.8-6.9.

## User stories

### US-81.1: Cheaper search index maintenance

The message update trigger already fires only on `content`; the cost is on delete.

- [x] Guard `chat_search_messages_ad` with `WHEN EXISTS (SELECT 1 FROM chats WHERE id = OLD.chat_id)` so cascaded chat deletes skip the per-message re-index.
- [x] Add `WHEN OLD.content IS NOT NEW.content OR OLD.chat_id IS NOT NEW.chat_id` to the update trigger.
- [x] Test search stays correct after message edit, message delete and chat delete.

### US-81.2: `paginate_select` counts correctly

- [x] `_simple_count` returns `None` when the statement has `DISTINCT`, `GROUP BY` or `HAVING`.
- [x] Test with a distinct and a grouped single-table select.

### US-81.3: Remove targeted N+1 queries

- [x] `list_versions`: load files for all versions in one query.
- [x] `describe_skills`: validate snapshots in one batch.
- [x] `delete_user_files`: one query for the filenames, one batch describe.
- [x] Query-count tests for each.

### US-81.4: Async file store reads

- [x] Add `async read_bytes` and `async exists` to `FileStore` (`asyncio.to_thread` in `LocalFileStore`); stop returning `Path` to the courses, captioning and files callers (8 `open()` callers).
- [x] Handle `FileNotFoundError` in `courses/copies.py`; catch `asyncio.CancelledError` in the course file rollback blocks (`copies.py`, `publish.py`).
- [x] Tests for a missing source file and a cancelled publish leaving no files.

### US-81.5: `files/service.py` structure

- [ ] Move remaining `UserFileModel` select builders into `domains/files/queries.py`.
- [ ] Replace `require_write` / `require_project_write` flags with explicit readable/writable helpers.
- [ ] No behavior change; existing tests stay green.

## Notes

US-81.5 is a refactor; do it last and keep it separate from bug fixes.

US-81.1: SQLite runs cascaded message deletes after the chat row is gone, so the `EXISTS` guard skips them (checked with a probe; both `delete_chat` and `delete_chats` rely on the DB cascade). The update trigger now fires on `content, chat_id` and rebuilds the old chat too when a message moves. `initialize_search_index` drops and recreates the triggers on every start, so existing databases pick up new definitions.

US-81.3: `files_by_version` loads a page's course files in one query; `available_skill_ids` reads the skills policy once and checks eligibility in one query (per-item size limits unchanged); `delete_user_files` loads the files once and describes them in one batch. Per-file knowledge cleanup and row deletes in `delete_user_files` remain per file. Tests assert counts stay constant as items grow, rather than pinning exact numbers.

US-81.4: `FileStore.open()` became `local_path()`, kept only for consumers that need a real file (the two `FileResponse` downloads, the converter/digest in `processor.py`, `document_counts` in preview); every other read uses `read_bytes`/`exists`. The knowledge contract now carries image bytes (`SourceContent.image`) instead of a path, so captioning and `embed_image` work on bytes; `CaptionRequest.image` is excluded from its repr. A missing course source raises a 409 naming the file; publish and apply also roll back on `CancelledError` (a cancelled apply is tested too).
