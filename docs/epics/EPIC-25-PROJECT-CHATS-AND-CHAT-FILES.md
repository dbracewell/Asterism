# EPIC-25 — Project chats and chat files

Status: US-25.1 complete (user confirmed 2026-10-14); US-25.2 complete (user confirmed 2026-10-14); US-25.3 pending.

Part of the [Projects and Chat Context Refactor](../plans/projects-and-chat-context-refactor.md). Product assumptions, module contracts, exclusions, and shared quality gates are defined there.

Estimated effort: **6–9 engineering person-days**, including story-level verification.

## User stories
### US-25.1 — Chat project binding and scoped attachments

As a user, I want project chats and General chats to have explicit, isolated file access.

**Estimate:** 2–3 person-days. **Dependencies:** EPIC-24.
- [x] US-25.1-T1: Replace folder_id with nullable project_id in chat contracts and introduce explicit ChatFile membership using stable file IDs.
- [x] US-25.1-T2: Validate owner consistency at service and DB boundaries; a chat belongs to zero or one project.
- [x] US-25.1-T3: Persist message-to-file provenance using file IDs and resolve attachments against the active message branch.
- [x] US-25.1-T4: Compose project memberships and active-branch chat attachments without implicitly granting the entire user library.
- [x] US-25.1-T5: Regenerate clients and test general/project chats, branches, missing files, and foreign identifiers.

**Acceptance:** General chats have no project prompt or project files; project chats can use project files plus their own attachments; sibling chats do not inherit attachments.

### US-25.2 — Chat membership changes and search

As a user, I want to organize and find chats within projects or General.

**Estimate:** 2–3 person-days. **Dependencies:** US-25.1.
- [x] US-25.2-T1: Implement create-in-project and move-to-project/General, with owner validation and rejection while a run is active.
- [x] US-25.2-T2: Apply new project prompt and files from the next turn; preserve chat-local attachments and historical messages. Connect project deletion to chat-service detachment into General in the same relational transaction once project binding exists.
- [x] US-25.2-T3: Replace folder search and ancestor traversal with project name/description and chat search behind the existing search adapter.
- [x] US-25.2-T4: Regenerate clients; test search isolation, pagination, move effects, and project deletion detaching chats.

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


## US-25.1 implementation and verification (2026-10-14)

Implemented on `feat/us-25.1-chat-project-file-scope`; user confirmed completion
on 2026-10-14, authorizing commit/merge. Completed checklist archived in
[the daily archive](../archive/todo-completed-2026-10-14.md). No later story was
started and no working database/source storage was reset.

Chat identity now uses nullable project_id with composite owner enforcement. ChatFile
is a unique owner-consistent source reference; message snapshots retain required stable
file IDs and original metadata. Chat/message creation commits snapshots and local
references together after validating all IDs. Input filenames/legacy folder binding
are rejected without a compatibility path. Parent and active-child database constraints
stay within one owner/chat; service checks additionally require a direct child.

A shared deterministic branch traversal supplies presentation and the chat file reader.
The reader composes owned project memberships with active-branch snapshot IDs intersected
with current local memberships/owned sources, returns sorted IDs and project/chat/message
provenance, and exposes project instructions/revision. General has no project prompt or
project files. Source-ID queries avoid loading file bodies. Scoped metadata/download
endpoints and runtime attachment assembly recheck this reader; same-name replacements
cannot retarget historical snapshots. Missing-source history remains visible with an
unavailable status. Physical-file cleanup removes memberships through a chat-owned
boundary even in fixtures without FK cascades. Title events use current persisted
project identity, including when deletion has detached a cached chat into General.

The schema also makes project deletion detach chat identity through SET NULL while
preserving owner, history, and local references. Explicit deletion coordination, guarded
moves, scoped chat lists/project search remain US-25.2. Basic project-bound creation is
provided now as part of binding; US-25.2 builds its lifecycle workflows on that foundation.
Draft/retry/send/attachment-removal lifecycle remains US-25.3. Project prompt composition
and contextual tool/retrieval/delegation authorization remain EPIC-26/29; legacy
knowledge-base tool assignments are not represented as having adopted this reader.

Replacing folder binding required removal of obsolete folder-chat APIs/schemas and their
immediate browser creation/list controls. Folder entities and independent title search
remain pending their planned removal. Generated clients and frontend create/stream/SSE
contracts now use projects and stable file IDs. Composer uploads use the generated
TanStack mutation; attachment previews/downloads use chat/file IDs. Project navigation
and move controls remain EPIC-27. The E2E upload test now verifies the stable-ID download
request and filename, using mocked source bytes.

| Gate | Result |
| --- | --- |
| Backend Ruff | Passed |
| Backend compileall | Passed; repository typecheck gate is compilation |
| Targeted basedpyright (five new attachment/branch/scope/cleanup modules) | Passed, 0 errors and 0 warnings |
| Full backend unit/integration suite | 330 passed |
| Fresh initialization/schema/ownership | Passed in backend suite with production SQLite FK policy; includes invalid direct writes/owner updates, unique memberships, project detachment, chat/source cleanup, and message-edge isolation |
| Chat HTTP/service/runtime regressions | Passed in backend suite: General/project/sibling/library isolation, foreign/missing/duplicate atomic rejection, active branches, detached references, original-byte downloads, cached runtime rechecks, reopen/deletion/same-name replacement, and event identity |
| Frontend ESLint | Passed |
| Frontend TypeScript | Passed |
| Frontend Vitest | 31 files, 87 tests passed; obsolete folder-chat tests replaced with current metadata behavior |
| Frontend auth migration tests | 6 passed |
| Frontend production build | Passed |
| Served OpenAPI / Hey API consistency | ASGI-served schema exported with /api/py root; SDK/types/Zod/query clients regenerated with Hey API 0.98.1; independent generation matches all 18 TS files ignoring trailing whitespace only |
| Isolated Playwright (`CI=1`) | 11 passed, one worker, no test retries; final run includes generated upload mutation and stable-ID source download. Browser workflows use API mocks; source ownership/branch/physical-byte behavior is separately verified with real backend HTTP/integration tests |
| Root configuration tests | 29 passed |
| Dependency/import review | No circular imports; 141 modules, 482 internal imports |
| Diff whitespace check | Passed |
| GitHub CI | Not triggered; local verification only |

