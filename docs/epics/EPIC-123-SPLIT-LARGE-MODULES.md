# EPIC-123: Split the largest modules

Status: proposed (2026-11-27). Source: repository review (2026-11-26), work
deferred from EPIC-117.

## Objective

Each large backend module is split along the jobs it already does, so a change
to one job doesn't touch the others. Behavior doesn't change.

Six backend modules are 830 to 1,310 lines long: `settings/service.py` (1,311),
`chat/orchestrator.py` (918), `canvas/exports.py` (890), `agent/agent.py`
(861), `files/service.py` (852) and `chat/router.py` (828). This doesn't affect
users; it makes those files harder to change safely, more so as more people
work on them.

## Stories

### US-123.1: Settings service

As a maintainer, I want each settings area in its own module.

- [x] `settings/service.py` is split by settings area, with the public
      functions it exposes kept stable.
- [x] Unused cache comments are removed, and the database conflicts it doesn't
      handle return a clear error.
- [x] All tests pass unchanged; the architecture docs name the new modules.

### US-123.2: Chat orchestrator and router

As a maintainer, I want streaming, persistence and routing apart in the chat
domain.

- [x] `chat/orchestrator.py` is split into turn flow, stream handling and
      saving the reply.
- [x] `chat/router.py` is split by resource; the OpenAPI schema is unchanged.
- [x] All tests pass unchanged; the architecture docs name the new modules.

### US-123.3: Exports, agent and files

As a maintainer, I want the remaining large modules split the same way.

- [ ] `canvas/exports.py` is split by export format.
- [ ] `agent/agent.py` separates the loop from tool dispatch.
- [ ] `files/service.py` separates storage, processing and listing.
- [ ] All tests pass unchanged; the architecture docs name the new modules.
