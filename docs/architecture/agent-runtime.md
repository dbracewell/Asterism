# Agent Runtime & Execution Loop

The **Agent Runtime** is the core cognitive engine of Asterism. It executes a bounded, multi-turn reasoning and acting loop that orchestrates LLM calls, parses tool invocations, dynamically builds system prompts, and handles real-time event streaming.

---

## Agent Architecture & Lifecycle

The [`Agent`](../apps/backend/asterism/domains/agent/agent.py) class encapsulates a single agent session turn. Each agent maintains a `call_stack: list[uuid.UUID]` representing the lineage of agents from the root conversation turn down to the active agent, preventing recursion cycles during delegation.

A chat is bound to one **main agent** (`sub_agent=False`) when it is created. The
caller may choose a main agent or omit it to use the user's default main agent;
the service rejects sub-agents and chats without a valid default. The persisted
binding supplies the profile, model, prompt, parameters, and offered tool schemas
for every later turn. It is not changed when the user's global default changes.
Sub-agent profiles are delegation targets, not chat entry points.

```mermaid
stateDiagram-v2
    [*] --> Initialize: Create Agent(profile, user, session)
    Initialize --> BuildPrompt: Check system prompt
    BuildPrompt --> CallLLM: Stream chat(messages, tools)

    state CallLLM {
        [*] --> StreamingDeltas: Receive TEXT_DELTA / THINKING_DELTA
        StreamingDeltas --> AccumulateToolCalls: Parse ChoiceDeltaToolCall
        AccumulateToolCalls --> CompleteEvent: LLMEventType.COMPLETE
    }

    CallLLM --> CheckToolCalls: Evaluate response

    state CheckToolCalls <<choice>>
    CheckToolCalls --> AuthorizeTools: tool_calls present
    CheckToolCalls --> CheckFinish: no tool_calls

    state AuthorizeTools {
        [*] --> PolicyAuthorize: approval_policy.authorize()
        PolicyAuthorize --> RunTools: _run_tools(auths)
        RunTools --> [*]
    }

    AuthorizeTools --> AppendHistory: Append tool results to message list
    AppendHistory --> CheckSteps: Evaluate step < max_steps

    state CheckFinish <<choice>>
    CheckFinish --> [*]: finish_reason == "stop"
    CheckFinish --> CheckSteps: finish_reason != "stop"

    state CheckSteps <<choice>>
    CheckSteps --> CallLLM: steps remaining
    CheckSteps --> [*]: max_steps exceeded
```

---

## Key Components

### 1. Dynamic System Prompt Construction

Agents dynamically adapt their instructions based on available capabilities:

- **Base Persona**: Loaded from [`AgentProfile.system_prompt`](../apps/backend/asterism/domains/agent/schemas.py).
- **Sub-Agent Catalog Injection**: If `sub_agent` is in the profile's configured tools, the agent queries [`get_user_agents()`](../apps/backend/asterism/domains/agent/service.py). It gathers all profiles marked with `sub_agent=True` (excluding itself) and appends their IDs, names, and descriptions to the system prompt so the LLM knows what delegation targets exist:
  ```python
  Sub Agents:
  - id: 3fa85f64-... (name: Research Agent) - Researches external web sources
  - id: 8cb123e4-... (name: Data Analyst) - Analyzes CSV and SQL datasets
  ```

### 2. Multi-Step Loop & Step Bounding

To avoid runaway loops and infinite token spend:

- Bounded by `profile.max_steps` (default 5).
- On the final step (`step + 1 >= max_steps`), `tools` are intentionally stripped from the LLM prompt. This forces the model to synthesize a final textual response rather than queuing another round of tool calls.
- Loop terminates immediately when `event.finish_reason == "stop"`.

### 3. LLM Client & Streaming Abstraction

The [`LLMClient`](../apps/backend/asterism/domains/llm/client.py) abstracts OpenAI-compatible endpoints:

- **Thinking / Reasoning**: Intercepts `thinking_delta` chunks for reasoning models (e.g., DeepSeek R1, Claude thinking, o-series) and streams them alongside standard text deltas.
- **Tool Call Chunk Accumulator**: In streaming mode, tool arguments arrive in fragmented deltas (`ChoiceDeltaToolCall`). `StreamHandler` accumulates fragments by index until complete, ensuring valid JSON strings before yielding `LLMEventType.COMPLETE`.
- **Textual Tool-Call Compatibility**: Some nominally OpenAI-compatible providers emit `<tool_call>{"tool_name": ..., "arguments": ...}</tool_call>` as assistant text instead of native `delta.tool_calls`. When no native calls are present, `StreamHandler` converts valid tagged JSON blocks into normal `ToolCall` objects, removes the protocol markup from final content, and changes the finish reason to `tool_calls`. Converted calls still pass through the normal approval policy, so hallucinated or unauthorized tool names are rejected rather than executed.
- **Automatic Retries**: Decorates API invocations with exponential backoff for rate limits and transient connection errors ([`retry_async_gen`](../apps/backend/asterism/common/retries.py)).

