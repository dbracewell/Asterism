# Completed checklist — 2026-11-17

Codebase review follow-ups ([codebase review](../../codebase_review.md),
verified 2026-11-14). EPIC-77, EPIC-78, EPIC-79 and EPIC-80 are complete; each
story was confirmed and merged with `--no-ff` before the next began. EPIC-80
stories were confirmed and merged on 2026-11-17; see ADR-0065 (pinned fetch
transport).

### [EPIC-77: Chat runtime reliability](../epics/EPIC-77-CHAT-RUNTIME-RELIABILITY.md)

- [x] US-77.1: Authorization checks stop running per token
- [x] US-77.2: Failed turns leave `PENDING`
- [x] US-77.3: Several tabs on one chat each get the full stream
- [x] US-77.4: Job and shutdown races
- [x] US-77.5: WebSocket rejects cleanly before accept

### [EPIC-78: User and knowledge job lifecycle](../epics/EPIC-78-USER-AND-KNOWLEDGE-LIFECYCLE.md)

- [x] US-78.1: Interrupted captioning resumes after a restart
- [x] US-78.2: Deleting a user stops their work

### [EPIC-79: Frontend runtime fixes](../epics/EPIC-79-FRONTEND-RUNTIME-FIXES.md)

- [x] US-79.1: Full-size images load
- [x] US-79.2: Admin "Test" does not erase unsaved edits
- [x] US-79.3: System webhooks are not rate limited as one client
- [x] US-79.4: Sign-in and auth robustness
- [x] US-79.5: SSE worker does not reconnect with no tabs
- [x] US-79.6: Pickers and image settings stop refetching the app

### [EPIC-80: Fetch tool hardening](../epics/EPIC-80-FETCH-TOOL-HARDENING.md)

- [x] US-80.1: Bounded, streamed fetch
- [x] US-80.2: Pin the resolved address
- [x] US-80.3: Parse once, off the event loop
