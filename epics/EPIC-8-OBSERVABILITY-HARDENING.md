# EPIC-8-OBSERVABILITY-HARDENING

## Goal
Improve safety, observability, and operational reliability before wider rollout.

## User Stories

### US-8.1 Structured logging and tracing
**As an operator**, I want structured logs and traces so I can diagnose issues quickly.

#### Tasks
- [ ] Define log schema for requests, agent runs, and capability calls.
- [ ] Add correlation IDs across frontend/backend flows.
- [ ] Capture and expose key runtime metrics.
- [ ] Add smoke tests for telemetry paths.

### US-8.2 Safety and policy guardrails
**As an admin**, I want policy guardrails so unsafe operations are reduced.

#### Tasks
- [ ] Add policy checks before tool/MCP execution.
- [ ] Add prompt-injection and unsafe-action mitigations.
- [ ] Add configurable deny/allow rules.
- [ ] Add tests for blocked and permitted actions.

### US-8.3 Performance and reliability improvements
**As a user**, I want stable and fast responses so the app is dependable.

#### Tasks
- [ ] Profile critical chat and retrieval paths.
- [ ] Optimize hot paths and query/index usage.
- [ ] Add retry/backoff strategy where appropriate.
- [ ] Add load/smoke test baseline and report.
