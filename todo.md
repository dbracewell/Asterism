# Asterism Todo

Status legend:
- `[ ]` not started
- `[-]` in progress
- `[x]` completed

## Active Story
- EPIC-1 / US-1.4 Backend testing scaffold (pytest)

---

## EPIC-1-FOUNDATIONS

### [x] US-1.1 Monorepo tooling and workspace standards
- [x] Confirm root scripts for `dev`, `build`, `lint`, `test`, `typecheck`.
- [x] Validate `turbo.json` pipelines and task dependencies.
- [x] Add/update shared formatting and linting config.
- [x] Document common monorepo commands.
- [x] Triage baseline lint/typecheck/build failures discovered during verification runs.

### [x] US-1.2 Backend and frontend baseline apps boot successfully
- [x] Verify backend local setup/install/run steps.
- [x] Verify frontend local setup/install/run steps.
- [x] Add environment variable templates and required keys.
- [x] Update READMEs with validated setup instructions.

### [x] US-1.3 CI quality gate baseline
- [x] Add CI workflow for lint + typecheck + test.
- [x] Ensure CI uses workspace-aware caching.
- [x] Fail CI on broken checks.
- [x] Document expected CI status checks.

### [x] US-1.4 Backend testing scaffold (pytest)
- [x] Add pytest and async testing dependencies/config for backend.
- [x] Add backend test scripts wired into monorepo tasks.
- [x] Add initial backend tests for existing API behavior.
- [x] Ensure backend tests pass locally and in CI.

### [ ] US-1.5 Frontend testing scaffold (Vitest/RTL + Playwright)
- [ ] Add Vitest + React Testing Library setup and config.
- [ ] Add Playwright setup and baseline e2e config.
- [ ] Add initial unit/integration tests for current frontend behavior.
- [ ] Add initial e2e smoke tests for current app flows.
- [ ] Ensure frontend tests pass locally and in CI.

---

## EPIC-2-AUTH-AND-USER-MODEL

### [ ] US-2.1 BetterAuth + JWT integration
- [ ] Integrate BetterAuth with JWT issuance/verification.
- [ ] Add auth middleware/guards on backend endpoints.
- [ ] Add frontend auth flows (sign-in/sign-out/session state).
- [ ] Add auth integration tests.

### [ ] US-2.2 User entity and role model
- [ ] Define SQLAlchemy models for users and roles.
- [ ] Add migrations for user/role tables.
- [ ] Enforce role checks for admin-only operations.
- [ ] Add tests for role-based access behavior.

### [ ] US-2.3 Protected route and API behavior
- [ ] Standardize 401/403 API responses.
- [ ] Protect frontend routes requiring auth.
- [ ] Add API client handling for auth failures.
- [ ] Document auth error contract.

---

## EPIC-3-PROFILES-AND-AGENTS

### [ ] US-3.1 Profile CRUD with default invariant
- [ ] Define profile schema and relationships.
- [ ] Implement profile CRUD APIs.
- [ ] Enforce at least one profile per user.
- [ ] Enforce exactly one default profile per user.
- [ ] Add tests for invariant enforcement.

### [ ] US-3.2 USER.md support per profile
- [ ] Add storage strategy for profile `USER.md` content.
- [ ] Implement APIs to read/update `USER.md`.
- [ ] Include `USER.md` in runtime context assembly.
- [ ] Add tests for persistence and retrieval.

### [ ] US-3.3 Agent CRUD with capability assignment
- [ ] Define agent schema (prompt + allowed skills/tools/MCP).
- [ ] Implement agent CRUD APIs.
- [ ] Enforce at least one agent per user.
- [ ] Enforce exactly one default agent per user.
- [ ] Add tests for assignment and invariants.

---

## EPIC-4-CAPABILITY-REGISTRY

### [ ] US-4.1 Skills registry
- [ ] Implement skill data model and CRUD APIs.
- [ ] Add enable/disable state for skills.
- [ ] Add admin-only authorization checks.
- [ ] Add tests for skills lifecycle.

