# EPIC-6-MEMORY-SYSTEM

## Goal
Implement short-term and long-term memory with retrieval and profile-scoped isolation.

## User Stories

### US-6.1 Short-term memory
**As a user**, I want conversations to maintain immediate context so responses are coherent.

#### Tasks
- [ ] Define short-term memory model keyed by user/profile/agent/session.
- [ ] Implement read/write APIs for active session memory.
- [ ] Integrate short-term memory into runtime context.
- [ ] Add tests for scoped memory retrieval.

### US-6.2 Long-term memory with vector retrieval
**As a user**, I want persistent memory recall so the system can remember important facts over time.

#### Tasks
- [ ] Implement vector memory interface (default LanceDB).
- [ ] Add ingestion, embedding, and retrieval pipeline.
- [ ] Namespace long-term memory by profile.
- [ ] Add relevance/ranking tests.

### US-6.3 Pluggable memory backends
**As a developer**, I want backend abstractions so vector and relational stores can be swapped later.

#### Tasks
- [ ] Create vector store adapter interface.
- [ ] Create relational store adapter boundaries where needed.
- [ ] Add contract tests for current adapter implementations.
- [ ] Document swap strategy for alternative providers.
