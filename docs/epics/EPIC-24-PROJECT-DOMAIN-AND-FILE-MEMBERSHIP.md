# EPIC-24 — Project domain and file membership

Status: Complete — all three stories user-confirmed on 2026-10-14.

Contracts: [ADR-0017](../adr/0017-project-file-and-chat-boundaries.md).

Part of the [Projects and Chat Context Refactor](../plans/projects-and-chat-context-refactor.md). Product assumptions, module contracts, exclusions, and shared quality gates are defined there.

Estimated effort: **5–8 engineering person-days**, including story-level verification.

## User stories
### US-24.1 — Project boundaries and fresh schema

As a developer, I want explicit project, file, and chat boundaries so each module can evolve independently.

**Estimate:** 1–2 person-days. **Dependencies:** None.
- [x] US-24.1-T1: Document the proposed contracts and lifecycle rules in an ADR; resolve the roadmap assumptions before implementation.
- [x] US-24.1-T2: Add Project (owner, name, description, system_prompt, context_revision, timestamps) and unique ProjectFile memberships; use composite ownership constraints or equivalent DB enforcement.
- [x] US-24.1-T3: Keep source files and extraction generations independent of projects; update fresh initialization and isolated reset fixtures without migrations.
- [x] US-24.1-T4: Add schema/invariant tests and review dependency direction; do not introduce a generic container framework.

**Acceptance:** Fresh initialization creates the new tables; duplicate memberships and cross-owner references are rejected; extraction imports no project or chat models.

### US-24.2 — Project lifecycle API

As a user, I want to create, edit, find, and delete projects with their instructions.

**Estimate:** 2–3 person-days. **Dependencies:** US-24.1.
- [x] US-24.2-T1: Implement owner-scoped create/read/update/delete, pagination, search, validation, and deterministic sorting.
- [x] US-24.2-T2: Increment context_revision for prompt and membership changes; reject stale updates where appropriate.
- [x] US-24.2-T3: Define deletion as detach chats to General and remove memberships while retaining source files; cancel affected runs before deletion once runtime integration exists.
- [x] US-24.2-T4: Regenerate Hey API types and add authorization, lifecycle, and validation tests.

**Acceptance:** Foreign projects are inaccessible; name is required; description and prompt may be empty; deleting a project never deletes shared source files.

### US-24.3 — Project file membership API

As a user, I want to add and remove files from projects without copying or reprocessing them.

**Estimate:** 2–3 person-days. **Dependencies:** US-24.2.
- [x] US-24.3-T1: Implement atomic bulk add/remove and paginated project file listing through the file-service boundary.
- [x] US-24.3-T2: Validate all file owners, enforce unique membership, and report already-added files deterministically.
- [x] US-24.3-T3: Expose project membership summaries for file views and removal impact; omit unused manual ordering.
- [x] US-24.3-T4: Regenerate clients and test sharing one file between projects, removal, and physical-file deletion cleanup.
- [x] US-24.3-T5: Persist original project and chat files through FileStore using user-scoped, file-ID-sharded paths (for example files/<user-id>/<id-prefix-1>/<id-prefix-2>/<file-id>/source.<ext>); keep original names in metadata and project/chat organization in database memberships. Resolve opaque storage keys through FileStore; do not expose or reconstruct local paths in callers, copy files on membership changes, or scan directories for file listings. Reset disposable storage without migration or legacy-path fallbacks.
- [x] US-24.3-T6: Add file-store contract tests for deterministic shard placement, owner isolation, original-byte round trips, shared references without duplicate source writes, stable storage keys across project rename/membership changes, and source deletion; verify extraction reads through the storage abstraction.

**Acceptance:** Adding a file twice is harmless; a foreign ID rejects the whole batch; removing membership preserves bytes, extraction, and other memberships. Original files use user-scoped, file-ID-sharded storage behind FileStore; the same file can be referenced by multiple projects/chats without another physical copy. Project changes leave storage keys unchanged, and file listings use database queries.

## Shared definition of done

Complete only one story at a time, on its own feature branch. Run relevant lint, type checks, unit/integration tests, generated-client checks, and E2E for changed workflows. Record unrun gates accurately. Update todo/documentation; obtain user completion confirmation before merge. This plan does not authorize resetting the current database during planning.

## US-24.1 implementation and verification (2026-10-14)

