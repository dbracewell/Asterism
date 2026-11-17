# EPIC-78: User and knowledge job lifecycle

Status: proposed. Source: [codebase review](../../codebase_review.md), verified 2026-11-14 (items 9, 10).

## Objective

Make restarts and user deletion leave no stuck or orphaned background work.

## User stories

### US-78.1: Interrupted captioning resumes after a restart

`recover_interrupted()` marks interrupted captioning `FAILED` with "retry queued", but `resume_ingestion_jobs()` only selects `PENDING` artifacts, so image captioning is never re-enqueued.

- [ ] In `resume_ingestion_jobs()`, re-enqueue captioning for image artifacts that are `READY`, not searchable, with captioning requested and its extraction interrupted or `PENDING`.
- [ ] Respect the captioning mode (do nothing when disabled).
- [ ] Test: interrupt captioning, run recovery and resume, assert one caption job is queued; a second resume does not double-queue.

### US-78.2: Deleting a user stops their work

`delete_user` does not retire the user's chat jobs or cancel file ingestion/captioning, so a late job can write orphaned vectors into LanceDB.

- [ ] Retire the user's chat jobs (`chat_jobs.retire`) and cancel their file jobs (`cancel_file_jobs`) before the vector and file-store cleanup.
- [ ] Test that a job in flight at deletion leaves no vectors behind.
- [ ] Note: the review's group-cache point does not apply; `_mirrored_roles` is a bounded TTL cache and there is no `evict_user_group`. Optionally pop the user from it for tidiness.

## Notes

Independent of EPIC-77; either order.
