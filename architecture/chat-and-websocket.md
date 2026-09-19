# Chat & Real-Time WebSocket Architecture

Asterism provides real-time, bidirectional streaming chat between the user and AI agents. This document describes the architecture of the WebSocket subsystem, focusing on the decoupling of connection handling, command processing, and event emission.

---

## WebSocket Subsystem Architecture

The real-time streaming layer is structured into three distinct responsibilities:

```mermaid
flowchart TD
    subgraph Frontend["Frontend Client (React)"]
        UI["Chat Session UI"]
        Hook["useChatWebSocket Hook"]
    end

    subgraph Transport["Transport Layer"]
        WSEndpoint["FastAPI Route: /chat/stream/{chat_id}"]
        WSConn["WebSocketConnection (heartbeat, json framing)"]
    end

    subgraph ControllerSubsystem["ChatController (Concurrency Coordinator)"]
        AcceptLoop["_accept_commands_loop (inbound reader)"]
        ProcessLoop["_process_commands_loop (sequential processor)"]
        MsgQueueLoop["_message_queue_processing_loop (outbound sender)"]
        StatusLoop["_status_loop (0.5s ping is_processing)"]
        InboundQueue["Inbound Commands Queue (asyncio.Queue)"]
    end

    subgraph DomainOrchestrator["ChatOrchestrator (Domain State Manager)"]
        OutboundQueue["Chat MessageQueue (per-chat singleton)"]
        MsgTree["Message History & Branching"]
        TitleGen["Background Title Generator (Draft Model)"]
        AgentSession["Agent Instance (InteractiveApprovalPolicy)"]
    end

    UI <--> Hook
    Hook <-->|"WebSocket Traffic"| WSEndpoint
    WSEndpoint --> WSConn
    WSConn <--> AcceptLoop

    AcceptLoop -->|"Normal Commands (chat, regenerate)"| InboundQueue
    AcceptLoop -->|"High Priority Tool Approval"| AgentSession
    InboundQueue --> ProcessLoop
    ProcessLoop --> MsgTree
    ProcessLoop --> AgentSession

    AgentSession --> OutboundQueue
    OutboundQueue --> MsgQueueLoop
    MsgQueueLoop --> WSConn
    StatusLoop --> WSConn
    TitleGen -.->|"Webhook Chat Title Update"| UI
```

---

## The Core Trio

### 1. `WebSocketConnection`

[`WebSocketConnection`](../apps/backend/asterism/domains/chat/connection.py) encapsulates the raw FastAPI `WebSocket` instance.

- **Message Framing**: Serializes and deserializes JSON messages safely.
- **Heartbeat Loop**: Runs a background ping/pong cycle to detect dead or half-open connections early.
- **Clean Disconnects**: Catches `WebSocketDisconnect` and ensures underlying resources close properly without uncaught traceback spam.

### 2. `ChatController`

[`ChatController`](../apps/backend/asterism/domains/chat/controller.py) coordinates concurrency and isolates failure domains:

- **Background Worker Management**: Uses [`BackgroundTaskManager`](../apps/backend/asterism/core/tasks.py) to manage worker coroutines, ensuring clean cancellation on client disconnect.
- **Command Prioritization**:
  - Regular commands (`chat`, `regenerate`) go to `inbound_commands` to execute sequentially.
  - Urgent commands (`tool_approval`) bypass sequential processing and immediately resolve the orchestrator's pending future, preventing deadlocks when the agent is waiting for user consent.
- **Auto-Start Injection**: The message processor automatically tracks event sequences and injects a `START` event if the LLM fails to yield one before deltas.

### 3. `ChatOrchestrator`

[`ChatOrchestrator`](../apps/backend/asterism/domains/chat/orchestrator.py) owns the chat state and coordinates the agent:

- **Tree Branching**: Manages tree relationships (`parent_message_id`, `active_child_id`) for branch navigation and regeneration.
- **Persistence**: Persists new messages, token counts, tool calls, and tool results into the database through [`chat_service`](../apps/backend/asterism/domains/chat/service.py).
- **Background Title Generation**: Uses a fast draft model ([`get_draft_model()`](../apps/backend/asterism/domains/llm/draft.py)) to synthesize short, 3-6 word chat titles in the background without holding up message streaming.
- **Webhook Broadcast**: When titles change, emits a webhook (`chat-session:update`) over the backend event bus to inform the frontend UI immediately.

---

## Concurrency and Worker Loops

When a client connects to `/chat/stream/{chat_id}`, `ChatController.run()` initiates several concurrent coroutines:

| Worker / Loop                        | Interval / Trigger                | Purpose                                                                         |
| ------------------------------------ | --------------------------------- | ------------------------------------------------------------------------------- |
| `connection.heartbeat_loop()`        | Periodic                          | Monitors socket vitality; closes dropped connections                            |
| `orchestrator.generate_chat_title()` | One-off background                | Generates smart title using draft LLM                                           |
| `_status_loop()`                     | Every 0.5s                        | Emits `{"type": "status", "is_processing": bool}` to toggle UI loading spinners |
| `_message_queue_processing_loop()`   | Event-driven (`queue.get()`)      | Flushes outbound events (`DELTA`, `TOOL_CALL`, `COMPLETE`) to the client        |
| `_accept_commands_loop()`            | Event-driven (`socket.receive()`) | Ingests client commands; routes `tool_approval` immediately                     |
| `_process_commands_loop()`           | Queue-driven (`inbound.get()`)    | Executes `handle_new_user_message` or `_regenerate` sequentially                |

---

## Client Protocol Specification

### Client to Server Messages

```typescript
// Sending a new user prompt
{
  "type": "chat",
  "message": "Can you analyze recent sales figures?"
}

// Approving or rejecting a tool call
{
  "type": "tool_approval",
  "tool_id": "call_987xyz",
  "approved": true,
  "always_allow": false
}

// Regenerating from a prior turn
{
  "type": "regenerate",
  "parent_message_id": "8cb123e4-..."
}

// Keepalive ping
{
  "type": "ping"
}
```

### Server to Client Messages

```typescript
// Start of turn
{ "type": "start" }

// Streaming content token
{
  "type": "delta",
  "content": "Sure, let me check...",
  "thinking": "User wants sales analysis; need retrieval tool."
}

// Tool call declaration
{
  "type": "tool_call",
  "tool_calls": [{ "id": "call_987xyz", "function": { "name": "sql_query", "arguments": "..." } }]
}

// Interactive approval request
{
  "type": "tool_permission_request",
  "id": "call_987xyz",
  "name": "sql_query",
  "arguments": "{\"query\": \"SELECT * FROM sales;\"}"
}

// Tool permission prompt cleared
{
  "type": "tool_update",
  "id": "call_987xyz"
}

// Processing status heartbeat
{
  "type": "status",
  "is_processing": true
}

// Delegated sub-agent execution event
{
  "type": "sub_agent",
  "execution_id": "9bda5c59-0235-4b8c-b53e-d8cb0bfbdc2c",
  "sub_agent_id": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
  "sub_agent_name": "Research Agent",
  "depth": 1,
  "event": {
    "type": "delta",
    "content": "Searching online sources...",
    "thinking": "Looking for revenue numbers."
  }
}

// The nested event can be start, delta, tool_call, complete, or error.
// The UI groups packets by execution_id and keeps the child result separate
// from the final parent response.

// Turn complete
{
  "type": "complete",
  "last_messages": [ /* Array of updated serialized Message objects */ ]
}
```

---

## Related Documentation

- [Tool Authorization & Approval](tool-authorization.md)
- [Agent Runtime & Execution Loop](agent-runtime.md)
- [System Overview](README.md)