Implemented on `feat/us-24.1-project-boundaries`; user confirmed completion on 2026-10-14. Completed checklist archived in [the daily archive](../archive/todo-completed-2026-10-14.md).
All ten roadmap assumptions were approved and recorded in ADR-0017. The model registry
now includes projects and unordered, composite-owner-constrained project memberships;
file storage and extraction models remain independent. No migrations were added.

| Gate | Result |
| --- | --- |
| Backend lint (`uv run ruff check .`) | Passed |
| Backend typecheck (`uv run python -m compileall -q asterism`) | Passed; repository gate is compilation, not static typing |
| Full backend unit/integration suite (test-profile wrapper) | 249 passed |
| Dependency review (`knot asterism`) | No circular imports; 129 modules, 428 internal imports |
| Fresh initialization / isolated reset / schema invariants | Passed within backend suite, including direct owner updates and extraction import boundary |
| Application / OpenAPI import | Passed; no project routes or public schemas introduced |
| Generated clients | Unchanged; no API contract changes in this story |
| Frontend lint/typecheck/tests/build; Playwright | Not run; no frontend or changed user workflows |
| Whitespace diff check | Passed |

The working development database was not reset. User confirmation authorizes committing and merging this story.
Existing unrelated `.pi/` and other epic planning files were preserved.

## US-24.2 implementation and verification (2026-10-14)

Implemented on `feat/us-24.2-project-lifecycle-api`; user confirmed completion on 2026-10-14. Completed checklist archived in [the daily archive](../archive/todo-completed-2026-10-14.md).
Owner-scoped CRUD, pagination, literal name/description search, deterministic sorting,
request validation, duplicate-name conflicts, and atomic revision guards are implemented.
Changed prompts advance context_revision; metadata-only edits/no-ops do not. PATCH and
DELETE require the expected context revision. A transaction-local revision operation
is provided/tested for actual membership changes in US-24.3.

Deletion cascades memberships and preserves source bytes, extraction, and other project
references. The deletion lifecycle is defined now; chat detachment is implemented in
US-25.2 after binding exists, and cancellation before deletion in US-26.1 after runtime
integration exists. Those future task descriptions explicitly record the handoff.
No placeholder framework, migrations, or working database reset were introduced.

| Gate | Result |
| --- | --- |
| Backend Ruff | Passed |
| Backend compileall | Passed; repository typecheck gate is compilation |
| Targeted static type check (`basedpyright`, projects/schemas.py) | Passed: 0 errors, 0 warnings after correcting optional patch-field annotations |
| Focused project HTTP API tests | 38 passed; JWT token decoding is substituted in ASGI tests, while Bearer requirement and user/service/DB boundaries run normally |
| Full backend unit/integration suite | 287 passed |
| Dependency cycles | None; 132 modules, 437 internal imports |
| Frontend ESLint | Passed |
| Frontend TypeScript (`tsc --noEmit`) | Passed |
| Frontend Vitest | 30 files, 86 tests passed |
| Frontend migration tests | 6 passed |
| OpenAPI / generated clients | Served schema exported through ASGI; SDK/types/Zod/query operations regenerated with Hey API 0.98.1. Independent regeneration matches all 18 TS files ignoring trailing whitespace only |
| Frontend build / isolated Playwright | Not run; no frontend workflow added in this story |
| Root configuration tests / CI jobs | Not run; configuration/workflow files unchanged; CI not triggered |
| Diff whitespace check | Passed |

Tests cover direct API ownership isolation, all endpoints requiring auth, request
validation, empty description/prompt, duplicate-name rollback, stale/no-op/metadata
updates, concurrent prompt/create winners, stable pagination, literal wildcard searches,
shared-source byte preservation, and transactional membership revision rollback.
User confirmation authorizes committing and merging US-24.2.

Schema review correction: patch fields now explicitly allow None internally for omitted
values, with a validator rejecting supplied nulls. SkipJsonSchema keeps the request
contract non-nullable. Revision-only patches are tested as no-ops. Focused tests
(38), full backend suite (287), Ruff, and targeted static typing were rerun successfully.
Independent regeneration confirms unchanged client contracts after normalizing only
the existing import-time AgentProfile UUID default and trailing whitespace.


## US-24.3 implementation and verification (2026-10-14)

Implemented on `feat/us-24.3-project-file-membership`; user confirmed completion
on 2026-10-14, authorizing commit/merge. Completed checklist archived in
[the daily archive](../archive/todo-completed-2026-10-14.md). EPIC-24 is complete;
US-25.1 is the next recommended story.

