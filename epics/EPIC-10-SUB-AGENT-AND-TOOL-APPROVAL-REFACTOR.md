# EPIC-10 — Sub-Agent Upgrade and Tool Approval Refactor

## Status

**Proposed / planning only.** No stories or implementation have started.

## Goal

Refactor tool-use authorization into a pluggable approval strategy so that
interactive chat agents and non-interactive sub-agents share a single, auditable
code path. Then upgrade the sub-agent tool with streaming event forwarding,
context sharing, recursion safety, and observability — turning it from a
black-box fire-and-forget call into a first-class orchestration primitive.

## Current findings (code inspection)

### Tool approval is fragmented and tightly coupled

| Component | Current behavior / problem |
|---|---|
| `Agent.run()` | Always creates a `UserResponseQueue`, yields a `TOOL_CALL` event, and blocks on `response_queue.wait()` — regardless of whether anyone is listening. |
| `UserResponseQueue` | Mixes concerns: auto-approval of permitted tools (side effects in a `@property`), external response collection, and async coordination. `pending` is called repeatedly in `wait()`, re-triggering side effects each time. |
| `ChatOrchestrator` | Drives interactive approval: emits WebSocket `tool_permission_request` messages, creates `asyncio.Future` per tool, awaits user decisions with a 60s timeout. This logic is not reusable outside the orchestrator. |
| `sub_agent` tool | Manually iterates `queue.pending` and calls `respond(tool, True)` for every tool — an auto-approve hack that bypasses the agent profile's configured `allowed_tools` entirely. |

### Sub-agent is a black box

| Area | Current behavior / problem |
|---|---|
| Streaming | All `DELTA`, `THINKING`, and `TOOL_CALL` events are swallowed. The UI appears frozen during sub-agent execution. |
| Context | Sub-agent receives only `[LLMMessage.user(prompt)]`. No parent conversation history, user files, or profile memory. |
| Recursion | Agent A can call sub-agent B which calls sub-agent A. No depth limit or cycle detection. |
| Persistence | Sub-agent messages (system prompt, reasoning, tool calls) are never written to the database. Only the final summary string is persisted as a `ToolResult`. |
| Security | Auto-approve ignores the agent profile's `allowed_tools` and the session's `allowed_tools`. A sub-agent can execute any registered tool. |

### Stubbed features

- `ChatOrchestrator.save_always_allow_preference()` is a no-op `pass`.
  The frontend sends `always_allow: true` on tool approval, but it is never
  persisted. This is relevant because a working "always allow" would reduce
  friction for both interactive and delegated tool use.

## Proposed architecture: ToolApprovalPolicy

Replace the implicit yield-and-wait pattern with an injectable policy:

```
Protocol: ToolApprovalPolicy
  async def authorize(tools: list[ToolCall], permissions: list[str]) -> list[ToolUseAuthorization]
```

Implementations:

| Policy | Behavior | Used by |
|---|---|---|
| `AllowlistApprovalPolicy` | Auto-approve tools in the allowlist, reject others. Synchronous, no external coordination. | Sub-agents, background agents, API-invoked agents |
| `InteractiveApprovalPolicy` | Auto-approve permitted tools; for others, yield events to a callback/queue and await external decisions with timeout. | `ChatOrchestrator` (interactive chat) |

`Agent.__init__` accepts an optional `approval_policy: ToolApprovalPolicy`.
If not provided, it defaults to `AllowlistApprovalPolicy(self.allowed_tools)`.
`Agent.run()` calls `policy.authorize(...)` instead of creating a
`UserResponseQueue` and yielding a blocking event.

This removes the coupling between `Agent` and the orchestrator's WebSocket
approval flow, eliminates the auto-approve hack in `sub_agent`, and makes
approval behavior explicit and testable.

## Scope / non-goals

**In scope:**
- Tool approval refactor (policy abstraction, implementations, migration)
- Sub-agent event streaming / forwarding to parent
- Sub-agent context forwarding (conversation history, user files)
- Recursion depth limit and cycle detection
- Sub-agent execution tracing and persistence
- Respecting agent profile tool restrictions in sub-agents
- Tests for all new behavior

**Not in scope:**
- Implementing `save_always_allow_preference` (separate story)
- Multi-agent collaboration beyond parent→child delegation
- Memory system integration (EPIC-6)
- Frontend changes to sub-agent UX beyond receiving forwarded events
- MCP server delegation to sub-agents

## User stories

### US-10.1 — Extract tool approval into a pluggable policy

**As a developer**, I want tool-use authorization to be an injectable strategy
so that agents can be used in interactive, automated, and delegated contexts
without coupling to a specific approval mechanism.

**Dependencies:** None.

