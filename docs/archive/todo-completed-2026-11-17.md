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

The user confirmed EPIC-81 completion on 2026-11-17. Each story was confirmed
and merged with `--no-ff` before the next began.

### [EPIC-81: Backend data layer and storage](../epics/EPIC-81-BACKEND-DATA-LAYER.md)

- [x] US-81.2: `paginate_select` counts correctly (merged 2026-11-17)
- [x] US-81.1: Cheaper search index maintenance (merged 2026-11-17)
- [x] US-81.3: Remove targeted N+1 queries (merged 2026-11-17)
- [x] US-81.4: Async file store reads (merged 2026-11-17)
- [x] US-81.5: `files/service.py` structure (merged 2026-11-17)

The user confirmed EPIC-82 completion on 2026-11-17. Each story was confirmed
and merged with `--no-ff` before the next began.

### [EPIC-82: Code cleanup and deduplication](../epics/EPIC-82-CODE-CLEANUP.md)

- [x] US-82.3: Dead code and small leaks (merged 2026-11-17)
- [x] US-82.1: Shared utilities (merged 2026-11-17)
- [x] US-82.2: One boolean admin policy panel (merged 2026-11-17)
- [x] US-82.4: Split oversized components (merged 2026-11-17)

## Feature consolidation

Source: the [feature overlap review](../reviews/2026-11-17-feature-overlap-review.md).
EPIC-83 is complete. US-83.1 to US-83.3 were merged together on 2026-11-17
because the backend change broke the frontend until the persona UI was removed;
US-83.4 was merged after. See ADR-0066 (About you).

### [EPIC-83: Your Asterism (replace personas with one "About you")](../epics/EPIC-83-YOUR-ASTERISM-AND-PERSONA-REMOVAL.md)

- [x] US-83.1: About you replaces personas (backend)
- [x] US-83.2: Your Asterism settings section (frontend)
- [x] US-83.3: Remove persona from chat and the rest of the UI
- [x] US-83.4: Docs and invariants

EPIC-84 is complete. US-84.1 to US-84.3 were each merged on 2026-11-17. US-84.1
pointed the old panels at the new routes so the frontend stayed green until
US-84.2 replaced them. US-84.2 also added the `item` field to Add card, so a
reworded card still clears its unclear item. See ADR-0067 (Progress panel).

### [EPIC-84: One progress panel](../epics/EPIC-84-ONE-PROGRESS-PANEL.md)

- [x] US-84.1: Progress read and one practice route (backend)
- [x] US-84.2: Progress panel (frontend)
- [x] US-84.3: Help and docs

EPIC-85 is complete. US-85.1 to US-85.3 were each merged on 2026-11-17. US-85.1
pointed the old lock and course-policy components at the new fields so the
frontend stayed green until US-85.2 replaced them. No classes/educator README
sections existed, so US-85.3 documented course limits in the project
workspaces architecture doc. See ADR-0068 (Effective mode policy).

### [EPIC-85: One mode policy](../epics/EPIC-85-ONE-MODE-POLICY.md)

- [x] US-85.1: Effective policy and one check (backend)
- [x] US-85.2: One policy control (frontend)
- [x] US-85.3: Help and docs
