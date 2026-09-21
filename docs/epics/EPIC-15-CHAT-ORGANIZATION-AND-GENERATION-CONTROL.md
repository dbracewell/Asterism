# EPIC-15 — Chat Organization and Generation Control

## Goal

**Status: Completed and user-confirmed.**

Make chats safer to manage and easier to find while preserving background generation when a user leaves a chat. A WebSocket connection is a view onto a chat job, not the job's owner.

## Scope and decisions

- Leaving a chat, navigating away, closing a tab, or transient WebSocket failure must not cancel its generation.
- Only an explicit, authenticated **Stop generating** action may cancel the active job.
- There is at most one active generation per chat. A reconnect subscribes to its state; it never starts a duplicate job.
- Cancellation produces a persisted terminal message state and retains any partial assistant content when available.
- Search is user-scoped, keyword based, paginated, and covers folder titles, chat titles, and chat message content.
- Sidebar deletion supports a selection mode, a single confirmation path for one or many chats, and atomic ownership-safe bulk deletion.
- Folder pages provide paginated direct chat sessions, a folder-scoped new-chat composer, and clearly labelled conversation previews. A model-generated semantic summary is explicitly deferred unless separately approved.
- Context-window UI is labelled estimated unless the selected model/provider supplies compatible token accounting. It must account for the actual assembled runtime payload, not only stored message fields.

## User stories

### US-15.1 — Keep generation running in the background and allow explicit cancellation

**As a user**, I want to leave a chat while generation continues, return to see the result, and explicitly stop generation when I choose, so that navigation is not destructive and I retain control over work in progress.

**Dependencies:** None.

- [ ] US-15.1-T1: Introduce a per-chat background job manager that owns active orchestration independently of WebSocket controllers and prevents duplicate jobs.
- [ ] US-15.1-T2: Make WebSocket connections attach/detach from job state without cancelling it on disconnect; support reconnect during and after generation.
- [ ] US-15.1-T3: Add an authenticated `cancel` command and cancellation-safe orchestration, including model streams, tool tasks, and pending approvals.
- [ ] US-15.1-T4: Persist a terminal cancelled state and partial assistant output where available; ensure cancelled/pending work never restarts on reconnect.
- [ ] US-15.1-T5: Add accessible Stop-generating UI and live status handling without treating navigation as cancellation.
- [ ] US-15.1-T6: Add backend/frontend tests for disconnect continuation, reconnect, explicit cancellation, terminal persistence, and duplicate-job prevention.

**Acceptance criteria**

- A response completes after the initiating browser disconnects and is visible when the user returns.
- Reconnecting while a response is active observes current/final state without a second provider call.
- Stop is explicit, terminates the active job, and leaves no resumable pending message.
- Only the chat owner can send or observe commands/events for that chat.

### US-15.2 — Find chats and folders with keyword search

- [ ] Add a user-scoped, paginated search API and SQLite FTS-backed indexes for folder titles, chat titles, and message content.
- [ ] Return typed grouped results with match reason, safe snippet, chat/folder path, and stable ordering.
- [ ] Add debounced accessible sidebar/global search UI using the generated client.
- [ ] Test user isolation, escaping, pagination, title/content/folder matches, and empty/error states.

### US-15.6 — Generate reliable chat titles

**As a user**, I want every new chat to receive a useful title even if I navigate away immediately, so that chat history and search remain usable.

**Dependencies:** US-15.1.

- [ ] US-15.6-T1: Move title generation into the connection-independent chat job lifecycle and ensure it runs at most once per chat.
- [ ] US-15.6-T2: Replace the unbounded empty-title retry with bounded retries, timeouts, validation, and a deterministic fallback title.
- [ ] US-15.6-T3: Persist and publish the final title reliably; prevent background failures from leaving a title permanently null.
- [ ] US-15.6-T4: Add tests for disconnect continuation, empty/invalid provider output, provider failure, duplicate connections, title persistence, and search/sidebar updates.

**Acceptance criteria**

- A new chat gets a non-empty title regardless of whether its initiating WebSocket remains connected.
- Provider failures or malformed title output resolve to a deterministic fallback rather than a null title or infinite retry.
- A title is generated once and remains stable after navigation/reconnect.

### US-15.3 — Select and safely delete chats from the sidebar

- [ ] Add sidebar selection mode, selected count, select-visible, and accessible keyboard controls.
- [ ] Add atomic bulk deletion with strict ownership validation and coherent cache invalidation.
- [ ] Require confirmation for single and bulk chat deletion; handle Escape/backdrop cancellation correctly.
- [ ] Test confirmation, active-route navigation, partial failure, cache updates, and bulk ownership checks.

### US-15.4 — Browse and start chats from a folder page

- [ ] Add an ownership-safe folder route and paginated direct-chat listing API.
- [ ] Render session cards with title, updated time, agent, message count, and deterministic conversation preview.
- [ ] Add a folder-scoped composer that starts a chat in that folder and routes to it.
- [ ] Test pagination, empty states, ownership, navigation, and folder assignment.

### US-15.5 — Show estimated chat context consumption

- [x] Expose selected-chat model context metadata through the generated API client.
- [x] Calculate input usage from the assembled model payload and reserved output budget; label estimates honestly.
- [x] Render accessible normal/warning/critical context meter states.
- [x] Test unknown model limits, multimodal/file/tool content, and threshold states.
- [x] Display tokens per second for each generated message using provider-reported output tokens and generation duration.

## Execution

Order: **US-15.1 → US-15.2 → US-15.6 → US-15.3 → US-15.4 → US-15.5**. Work on one story at a time. Regenerate the Hey API client after OpenAPI changes and request user confirmation before merging each completed story.