### 4. Sub-Agent Delegation & Recursion Boundaries

When an agent invokes the [`sub_agent`](../apps/backend/asterism/domains/tools/builtin/sub_agent.py) tool:

- **Recursion Safety**: The target agent ID is checked against `ctx.call_stack`. If an ID is already in the chain, execution aborts with a recursion cycle error.
- **Depth Limits**: The depth of the delegation chain is bounded by `config.max_sub_agent_depth` (default: 3). If exceeded, execution aborts with an actionable error.
- **Lineage Tracking**: The child agent is initialized with `call_stack=[*ctx.call_stack, target_id]` so further nested delegations are tracked accurately.
- **Event Streaming**: Sub-agent execution events (`START`, `DELTA` including thinking, `TOOL_CALL`, `COMPLETE`, and `ERROR`) are wrapped in [`SubAgentEventEnvelope`](../apps/backend/asterism/domains/agent/schemas.py) and forwarded through `ctx.event_sink`. Every invocation has a stable `execution_id`, in addition to agent identity and depth, so concurrent or repeated calls remain distinct. The parent `Agent.run()` stream yields them as `SUB_AGENT` events in real time, and the chat renders a separate delegated-activity panel without replacing the parent answer.
- **Trace Persistence**: Upon completion, the sub-agent's step count, cumulative tokens, elapsed wall-clock time, and full message exchange are persisted to `sub_agent_traces`.
- See [Sub-Agent Recursion Safety & Bounded Execution](tool-authorization.md#sub-agent-recursion-safety--bounded-execution) for authorization details.

### Sub-Agent Delegation Lifecycle

```mermaid
sequenceDiagram
    autonumber
    actor User as User / Browser
    participant Orch as ChatOrchestrator
    participant Parent as Parent Agent
    participant Tool as sub_agent Tool
    participant Child as Child Sub-Agent
    participant DB as SQLite (sub_agent_traces)

    User->>Orch: User Message
    Orch->>Parent: run(messages)
    Parent->>Parent: LLM emits tool_call: sub_agent(...)
    Parent->>Tool: invoke_tool(ctx)
    Tool->>Tool: 1. Cycle detection (target in call_stack?)
    Tool->>Tool: 2. Depth check (len(call_stack) <= max_depth?)
    Tool->>Tool: 3. Load active tools assigned to child profile
    Tool->>Tool: 4. Build context window (last N msgs, files, caller notes)
    Tool->>Child: Agent(profile, AllowlistApprovalPolicy, call_stack, user_files)
    Tool->>Child: run([system(context), user(prompt)])

    loop Child Execution Loop
        Child-->>Tool: AgentEvent (DELTA / TOOL_CALL)
        Tool-->>Parent: ctx.event_sink(SubAgentEventEnvelope)
        Parent-->>Orch: yield AgentEvent(SUB_AGENT)
        Orch-->>User: WebSocket Packet (type: "sub_agent")
    end

    Child-->>Tool: AgentEvent (COMPLETE)
    Tool->>DB: create_sub_agent_trace(messages, metrics, tokens, elapsed_ms)
    Tool-->>Parent: return sub_agent result content
    Parent->>Parent: LLM synthesizes final answer incorporating sub-agent result
    Parent-->>Orch: yield AgentEvent(COMPLETE)
    Orch->>DB: persist assistant Message
    Orch-->>User: WebSocket Packet (type: "complete")
```

---

## Event Stream Model

The runtime yields strongly-typed [`AgentEvent`](../apps/backend/asterism/domains/agent/schemas.py) objects:

```mermaid
flowchart TD
    LLMEvent["LLMEvent (from OpenAI SDK)"]
    AgentEvent["AgentEvent (from Agent.run)"]
    WSPacket["WebSocket Packet (to Frontend)"]

    LLMEvent -->|Maps START| AgentEvent
    LLMEvent -->|Maps TEXT_DELTA / THINKING_DELTA| AgentEvent
    LLMEvent -->|Maps COMPLETE| AgentEvent
    LLMEvent -->|Maps ERROR| AgentEvent
    SubAgentEvent["Child Sub-Agent Event"] -->|Maps SUB_AGENT| AgentEvent

    AgentEvent -->|Queue.put| WSPacket
```

| `AgentEventType` | Content / Fields                                          | Meaning                                                                       |
| ---------------- | --------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `START`          | None                                                      | Agent execution turn has started                                              |
| `DELTA`          | `content: str`, `thinking: str`                           | Incremental streaming text or reasoning tokens                                |
| `TOOL_CALL`      | `tool_calls: list[ToolCall]`                              | Agent has emitted intent to call one or more tools                            |
| `COMPLETE`       | `content: str`, `tool_results: list`, `total_tokens: int` | Turn finished; assistant message persisted                                    |
| `ERROR`          | `content: str`                                            | Execution failure or fatal exception                                          |
| `SUB_AGENT`      | `sub_agent: SubAgentEventEnvelope`                        | Correlated delegated lifecycle, thinking, text, tools, completion, and errors |

---

## Tool Execution in the Runtime

When tool calls are authorized by [`ToolApprovalPolicy`](tool-authorization.md):

1. **Parallel Invocation**: Approved tools are dispatched concurrently via `asyncio.gather()`:
   ```python
   tasks = [
       tool_registry.invoke_tool(
           tool_call=auth.tool,
           user=self.user,
           session=self.session,
           client=await self._get_client(),
           user_message=user_message or "",
           call_stack=self.call_stack,
       )
       for auth in auths if auth.accept
   ]
   ```
2. **Standardized Context**: Tools receive [`ToolContext`](../apps/backend/asterism/domains/tools/registry.py) containing validated Pydantic arguments, authenticated user identity, active chat session, database access, app settings, and lineage `call_stack`.
3. **Synthetic Rejection Results**: Any tool rejected by policy produces an error result informing the model the user denied access, prompting it to continue without that tool.

---

## Sub-Agent Context Forwarding & Windowing

When an agent delegates a task via the `sub_agent` tool:

1. **Context Window Extraction**: The parent conversation history from `ctx.session.messages` is bounded using configurable limits:
   - `config.sub_agent_context_window_messages` (default: `10`): Maximum number of recent messages to include.
   - `config.sub_agent_context_window_tokens` (default: `4000`): Maximum accumulated tokens to forward, preventing context overflow.
2. **File and Caller Propagation**:
   - `ctx.user_files`: List of uploaded user files is forwarded into the context block and passed into the child `Agent(user_files=...)`, ensuring tools executed by the sub-agent have access to `tool_ctx.user_files`.
   - `args.parent_context`: Optional caller-specified notes or summaries are included under `### Caller Notes`.
3. **Structured System-Level Delineation**:
   The sub-agent's message list is constructed with clear separation:
   - **Index 0**: Sub-agent's own system prompt (`_build_system_prompt()`), establishing persona and allowed capabilities.
   - **Index 1**: System context message (`--- FORWARDED PARENT CONTEXT ---`) containing recent conversation history, available user files, and caller notes.
   - **Index 2**: User message containing the delegated task prompt.

---

## Sub-Agent Execution Trace Persistence

To provide comprehensive auditability and debugging for delegated agent workflows, Asterism records every sub-agent execution:

1. **Storage Schema**: Traces are stored in the `sub_agent_traces` table ([`SubAgentTraceModel`](../apps/backend/asterism/domains/agent/models.py)), indexed by `parent_message_id`, `sub_agent_id`, and `user_id`.
2. **Metrics & Trajectory Recorded**:
   - `parent_message_id`: Foreign key association to the parent chat message triggering delegation.
   - `sub_agent_id` / `sub_agent_name`: Target profile identity.
   - `prompt`: The delegated task instructions.
   - `caller_context`: Optional caller-supplied context or notes.
   - `messages`: Complete serialized JSON message exchange (system prompt, forwarded parent context, user prompt, assistant reasoning, tool calls, and tool result observations).
   - `result`: Final response content.
   - `step_count`: Number of reasoning turns executed.
   - `total_tokens`: Cumulative token usage across all steps.
   - `elapsed_ms`: Wall-clock execution time in milliseconds.
   - `depth`: Call-chain nesting level from root.
3. **Query Interface**: Traces are queryable programmatically via [`get_sub_agent_traces_by_parent_message()`](../apps/backend/asterism/domains/agent/service.py) and via REST API endpoint `GET /agents/traces/{parent_message_id}`. Results are scoped to the authenticated user.
4. **Runtime Diagnostics**: Python console logs record `requested`, `authorized`, `started`, per-event debug metadata, `finished`, and trace-persistence outcomes. Logs correlate on `execution_id`, agent/chat/parent-message identifiers, depth, duration, counts, and status; raw prompts and generated content are intentionally excluded.

Frontend WebSocket-contract E2E coverage uses the test-only `/e2e/sub-agent` harness (unavailable outside the `test` configuration profile) to verify successful progress/final-parent rendering and delegated timeout rendering. Backend integration coverage exercises the parent tool call, child event forwarding, child result return, and parent synthesis with deterministic LLM doubles; live external-provider behavior remains dependent on configured provider availability and credentials.

---

## Related Documentation

- [Tool Authorization & Approval](tool-authorization.md)
- [Chat & Real-Time WebSocket](chat-and-websocket.md)
- [System Overview](overview.md)

## Chat model selection and recorded executions

US-29.2 supplies a chat's selected model separately from its singleton main-agent
configuration. An explicit model/revision change is guarded against active jobs.
Before generation, the chat execution service captures model/provider/capabilities
and the main configuration/revision. Streaming, vision assembly, estimates and
persisted assistant messages use that identity. Resume reuses a pending execution;
regeneration explicitly starts one from the current chat selection. Unavailable or
changed models and revoked capabilities reject replay, without selecting another
model. Historical snapshots survive catalog edits/deletion. Delegated agents retain
their own fixed models. See ADR-0017 and the backend README for API and isolation
boundaries; file authorization is always revalidated from current memberships.

## Project-selected delegation (US-29.3)

A project starts with no selected sub-agents. `GET /projects/{project_id}/sub-agents`
returns a paginated selection with fixed model availability and the project context
revision. `POST` selects and `DELETE` deselects an atomic batch of `agent_ids`, with
`expected_context_revision`. Duplicate IDs are deduplicated; a stale revision or any
foreign, missing, or main-agent ID rejects the whole batch. Actual changes advance
the revision once; no-ops retain it. Composite foreign keys enforce owner and role
consistency even for direct database writes.

The agent receives an immutable delegation ceiling from the chat/project boundary.
Only selected, available definitions are described in its prompt. A model-supplied
ID must belong to that ceiling and the current project's selection. General chats
have no ceiling and cannot delegate, including direct tool invocations. Each child
inherits the ceiling, chat, file references, cycle stack and depth limit; it retains
its own fixed model and explicit tool capabilities. Selection does not add file access.

Invocation and child execution recheck the live chat project, context revision,
selected target, definition revision and model availability. The streaming guard
checks before forwarding output and polls an in-flight silent child every 100 ms;
revocation cancels the child and its pending tool tasks. Project context changes
invalidate existing delegation, including prompt/file changes, so a new turn must
resolve a fresh ceiling. Definition deletion advances all affected project revisions
in the deletion transaction and cascades memberships. Project deletion also cascades
selections and detaches chats. Already delivered output or completed external tool
side effects cannot be undone.

Project membership storage, live chat authorization and the runtime ceiling are
separate modules. Automatic internal-tool enablement is implemented by US-29.4; selection UI
remains US-27.5. Execution/file scope and shared retrieval are implemented by US-26.1/26.3.
Fresh schema initialization is required; this story adds no migrations and does not
reset the working database.

## Context-managed tools (US-29.4)

`sub_agent` and `search_knowledge` carry `context_managed` policy metadata. User tool
lists omit them, and main/sub-agent settings reject assignments of these names.
The full tool list is admin-only and retains their global switches and metadata.
Fresh initialization enables the internal tools in admin policy, independently of
the ordinary user capability defaults.

The chat tool-policy boundary composes current admin settings, the caller's
configuration, explicit model tool support, active chat/project file memberships,
and the project-selected delegation ceiling. It returns the effective tools and a
server-only immutable context. Agent runtime consumes that boundary for prompts,
estimates and provider schemas. Internal tools are automatically authorized only
when effective; ordinary tools still require their explicit assignments and the
existing runtime approval policy. Availability does not compel invocation.

General chats never delegate. Projects with no available selected targets do not
offer delegation. Retrieval is offered when the turn's file ceiling intersects
current project files or active-branch local attachments, including General chat
attachments. Unselected library, sibling-chat and inactive-branch files confer no
retrieval access. Agent knowledge-base assignment contracts and storage are removed.
Children inherit the parent file and target ceilings, retain their fixed models,
and cannot resolve a wider scope. A later turn resolves a new ceiling.

Registry invocation requires an injected server authorization callback for internal
tools; the tools also recheck live policy themselves. No registry dependency points
back to the chat policy implementation. Delegation rechecks parent policy during
its existing cancellation guard. Retrieval filters authorized ready current
artifacts before querying vectors and rechecks after embedding and vector search;
revoked files and stale generations are discarded. Pending, failed, canceled and
unavailable artifacts have explicit states. Embedding/vector outages return an
unavailable result. Result limits, byte bounds, captions, source provenance and file
citations remain part of the response. No tool reads widen the inherited scope.

Models expose nullable `supports_tools` and `tools_source`; unknown support fails
closed. Admins can set tool support in the existing model catalog UI. Explicit
provider metadata is accepted, manual overrides survive refresh, and chat execution
snapshots retain actual tool support for replay validation. No capability is guessed
from model names. Provider payloads omit tools when the effective set is empty.
Injected retrieval, prompt composition and execution scope are implemented by
US-26.1/26.2/26.3; memory isolation remains US-26.4. This story requires fresh schema initialization, without
migrations or resetting the working database.

## Composable prompts (US-26.2)

`domains/agent/prompts.py` owns the typed, ordered layers and explicit conflict
policy. Platform restrictions are mandatory; agent role and explicit profile
constraints remain authoritative; project instructions refine the task; user
turns supply the request. Conflicts resolve in that priority order; runtime metadata
cannot override instruction layers. Authorization is enforced by tool/file services rather
than inferred from layer order. File text, retrieved passages, and forwarded
conversation history remain task data in user/tool messages.

The chat composition root injects project/chat readers and effective capability
policy. Main calls, delegated calls, token estimates, and replay use the same
`PromptComposer`. General chats omit the project layer, and an empty project
prompt contributes provenance without an instruction block. Runtime capability
and delegation descriptions are capped at 8,000 characters. Forwarded delegation
context has a total token budget including caller notes, file labels, role labels,
and its wrapper; oversized first messages cannot bypass it.

Turn preparation atomically persists a private prompt snapshot alongside the
model/configuration execution snapshot. Pending-turn estimates and resumed turns
read that snapshot. Project or main-agent edits affect later turns and explicit
regeneration; chat model switching does not rewrite an earlier turn's prompt.
Delegates inherit the parent turn's project instructions and revision with their
own agent role and narrowed capabilities. Live revocation still takes precedence:
a prompt snapshot never grants continued access after cancellation or revocation.
Project moves reject reuse of a prompt captured for a different project.

Public execution provenance identifies composer version and each source's kind,
ID, revision, and SHA-256 digest. Private composed system messages are excluded
from sub-agent trace history; traces retain task messages and prompt provenance.
Private replay inputs are stored on the requesting message and are not included
in chat/API schemas or full-prompt logs. The runtime has no profile-persona binding
yet: the composer supports an explicit profile layer, but callers do not invent
one. No memory integration or retrieval rewrite is introduced by this story.

The direct schema changes add `messages.pending_prompt` and
`sub_agent_traces.prompt_provenance`. Existing development databases require the
normal disposable-data reset before running this schema. Story verification uses
fresh isolated databases and leaves the current development database intact.

## Shared retrieval and file reads (US-26.3)

Main and delegated tool contexts receive an injected `RetrievalService` and
`RuntimeFileReader`. The tool adapter has no storage queries, and the retrieval
service has no chat/project table dependencies. Chat-owned composition roots wire
live policy/scope readers to extraction queries, embedding/vector interfaces, and
FileStore. File processing is an injected callable, preserving module boundaries.

The execution scope carries the requesting message and execution IDs through
delegation. Live readers reject canceled/replaced turns, inactive branches,
project changes, unavailable models, and revoked delegates. Every vector query is
prefiltered by owner and allowed ready files; generation and ownership checks run
again before release. Inline attachment assembly and provider calls use the same
live file authorization boundary. Original images are routed only to vision-capable
models, with bounded source-byte reads. See [knowledge retrieval](knowledge-retrieval.md).

Agent knowledge-base assignment storage, endpoints, response fields, and editing
controls are removed; agents derive contextual retrieval through internal-tool
policy. Standalone knowledge-base management remains for the later clean-cut
removal story. The schema change requires fresh initialization; the current database
is retained during story verification.

## Context provenance and memory isolation (US-26.4)

See [context isolation](context-isolation.md) for execution/retrieval provenance,
content-free delegated traces, recorded resume ceilings, the reuse-path audit,
and typed future memory/derived-context boundaries. No long-term memory engine
or automatic project-wide conversational memory is integrated.