- [ ] US-10.1-T1: Define `ToolApprovalPolicy` protocol with `async def authorize(tools: list[ToolCall], permissions: list[str]) -> list[ToolUseAuthorization]`.
- [ ] US-10.1-T2: Implement `AllowlistApprovalPolicy` — auto-approve tools whose name is in the allowlist, reject all others. No async coordination needed.
- [ ] US-10.1-T3: Implement `InteractiveApprovalPolicy` — encapsulates the current `UserResponseQueue` + callback pattern. Accepts an `on_pending` callback for the orchestrator to hook into. Returns authorizations once all tools are resolved or timed out.
- [ ] US-10.1-T4: Refactor `Agent.__init__` to accept an optional `approval_policy` parameter. Default to `AllowlistApprovalPolicy(self.allowed_tools)` when not provided.
- [ ] US-10.1-T5: Refactor `Agent.run()` to call `self.approval_policy.authorize(...)` instead of creating a `UserResponseQueue` and yielding a blocking `TOOL_CALL` event. The `TOOL_CALL` event should still be yielded for observability, but it must not block execution — authorization is handled by the policy.
- [ ] US-10.1-T6: Migrate `ChatOrchestrator` to construct `Agent` with `InteractiveApprovalPolicy`, passing its WebSocket approval callback. Remove the `TOOL_CALL` event interception and `_wait_for_ui_approval` workaround from the orchestrator's event loop.
- [ ] US-10.1-T7: Simplify or remove `UserResponseQueue` if fully replaced by the policy implementations. If retained as an internal detail of `InteractiveApprovalPolicy`, move it there.
- [ ] US-10.1-T8: Add unit tests for `AllowlistApprovalPolicy` (approved, rejected, mixed, empty), `InteractiveApprovalPolicy` (approved, rejected, timeout, partial), and `Agent.run()` with each policy.

**Acceptance criteria**

- `Agent` no longer directly creates `UserResponseQueue` or yields blocking `TOOL_CALL` events.
- Interactive chat approval works identically to current behavior from the user's perspective.
- Agents created without an explicit policy default to allowlist-based auto-approval.
- All existing tests pass; new policy tests cover the documented scenarios.

---

### US-10.2 — Fix sub-agent tool authorization to respect permissions

**As a user**, I want sub-agents to respect the same tool restrictions as my
primary agent so that delegated work cannot bypass my configured security
boundaries.

**Dependencies:** US-10.1.

- [ ] US-10.2-T1: Construct the sub-agent's `Agent` with `AllowlistApprovalPolicy` using the intersection of the parent agent's `allowed_tools` and the sub-agent profile's `tools`.
- [ ] US-10.2-T2: Remove the manual auto-approve loop (`for pending_tool in queue.pending: respond(...)`) from `sub_agent.py` — the policy now handles this.
- [ ] US-10.2-T3: Add tests verifying that a sub-agent cannot execute tools not in its profile's allowlist, even if the parent agent has access to them.
- [ ] US-10.2-T4: Add tests verifying that a sub-agent cannot execute tools not in the parent's allowlist, even if the sub-agent profile lists them.

**Acceptance criteria**

- Sub-agent tool access is the intersection of parent permissions and sub-agent profile permissions.
- Rejected tool calls produce a clear message to the sub-agent LLM explaining the tool is not authorized.
- No manual approval workarounds remain in `sub_agent.py`.

---

### US-10.3 — Add recursion safety to sub-agent execution

**As a developer**, I want sub-agent calls to be bounded by depth and cycle
detection so that misconfigured agents cannot cause infinite recursion or
runaway token spend.

**Dependencies:** US-10.1.

- [ ] US-10.3-T1: Add a `call_stack: list[uuid.UUID]` parameter to `ToolContext` (or a new `SubAgentContext`) that tracks the chain of agent IDs from root to current.
- [ ] US-10.3-T2: In `sub_agent`, before creating the child agent, check `call_stack` for: (a) the target agent ID already present (cycle), and (b) depth exceeding a configurable maximum (default: 3).
- [ ] US-10.3-T3: On cycle detection, return an error result to the LLM explaining the cycle and listing the agent chain.
- [ ] US-10.3-T4: On depth exceeded, return an error result to the LLM explaining the maximum depth and suggesting the task be decomposed differently.
- [ ] US-10.3-T5: Add unit tests for: no recursion (depth 1), allowed depth (depth 2–3), cycle detection (A→B→A), and depth exceeded.

**Acceptance criteria**

- Agent A calling sub-agent B calling sub-agent A is detected and rejected with a clear error.
- Sub-agent chains deeper than the configured maximum are rejected.
- The call stack is accurately maintained across nested sub-agent invocations.

---

### US-10.4 — Stream sub-agent events to the parent context

**As a user**, I want to see sub-agent activity (thinking, text, tool calls)
in the chat so that delegated work is not a frozen black box.

**Dependencies:** US-10.1, US-10.2.

