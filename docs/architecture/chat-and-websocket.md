# Chat acceptance and real-time transport

New user messages are accepted through authenticated REST. The WebSocket starts or
reconnects persisted work, streams results, accepts tool decisions, and cancels or
regenerates turns. Sending filename-based messages over the socket is unsupported.

## Acceptance and attachment lifecycle

| Operation                                   | Contract                                                                                                                      |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `POST /chat/`                               | Create a chat with `request_id`, `model_id`, `user_prompt`, nullable `project_id`, optional `draft_id`, and file UUIDs        |
| `POST /chat/{chat_id}/message`              | Accept a turn with `request_id`, `expected_model_revision`, `user_prompt`, nullable parent ID, optional draft, and file UUIDs |
| `POST /chat/drafts`                         | Create an owned staging draft for a new or existing chat                                                                      |
| `POST /chat/drafts/{draft_id}/uploads`      | Upload durable library sources and add draft references                                                                       |
| `POST/DELETE /chat/drafts/{draft_id}/files` | Stage/remove library references using `file_ids`                                                                              |
| `DELETE /chat/drafts/{draft_id}`            | Discard references without deleting shared library sources                                                                    |
| `PUT /chat/{chat_id}/model`                 | Change next-turn selection with `model_id` and `expected_model_revision`                                                      |
| `PUT /chat/drafts/{draft_id}/model`         | Compare-and-set draft model using `model_id` and `expected_model_id`                                                          |

Draft references expire after 24 hours and grant no runtime file access. Before
send, the UI verifies that the persisted draft exactly matches visible selections.
Acceptance validates owner, model/revision, project, parent branch, and exact draft
membership. It commits the user message, active-child relationship, local file
references, fingerprinted receipt, and draft consumption atomically.

Retry the same logical send with its original request UUID and payload. A matching
receipt returns the existing accepted chat/message; a changed fingerprint rejects
reuse. Do not silently send a new request after an uncertain acknowledgement or
reattach files when replaying a receipt. Failed uploads/sends keep explicit retry
state in the composer; draft discard does not delete a source from the library.

The shared deterministic branch reader supplies both visible history and file
provenance. Runtime scope is current project files plus active-branch local
snapshots intersected with current chat memberships and owned source rows. General
has only the local set. Historical attachment snapshots retain immutable file IDs
and unavailable states after removal; filename reuse cannot redirect them.

## Transport and job ownership

```mermaid
sequenceDiagram
    participant Browser
    participant REST as REST acceptance
    participant DB as SQLite
    participant Socket as ChatController
    participant Job as ChatJob and orchestrator
    participant Agent
    Browser->>REST: Accept request and file UUIDs
    REST->>DB: Atomic turn, references, receipt, draft consumption
    REST-->>Browser: Accepted chat/message identity
    Browser->>Socket: Connect /chat/stream/chat_id with JWT
    Socket->>Job: Attach; resume pending work if idle
    Job->>DB: Record execution snapshot before provider use
    Job->>Agent: Execute with injected context and services
    Agent-->>Job: Text, tools, child events, usage
    Job-->>Socket: Outbound packets
    Socket-->>Browser: Stream updates
    Browser->>Socket: Tool approval or cancel
    Socket->>Job: Immediate decision/cancellation
```

The public path is `/api/py/chat/stream/{chat_id}?token={jwt}`.
`WebSocketConnection` handles JSON framing and heartbeat. Owner authorization occurs
before attaching to a process-local `ChatJob`. A controller owns its socket worker
tasks; the chat job owns provider generation. Disconnecting cancels connection
workers without canceling the generation task. Explicit `cancel` stops generation
and persists canceled status plus any partial assistant output.

The controller reads commands, processes normal commands sequentially, drains the
shared outbound queue, emits status every 0.5 seconds, and sends heartbeat pongs
every 10 seconds. Tool approvals and cancellation bypass the sequential queue so
they can resolve a run that is waiting. Jobs are process-local; pending snapshots
are persisted, but an interrupted provider connection is not durable. See
[resource lifecycle contracts](../adr/adr-0016-memory-resource-contracts.md#operations) for
bounds and cleanup ownership.

## Socket commands and packets

Client commands:

```json
{ "type": "resume" }
```

```json
{ "type": "regenerate", "parent_message_id": "<persisted-parent-uuid>" }
```

```json
{
  "type": "tool_approval",
  "tool_id": "call_abc123",
  "approved": true,
  "always_allow": false
}
```

```json
{ "type": "cancel" }
```

```json
{ "type": "ping" }
```

Server packets include `start` (with recorded execution metadata when available),
`delta` (content/thinking), `tool_call`, `tool_permission_request`, `tool_update`,
`status`, `pong`, `regenerate`, `complete`, and `error`. `sub_agent` envelopes carry
execution UUID, target identity/name, depth, and a nested child event. Child progress
renders separately from the final parent answer. Completion supplies updated
serialized messages; persisted assistant turns carry actual model/provider and
execution provenance rather than the chat's current picker value.

Resume reuses the pending model/configuration/prompt/file/target snapshot and
rechecks live authorization. Explicit regeneration validates current selection and
captures a new execution; earlier turns keep their provenance. Source revocation,
model disablement, changed identity, or target revocation can make replay unavailable
and must not silently substitute a model or broader context.

## File and provider boundaries

Inline files and tool retrieval share live execution authorization. Text/documents
are bounded converted content; only explicit vision support permits bounded image
bytes to become provider `image_url` parts. Missing, failed, unsupported, oversized,
or non-vision inputs produce explicit notices. Neither library browsing nor draft
staging grants runtime access.

Context estimates use the shared prompt/file/tool composition and token estimator;
provider usage is authoritative. Moves preserve existing history/local attachments
and apply the new project context on later turns. Historical messages may contain
prior project information even after live file access is revoked.

See [execution context](execution-context.md), [agent runtime](agent-runtime.md),
[project UI](project-workspaces.md), and [tool approval](tool-authorization.md).
