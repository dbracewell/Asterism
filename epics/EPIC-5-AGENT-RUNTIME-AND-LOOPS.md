# EPIC-5-AGENT-RUNTIME-AND-LOOPS

## Goal
Build the multi-agent execution runtime with controlled agentic loops and tool/MCP invocation.

## User Stories

### US-5.1 Agent runtime context assembly
**As the system**, I want to assemble prompts and runtime context from user/profile/agent settings so executions are consistent.

#### Tasks
- [ ] Build context pipeline for system prompt + USER.md + conversation state.
- [ ] Resolve allowed capabilities for selected agent.
- [ ] Add structured execution metadata.
- [ ] Add runtime unit tests.

### US-5.2 Agentic loop execution controls
**As an admin**, I want bounded loop controls so the system is safe and predictable.

#### Tasks
- [ ] Add max-iteration and termination condition controls.
- [ ] Add timeout/error handling behavior.
- [ ] Persist loop trace data.
- [ ] Add tests for normal and failure loops.

### US-5.3 Tool and MCP invocation pipeline
**As the system**, I want safe and observable capability invocation so actions are auditable.

#### Tasks
- [ ] Implement standardized tool invocation interface.
- [ ] Implement MCP invocation adapter and policy checks.
- [ ] Log invocation inputs/outputs/errors.
- [ ] Add tests for invocation and policy restrictions.