Added owner-scoped paginated project file listing and atomic bulk add/remove through
file-service validation/listing boundaries. Expected context revisions serialize
concurrent membership writes; real batches advance once, no-ops retain the revision,
and stale requests fail. UUID-sorted changed/unchanged IDs report duplicates and absent
memberships deterministically. Mixed-owner/missing IDs reject the whole batch.
File list/detail/related-file responses carry project identity/revision summaries;
physical file deletion removes references and advances affected project contexts.
Membership operations do not enqueue extraction, move bytes, or invoke FileStore.

Uploads persist internal opaque storage keys for user-scoped, UUID-sharded originals;
metadata preserves names. Downloads, conversion, extraction/captioning, and chat image
reads resolve keys through FileStore. Directory listing was removed from the source
store contract. Ordinary initialization preserves data; explicit reset now clears
originals and extraction storage while retaining provider model bundles. No migrations,
legacy-path fallbacks, manual ordering, UI workflows, or working-data reset were added.
Chat file binding and project UI remain in their subsequent stories.

| Gate | Result |
| --- | --- |
| Backend Ruff | Passed |
| Backend compileall | Passed; repository typecheck gate is compilation |
| Full backend unit/integration suite (test-profile wrapper) | 310 passed after query responsibility refactor |
| Source-store contract / project membership HTTP tests | Passed within backend suite; includes sharing, stale/concurrent writes, atomic foreign/missing rejection, stable keys, original bytes, owner/shard isolation, no repeated writes/processing, removal, deletion, and isolated reset |
| Dependency/import review | No circular imports; 136 modules, 457 internal imports; all source consumers resolve keys through FileStore |
| Frontend ESLint | Passed |
| Frontend TypeScript | Passed |
| Frontend Vitest | 30 files, 86 tests passed |
| Frontend auth migration tests | 6 passed |
| Frontend production build | Passed |
| OpenAPI / generated clients | Served schema exported with ASGI; Hey API 0.98.1 regenerated SDK/types/Zod/query operations. Independent generation matches all 18 TS files, ignoring trailing whitespace only |
| Isolated Playwright (`CI=1`) | 11 passed, one worker, no test retries; existing UI workflows use API mocks. New project membership and real source-byte behavior are verified by backend HTTP/integration tests, pending project UI stories |
| Root configuration tests | 29 passed |
| Diff whitespace check | Passed |
| GitHub CI | Not triggered; local gates only |

Verification environment notes: initial frontend/E2E invocations stopped before tests
because dependency installation was incomplete, registry access was sandboxed, or the
SQLite native binding was absent. Dependencies were restored from the frozen lockfile
and SQLite rebuilt; the subsequent isolated E2E run passed all tests. Its backend is
intentionally terminated during cleanup (pnpm logs exit 143). Sandbox pnpm invocations
can request a modules-directory purge without a TTY; backend/config checks were verified
with the repository's underlying test-profile wrapper and Node command. No lockfile or
package manifest changes were made.

HTTP tests substitute JWT decoding while exercising normal Bearer enforcement,
owner/service checks, production foreign-key constraints, transactions, and source
storage. Dedicated file lifecycle tests also cover cleanup without FK cascades.


### Query responsibility review amendment

The user requested keeping functions focused and avoiding accumulating scope parameters
on `list_user_files`. Refactored this within US-24.3: `domains/files/queries.py` builds
reusable owner-scoped source selects; project/library callers compose their own
membership filters before pagination. `db/queries.py` provides typed, domain-neutral
count/page mechanics, while `domains/files/listing.py` separates page execution and
response enrichment. Owner scope is enforced again at execution. Removed the new
`file_ids` argument from the library service; project listing no longer calls it.
AGENTS.md and backend/ADR documentation record the responsibility and dependency rules.

Final amendment checks: full backend suite 310 passed, Ruff and compileall passed,
targeted basedpyright for all three new query/listing modules passed with zero errors,
and dependency analysis found no cycles (136 modules, 457 imports). Tests cover composed
membership filters before count/pagination, all sort modes with stable ties, literal
search, execution-level owner isolation even with an unscoped select, invalid page
bounds, and shared/domain query dependency boundaries. Public HTTP/OpenAPI contracts
are unchanged by this refactor. Served schema comparison matches after excluding the
pre-existing per-process `AgentProfile.id` UUID default; the prior frontend and Playwright results above were
not rerun for this amendment. No other story was started.
