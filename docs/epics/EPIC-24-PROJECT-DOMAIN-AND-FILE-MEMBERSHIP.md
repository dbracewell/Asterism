# EPIC-24 — Project domain and file membership

Status: US-24.1 complete (user confirmed 2026-10-14); US-24.2 and US-24.3 not started.

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
- [ ] US-24.2-T1: Implement owner-scoped create/read/update/delete, pagination, search, validation, and deterministic sorting.
- [ ] US-24.2-T2: Increment context_revision for prompt and membership changes; reject stale updates where appropriate.
- [ ] US-24.2-T3: Define deletion as detach chats to General and remove memberships while retaining source files; cancel affected runs before deletion once runtime integration exists.
- [ ] US-24.2-T4: Regenerate Hey API types and add authorization, lifecycle, and validation tests.

**Acceptance:** Foreign projects are inaccessible; name is required; description and prompt may be empty; deleting a project never deletes shared source files.

### US-24.3 — Project file membership API

As a user, I want to add and remove files from projects without copying or reprocessing them.

**Estimate:** 2–3 person-days. **Dependencies:** US-24.2.
- [ ] US-24.3-T1: Implement atomic bulk add/remove and paginated project file listing through the file-service boundary.
- [ ] US-24.3-T2: Validate all file owners, enforce unique membership, and report already-added files deterministically.
- [ ] US-24.3-T3: Expose project membership summaries for file views and removal impact; omit unused manual ordering.
- [ ] US-24.3-T4: Regenerate clients and test sharing one file between projects, removal, and physical-file deletion cleanup.
- [ ] US-24.3-T5: Persist original project and chat files through FileStore using user-scoped, file-ID-sharded paths (for example files/<user-id>/<id-prefix-1>/<id-prefix-2>/<file-id>/source.<ext>); keep original names in metadata and project/chat organization in database memberships. Resolve opaque storage keys through FileStore; do not expose or reconstruct local paths in callers, copy files on membership changes, or scan directories for file listings. Reset disposable storage without migration or legacy-path fallbacks.
- [ ] US-24.3-T6: Add file-store contract tests for deterministic shard placement, owner isolation, original-byte round trips, shared references without duplicate source writes, stable storage keys across project rename/membership changes, and source deletion; verify extraction reads through the storage abstraction.

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
