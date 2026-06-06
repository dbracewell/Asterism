# EPIC-3-PROFILES-AND-AGENTS

## Goal
Implement user profiles and user-defined agents with required default invariants.

## User Stories

### US-3.1 Profile CRUD with default invariant
**As a user**, I want to create and manage profiles so I can separate personas and memory contexts.

#### Tasks
- [ ] Define profile schema and relationships.
- [ ] Implement profile CRUD APIs.
- [ ] Enforce at least one profile per user.
- [ ] Enforce exactly one default profile per user.
- [ ] Add tests for invariant enforcement.

### US-3.2 USER.md support per profile
**As a user**, I want each profile to have a custom USER.md so agent behavior can be personalized.

#### Tasks
- [ ] Add storage strategy for profile `USER.md` content.
- [ ] Implement APIs to read/update `USER.md`.
- [ ] Include `USER.md` in runtime context assembly.
- [ ] Add tests for persistence and retrieval.

### US-3.3 Agent CRUD with capability assignment
**As a user**, I want to define agents with prompts and allowed capabilities so each agent is purpose-built.

#### Tasks
- [ ] Define agent schema (prompt + allowed skills/tools/MCP).
- [ ] Implement agent CRUD APIs.
- [ ] Enforce at least one agent per user.
- [ ] Enforce exactly one default agent per user.
- [ ] Add tests for assignment and invariants.
