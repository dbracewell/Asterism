# EPIC-25 — Project chats and chat files

Status: Proposed / not started.

Part of the [Projects and Chat Context Refactor](../plans/projects-and-chat-context-refactor.md). Product assumptions, module contracts, exclusions, and shared quality gates are defined there.

Estimated effort: **6–9 engineering person-days**, including story-level verification.

## User stories
### US-25.1 — Chat project binding and scoped attachments

As a user, I want project chats and General chats to have explicit, isolated file access.

**Estimate:** 2–3 person-days. **Dependencies:** EPIC-24.
- [ ] US-25.1-T1: Replace folder_id with nullable project_id in chat contracts and introduce explicit ChatFile membership using stable file IDs.
- [ ] US-25.1-T2: Validate owner consistency at service and DB boundaries; a chat belongs to zero or one project.
- [ ] US-25.1-T3: Persist message-to-file provenance using file IDs and resolve attachments against the active message branch.
- [ ] US-25.1-T4: Compose project memberships and active-branch chat attachments without implicitly granting the entire user library.
- [ ] US-25.1-T5: Regenerate clients and test general/project chats, branches, missing files, and foreign identifiers.

**Acceptance:** General chats have no project prompt or project files; project chats can use project files plus their own attachments; sibling chats do not inherit attachments.

### US-25.2 — Chat membership changes and search

As a user, I want to organize and find chats within projects or General.

**Estimate:** 2–3 person-days. **Dependencies:** US-25.1.
- [ ] US-25.2-T1: Implement create-in-project and move-to-project/General, with owner validation and rejection while a run is active.
- [ ] US-25.2-T2: Apply new project prompt and files from the next turn; preserve chat-local attachments and historical messages. Connect project deletion to chat-service detachment into General in the same relational transaction once project binding exists.
- [ ] US-25.2-T3: Replace folder search and ancestor traversal with project name/description and chat search behind the existing search adapter.
- [ ] US-25.2-T4: Regenerate clients; test search isolation, pagination, move effects, and project deletion detaching chats.

**Acceptance:** Moves do not promote attachments into project files; search is owner-scoped; historical answers remain visible and are not retroactively regenerated.

### US-25.3 — Chat upload and attachment lifecycle

As a user, I want uploaded files to remain usable when I reopen a chat.

**Estimate:** 2–3 person-days. **Dependencies:** US-25.1.
- [ ] US-25.3-T1: Bind new uploads and explicitly selected library files to the target chat; support draft uploads before a new chat has an ID.
- [ ] US-25.3-T2: Define send/attach atomicity, failed-send retry, draft cleanup, and attachment removal without deleting source files.
- [ ] US-25.3-T3: Keep file access consistent across reopen, regenerate, branch changes, and deleted-file references.
- [ ] US-25.3-T4: Regenerate clients and test cancellation, failed upload/send, replay, removal, and cross-chat isolation.

**Acceptance:** An upload is available only through explicit scope memberships; reopening preserves valid attachments; draft or failed sends do not grant unrelated chats access.

## Shared definition of done

Complete only one story at a time, on its own feature branch. Run relevant lint, type checks, unit/integration tests, generated-client checks, and E2E for changed workflows. Record unrun gates accurately. Update todo/documentation; obtain user completion confirmation before merge. This plan does not authorize resetting the current database during planning.