### [ ] US-4.2 Tools registry
- [ ] Implement tool data model and CRUD APIs.
- [ ] Add validation for tool schemas/metadata.
- [ ] Add enable/disable state for tools.
- [ ] Add tests for tool registration and updates.

### [ ] US-4.3 MCP servers and image provider management
- [ ] Implement MCP server configuration CRUD.
- [ ] Implement image provider configuration CRUD.
- [ ] Store provider secrets securely via environment/secret strategy.
- [ ] Add tests for admin management workflows.

---

## EPIC-5-AGENT-RUNTIME-AND-LOOPS

### [ ] US-5.1 Agent runtime context assembly
- [ ] Build context pipeline for system prompt + USER.md + conversation state.
- [ ] Resolve allowed capabilities for selected agent.
- [ ] Add structured execution metadata.
- [ ] Add runtime unit tests.

### [ ] US-5.2 Agentic loop execution controls
- [ ] Add max-iteration and termination condition controls.
- [ ] Add timeout/error handling behavior.
- [ ] Persist loop trace data.
- [ ] Add tests for normal and failure loops.

### [ ] US-5.3 Tool and MCP invocation pipeline
- [ ] Implement standardized tool invocation interface.
- [ ] Implement MCP invocation adapter and policy checks.
- [ ] Log invocation inputs/outputs/errors.
- [ ] Add tests for invocation and policy restrictions.

---

## EPIC-6-MEMORY-SYSTEM

### [ ] US-6.1 Short-term memory
- [ ] Define short-term memory model keyed by user/profile/agent/session.
- [ ] Implement read/write APIs for active session memory.
- [ ] Integrate short-term memory into runtime context.
- [ ] Add tests for scoped memory retrieval.

### [ ] US-6.2 Long-term memory with vector retrieval
- [ ] Implement vector memory interface (default LanceDB).
- [ ] Add ingestion, embedding, and retrieval pipeline.
- [ ] Namespace long-term memory by profile.
- [ ] Add relevance/ranking tests.

### [ ] US-6.3 Pluggable memory backends
- [ ] Create vector store adapter interface.
- [ ] Create relational store adapter boundaries where needed.
- [ ] Add contract tests for current adapter implementations.
- [ ] Document swap strategy for alternative providers.

---

## EPIC-7-CHAT-AND-UX

### [ ] US-7.1 Chat UI with streaming responses
- [ ] Implement chat layout and message threading.
- [ ] Integrate Vercel AI SDK streaming.
- [ ] Render tool/image outputs in the conversation.
- [ ] Add frontend tests for chat behavior.

### [ ] US-7.2 Profile and agent switching UX
- [ ] Build profile selector UX.
- [ ] Build agent selector UX.
- [ ] Surface current default profile/agent clearly.
- [ ] Add tests for selection and persistence behavior.

### [ ] US-7.3 Admin capability management UX
- [ ] Build admin pages/forms for capability CRUD.
- [ ] Add form validation and error states.
- [ ] Restrict pages to admin role.
- [ ] Add tests for admin workflows.

---

## EPIC-8-OBSERVABILITY-HARDENING

### [ ] US-8.1 Structured logging and tracing
- [ ] Define log schema for requests, agent runs, and capability calls.
- [ ] Add correlation IDs across frontend/backend flows.
- [ ] Capture and expose key runtime metrics.
- [ ] Add smoke tests for telemetry paths.

### [ ] US-8.2 Safety and policy guardrails
- [ ] Add policy checks before tool/MCP execution.
- [ ] Add prompt-injection and unsafe-action mitigations.
- [ ] Add configurable deny/allow rules.
- [ ] Add tests for blocked and permitted actions.

### [ ] US-8.3 Performance and reliability improvements
- [ ] Profile critical chat and retrieval paths.
- [ ] Optimize hot paths and query/index usage.
- [ ] Add retry/backoff strategy where appropriate.
- [ ] Add load/smoke test baseline and report.
