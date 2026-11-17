# EPIC-78: User and knowledge job lifecycle

Status: complete (2026-11-17). Source: [codebase review](../../codebase_review.md), verified 2026-11-14 (items 9, 10).

## Objective

Make restarts and user deletion leave no stuck or orphaned background work.

## User stories

### US-78.1: Interrupted captioning resumes after a restart

`recover_interrupted()` marks interrupted captioning `FAILED` with "retry queued", but `resume_ingestion_jobs()` only selects `PENDING` artifacts, so image captioning is never re-enqueued.

- [x] In `resume_ingestion_jobs()`, re-enqueue captioning for image artifacts that are `READY`, not searchable, with captioning requested and its extraction interrupted or `PENDING`.
- [x] Respect the captioning mode (do nothing when disabled).
- [x] Test: interrupt captioning, run recovery and resume, assert one caption job is queued; a second resume does not double-queue.

### US-78.2: Deleting a user stops their work

`delete_user` does not retire the user's chat jobs or cancel file ingestion/captioning, so a late job can write orphaned vectors into LanceDB.

- [x] Retire the user's chat jobs (`chat_jobs.retire`) and cancel their file jobs (`cancel_file_jobs`) before the vector and file-store cleanup. Done twice: before the delete, while rows exist, and again after the commit with ids read inside the delete transaction.
- [x] Test that a job in flight at deletion leaves no vectors behind.
- [x] Note: the review's group-cache point does not apply; `_mirrored_roles` is a bounded TTL cache and there is no `evict_user_group`. Left as is: a deleted id is tombstoned and never re-created, so a stale entry has no effect.

## Notes

Independent of EPIC-77; either order.