- [ ] US-10.4-T1: Define a sub-agent event envelope that wraps `AgentEvent` with metadata: `sub_agent_id`, `sub_agent_name`, and `depth`.
- [ ] US-10.4-T2: Add an optional `event_sink: AsyncGenerator | Callable` to the sub-agent tool context that forwards events to the parent's event stream.
- [ ] US-10.4-T3: In `sub_agent`, forward `DELTA`, `THINKING`, `TOOL_CALL`, and `COMPLETE` events through the sink, tagged with the sub-agent envelope.
- [ ] US-10.4-T4: In `ChatOrchestrator`, handle sub-agent envelope events by forwarding them to the WebSocket message queue with the sub-agent metadata, so the frontend can render them distinctly.
- [ ] US-10.4-T5: Add tests verifying that sub-agent events are forwarded with correct metadata and that the parent agent's event stream includes them.

**Acceptance criteria**

- Sub-agent text deltas and tool calls appear in the parent's event stream during execution.
- Events are tagged with sub-agent identity so the frontend can distinguish them.
- The parent agent's final response still includes the sub-agent's result content.

---

### US-10.5 — Forward context to sub-agents

**As an agent developer**, I want sub-agents to receive relevant parent context
so that they can make informed decisions without requiring the caller to manually
paste everything into the prompt.

**Dependencies:** US-10.1.

- [ ] US-10.5-T1: Add an optional `parent_context` parameter to the sub-agent tool args (or inject via `ToolContext`) containing: a summary/window of recent parent conversation messages and user-uploaded file references.
- [ ] US-10.5-T2: When constructing the sub-agent's message list, prepend a system-level context block with the forwarded information, clearly delineated from the sub-agent's own system prompt.
- [ ] US-10.5-T3: Implement a configurable context window (e.g., last N messages or last M tokens) to avoid exceeding the sub-agent's context limit.
- [ ] US-10.5-T4: Forward `user_files` from the parent `ToolContext` to the sub-agent so file-aware tools work correctly.
- [ ] US-10.5-T5: Add tests verifying context forwarding with various window sizes and that user files are accessible to the sub-agent's tools.

**Acceptance criteria**

- Sub-agents receive a bounded window of parent conversation context.
- User-uploaded files are accessible to sub-agent tools.
- Context injection does not exceed configurable limits.

---

### US-10.6 — Persist sub-agent execution traces

**As a developer**, I want sub-agent reasoning, tool calls, and results
persisted to the database so that delegated work is auditable and debuggable.

**Dependencies:** US-10.4.

- [ ] US-10.6-T1: Design a storage schema for sub-agent execution traces, linked to the parent message and the sub-agent profile. Consider: a `sub_agent_traces` table or nested message records under the parent message.
- [ ] US-10.6-T2: After sub-agent completion, persist the full message history (system prompt, user prompt, assistant responses, tool calls/results) to the trace store.
- [ ] US-10.6-T3: Include the sub-agent's token usage, step count, and elapsed time in the trace record.
- [ ] US-10.6-T4: Add a query/retrieval interface for sub-agent traces by parent message ID.
- [ ] US-10.6-T5: Add tests for trace persistence, retrieval, and association with parent messages.

**Acceptance criteria**

- Every sub-agent invocation produces a persisted trace record.
- Traces include the full message exchange, tool calls, results, and usage metrics.
- Traces are queryable by parent message and sub-agent identity.

## Execution plan and definition of done

Recommended sequence: **US-10.1 → US-10.2 → US-10.3 → US-10.4 → US-10.5 → US-10.6**.

US-10.1 is the foundation; all other stories depend on it. US-10.2 and US-10.3
can proceed in parallel after US-10.1. US-10.4 depends on the approval refactor
being stable. US-10.5 and US-10.6 are independent of each other but benefit from
US-10.4's event forwarding.

Create a feature branch when each story starts and update `todo.md` as work
proceeds. For every story: complete tasks, pass relevant lint/typecheck/tests,
document changes, verify auth/permission paths, and request user completion
confirmation before merging its branch into `main`.

The epic is complete only after all stories meet their acceptance criteria and
the user confirms completion. Inform the user and propose the next plan.

## Risks to resolve, not hide

- **Breaking the interactive approval flow.** The orchestrator's WebSocket
  approval is the primary user-facing tool authorization path. The refactor
  must preserve identical behavior from the user's perspective.
- **Event forwarding performance.** Streaming sub-agent events through the
  parent may increase WebSocket message volume. Consider batching or throttling
  if needed.
- **Context window sizing.** Forwarding too much parent context to sub-agents
  can exceed model context limits or waste tokens. The window must be
  configurable and bounded.
- **Recursion depth vs. usefulness.** Too-shallow limits (e.g., depth 1) prevent
  legitimate multi-agent workflows. Too-deep limits risk runaway costs. Default
  of 3 should be validated against real use cases.
- **Trace storage volume.** Sub-agent traces can be large (full message
  histories). Consider retention policies or lazy loading for the trace UI.

