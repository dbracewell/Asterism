# Asterism Architecture Documentation

This directory documents the architecture implemented in the Asterism monorepo.
Asterism is a self-hosted AI chat application with a Next.js frontend, FastAPI
backend, capability-scoped tools and sub-agents, streamed responses, and
user-owned file attachments.

## Document index

| Document | Scope |
| --- | --- |
| [System overview](overview.md) | Topology, workspace layout, request and streaming lifecycle |
| [Authentication and security](auth-and-security.md) | Better Auth, JWT/JWKS verification, tenancy, and internal callbacks |
| [Chat and WebSocket](chat-and-websocket.md) | Bidirectional chat protocol, queues, and controller lifecycle |
| [Agent runtime](agent-runtime.md) | Bounded LLM loop, event stream, delegation, and traces |
| [Tool authorization](tool-authorization.md) | Allowlist and interactive approval policies, child-agent boundaries |
| [LLM providers](llm-providers.md) | OpenAI and OpenAI-compatible provider configuration and capabilities |
| [Data and storage](data-and-storage.md) | SQLite schema, message tree, local file storage, and attachments |

## Current deployment topology

```mermaid
flowchart TD
    Browser[Browser]

    subgraph Frontend[Next.js application / nginx public entrypoint]
        Auth[Better Auth: /api/auth]
        UI[React UI]
        Stream[Event stream: /api/stream]
        Proxy[Same-origin /api/py proxy]
    end

    subgraph Backend[FastAPI :8000]
        API[REST and WebSocket routes]
        Chat[Chat controller and orchestrator]
        Agent[Agent runtime and tool registry]
        DB[SQLAlchemy async session manager]
    end

    SQLite[(SQLite in STORAGE_ROOT)]
    Files[(Local files in STORAGE_ROOT/files)]
    Providers[OpenAI or compatible provider]

    Browser --> UI
    Browser -->|session and JWT| Auth
    Browser -->|REST and WebSocket: /api/py| Proxy
    Proxy --> API
    API --> Chat
    Chat --> Agent
    Agent --> Providers
    API --> DB
    DB --> SQLite
    API --> Files
    Backend -->|system-key callback| Stream
```

## Design boundaries

- **Same-origin browser traffic:** the browser uses `/api/py` for FastAPI HTTP,
  WebSocket, and OpenAPI traffic. Next.js supplies the local-development proxy;
  nginx supplies the equivalent route in the combined container.
- **Authentication boundary:** Better Auth owns sessions and signing keys. FastAPI
  validates bearer and WebSocket JWTs against the frontend's loopback JWKS endpoint.
- **Capability boundary:** a chat agent may invoke only its configured tools. A
  delegated agent executes only the active tools assigned to its own profile.
- **Persistence boundary:** SQLAlchemy manages the relational store; uploaded bytes
  pass through the `FileStore` protocol, whose current implementation is
  `LocalFileStore`.
- **Provider boundary:** the runtime uses the OpenAI SDK. Supported configurations
  are canonical OpenAI and a generic OpenAI-compatible HTTP(S) endpoint.

## Code entry points

- Backend app: [`asterism.main:app`](../apps/backend/asterism/main.py)
- Backend lifespan: [`asterism.core.lifespan:lifespan`](../apps/backend/asterism/core/lifespan.py)
- Chat transport: [`ChatController`](../apps/backend/asterism/domains/chat/controller.py)
- Agent loop: [`Agent`](../apps/backend/asterism/domains/agent/agent.py)
- Tool registry: [`tool_registry`](../apps/backend/asterism/domains/tools/registry.py)
- Frontend chat hook: [`useChatWebSocket`](../apps/frontend/src/features/chat/hooks/use-chat-websocket.tsx)