HTTP tests substitute JWT decoding while normal Bearer enforcement, owner/service
checks, transactions, database constraints, and source storage execute normally.
No live provider call is required by runtime assembly tests. Playwright's backend
cleanup intentionally terminates pnpm/Uvicorn (pnpm logs exit 143 after passing).
The subsequent title-event identity correction was covered by the full backend suite;
it changes no browser code or OpenAPI contract.

The schema change requires a clean disposable-data reset before running against an older
development database. Only isolated test/E2E databases were initialized; no migrations,
legacy fallbacks, source copies on membership changes, or new extraction generations were
introduced. User completion confirmation on 2026-10-14 authorizes commit/merge.


## US-25.2 implementation and verification (2026-10-14)

Implemented on `feature/us-25.2-chat-membership-search`; user confirmed completion
on 2026-10-14, authorizing commit/merge. Completed checklist archived in the
[daily archive](../archive/todo-completed-2026-10-14.md). Only this story was implemented.

Owned project creation remains on POST /chat/. PATCH /chat/{chat_id}/project requires
an explicit nullable project_id, validates both owners and returns current ChatInfo.
Moves to a project or General preserve message/branch history and local memberships,
and do not promote attachments, duplicate sources or alter extraction generations.
Active generation/pending approval and overlapping moves return 409. The existing
process-local job manager blocks new turn starts until commit/rollback; this does not
claim a distributed run lock. Scope reads refresh cached chat/project ORM identity and
immediately expose the destination prompt/revision/file IDs. Historical answers can
retain prior project information. Full provider prompt composition, contextual tools
and project-deletion run cancellation remain the assigned EPIC-26/29 work.

Project deletion obtains a revision-guarded write lock, calls a chat-owned detachment
operation without committing, then deletes/commits in the same transaction. Injected
failure after detachment and stale revisions leave both project and chats intact.

General/project chat lists filter before database pagination. Indexed search replaces
folder title/ancestor search with owned project name/description and chat title/content
matches. Default search spans chats/projects; General/project scopes return their chats.
Mixed results paginate in SQL with deterministic updated-time/kind/UUID ordering and
page-only enrichment, including current project identity. Domain-owned base selects
and separate search query/enrichment helpers keep policy out of common DB mechanics.
SQLite initialization installs project FTS triggers; obsolete folder entities remain
for EPIC-28. No prompt/extracted-file content is indexed.

The existing search UI displays project description/name matches and chat membership.
The General sidebar now pages older chats and refetches paged data on title events so
membership/order/count metadata stay current. Project navigation/move controls remain
EPIC-27. Hey API SDK/types/Zod/query operations were regenerated from ASGI-served
OpenAPI; an independent generation matched all 18 TypeScript files ignoring trailing
whitespace only.

| Gate | Result |
| --- | --- |
| Backend Ruff / compileall | Passed |
| Targeted basedpyright (membership/search/query/project-reader modules) | Passed, 0 errors/warnings |
| Full backend unit/integration suite | 338 passed |
| Move/lifecycle/search regressions | Passed: owner/auth isolation, active generation/approval denial, start-vs-move serialization, history/local attachment preservation, stale/failed delete rollback, cached identity refresh, scoped SQL pagination, project index update/delete, adapter ownership recheck, OpenAPI contracts |
| Frontend ESLint / TypeScript | Passed |
| Frontend Vitest | 32 files, 89 tests passed |
| Frontend auth migration tests | 6 passed |
| Root configuration tests | 29 passed |
| Production build | Passed |
| OpenAPI / Hey API consistency | Passed, independent 18-file comparison |
| Isolated Playwright (`CI=1`) | Final run: 12 passed, one worker, no retries; changed search tested with API mocks, real owner/transaction behavior covered by backend HTTP tests |
| Dependency cycles | Passed; 145 modules, 505 internal imports, no circular imports |
| Diff whitespace | Passed |
| GitHub CI | Not triggered; local verification only |

Initial frontend search expectations were updated from folder paths to project identity.
The new E2E page initially redirected to sign-in; it was added to the existing test-only
public-route allowlist, and the complete browser suite passed on the final run.
An interrupted pnpm automatic dependency reinstall hit sandbox network restrictions
and left missing links; generated install metadata was refreshed and dependencies
restored with network access. Frontend lint/type/unit/migration commands used the
repository script bodies through `pnpm --config.verifyDepsBeforeRun=false exec` to
avoid repeated local reinstall attempts. Build/E2E ran with required network/localhost
access. No tracked dependency/configuration changes were made. Expected browser
failed-upload logging and deliberate backend shutdown exit 143 are part of existing
isolated tests/cleanup.

Only isolated databases were initialized. No working database reset, migration,
compatibility adapter, live provider call or later-story implementation occurred.
Older disposable development schemas/indexes require the documented reset workflow.
