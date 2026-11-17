# EPIC-81: Backend data layer and storage

Status: in progress. Source: [codebase review](../../codebase_review.md), verified 2026-11-14 (items 13, 14, 15, 16, 17).

## Objective

Tighten queries, search triggers and file storage access, and bring `files/service.py` in line with AGENTS.md §6.8-6.9.

## User stories

### US-81.1: Cheaper search index maintenance

The message update trigger already fires only on `content`; the cost is on delete.

- [ ] Guard `chat_search_messages_ad` with `WHEN EXISTS (SELECT 1 FROM chats WHERE id = OLD.chat_id)` so cascaded chat deletes skip the per-message re-index.
- [ ] Add `WHEN OLD.content IS NOT NEW.content OR OLD.chat_id IS NOT NEW.chat_id` to the update trigger.
- [ ] Test search stays correct after message edit, message delete and chat delete.

### US-81.2: `paginate_select` counts correctly

- [x] `_simple_count` returns `None` when the statement has `DISTINCT`, `GROUP BY` or `HAVING`.
- [x] Test with a distinct and a grouped single-table select.

### US-81.3: Remove targeted N+1 queries

- [ ] `list_versions`: load files for all versions in one query.
- [ ] `describe_skills`: validate snapshots in one batch.
- [ ] `delete_user_files`: one query for the filenames, one batch describe.
- [ ] Query-count tests for each.

### US-81.4: Async file store reads

- [ ] Add `async read_bytes` and `async exists` to `FileStore` (`asyncio.to_thread` in `LocalFileStore`); stop returning `Path` to the courses, captioning and files callers (8 `open()` callers).
- [ ] Handle `FileNotFoundError` in `courses/copies.py`; catch `asyncio.CancelledError` in the course file rollback blocks (`copies.py`, `publish.py`).
- [ ] Tests for a missing source file and a cancelled publish leaving no files.

### US-81.5: `files/service.py` structure

- [ ] Move remaining `UserFileModel` select builders into `domains/files/queries.py`.
- [ ] Replace `require_write` / `require_project_write` flags with explicit readable/writable helpers.
- [ ] No behavior change; existing tests stay green.

## Notes

US-81.5 is a refactor; do it last and keep it separate from bug fixes.
