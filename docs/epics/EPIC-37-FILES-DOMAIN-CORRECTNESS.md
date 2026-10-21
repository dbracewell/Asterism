# EPIC-37: Files domain correctness

Status: implemented. Source: the files-domain review of 2026-10-21
(`apps/backend/asterism/domains/files`), which reported 24 findings; this
epic carries the four that were confirmed as defects worth fixing immediately.

## Objective

Make the file domain's observable behavior match what the code claims to
guarantee, and remove the one piece of schema that could never do any work.

## Ownership and delivery

All changes stay inside the owning domain plus the chat orchestrator that
consumes the file read result. No API contract changes, so no client
regeneration is required. The schema change (dropping one redundant index)
uses fresh initialization; there are no migrations.

## US-37.1: Correct content-cache invalidation, empty-file reporting, delete robustness, and schema cleanup

As a user, I want a file's derived content and metadata to reflect the bytes
that are actually stored, and a completed delete to stay successful.

Estimate: 1 day. Dependencies: None.

Acceptance criteria:

A source whose bytes were replaced is detected even when its length did not
change, so the cached conversion and the recorded digest are refreshed and the
download `ETag` cannot describe stale content. An empty source is reported as
an attached (empty) file rather than as an unsupported type, in both the
runtime read result and the assembled chat message. A delete whose stored
source cannot be removed still succeeds, because the database deletion is
authoritative, and the swallowed failures are logged instead of being silent.
The file table keeps only the constraint the composite foreign keys require and
drops the index that duplicated an existing unique index.

Tasks:

- [x] Verify the stored source's digest on every read and invalidate the
      cached conversion when it no longer matches.
- [x] Distinguish "no cached text" from "cached empty text" in the runtime
      read result, and treat an empty attachment as attached in the chat
      orchestrator.
- [x] Guard the stored-source removal that runs after the delete commit, and
      log the previously silent swallowed failures.
- [x] Drop the redundant `user_files` index and document why the composite
      unique constraint must stay.
- [x] Add regression tests for each fix, verify they fail against the
      pre-fix implementation, and run the backend and frontend gates.
