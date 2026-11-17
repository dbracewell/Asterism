# EPIC-77: Chat runtime reliability

Status: in progress (US-77.2, US-77.1, US-77.3 and US-77.4 done). Source: [codebase review](../../codebase_review.md), verified 2026-11-14 (items 1, 2, 3, 7, 8, 12).

## Objective

Remove the runtime defects in the chat streaming and background-job path: per-token
database work, failed turns that retry on every reconnect, packets lost between tabs,
and job and shutdown races.

## User stories

### US-77.1: Authorization checks stop running per token

`Agent.run` calls `authorization_check` on every streamed event, and each call opens a
database session (persona, skills, sub-agents).

- [x] Run the check at the start of each loop step, on `LLMEventType.START` and on `LLMEventType.COMPLETE` (before recording steps or running tools); not on `TEXT_DELTA` / `THINKING_DELTA`.
- [x] Test that a streamed response of N deltas performs a constant number of checks, and that revoked access still stops a turn before tools run.

### US-77.2: Failed turns leave `PENDING`

An agent error, an empty completion or an unhandled exception leaves the parent message `PENDING`, so `resume_pending_turn()` re-runs the call on every WebSocket connect.

- [x] Add a failure finalizer in `ChatOrchestrator.run_agent`, alongside the cancellation path (`cancel_active_generation`), that moves the parent message (or fork step) out of `PENDING`.
- [x] Cover the error event, the empty-response case and the exception case, plus comparison columns.
- [x] Test that reconnecting after a failure does not call the model again and the client still sees the error.

### US-77.3: Several tabs on one chat each get the full stream

All controllers for a chat consume one shared `MessageQueue`, so two tabs steal each other's packets.

- [x] Give each attached `ChatController` its own bounded subscriber queue on the chat's stream (1:1 with `ChatJob`); broadcast each packet to every subscriber.
- [x] Buffer on the job only while no controller is attached, and replay to the first controller that attaches; keep the "drop oldest" bound and `discard_message_queue` lifecycle.
- [x] Test two controllers on one chat both receive every `DELTA` and `COMPLETE`, and that detach/reattach loses nothing within the bound.

### US-77.4: Job and shutdown races

- [x] `JobManager.enqueue`: the done callback only removes its own task (`self._tasks.get(key) is task`), and logs `task.exception()`; same exception retrieval in `BackgroundTaskManager`.
- [x] `EventBus.shutdown()` awaits pending tasks (with a timeout) before cancelling so `SYSTEM_STOP` handlers run.
- [x] Tests for re-enqueue immediately after completion and for a `SYSTEM_STOP` handler running during lifespan shutdown.

### US-77.5: WebSocket rejects cleanly before accept

`get_one` and `get_agent_profile` run before `websocket.accept()` with no handler for `NotFoundException` / `ForbiddenException`.

- [ ] Map those failures to a close code with a reason (as the unauthorized and no-agent paths do), and keep admission released.
- [ ] Test for an unknown chat and another user's chat.

## Notes

Suggested order: US-77.2, US-77.1, US-77.3, US-77.4, US-77.5. US-77.3 is the largest.
