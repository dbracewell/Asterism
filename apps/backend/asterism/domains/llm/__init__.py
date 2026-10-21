"""LLM domain: provider-agnostic chat-completion clients and wire types.

Modules:
    client         -- OpenAI-compatible streaming client (``LLMClient``), shared
                      HTTP client pool, and process-wide request concurrency cap.
    schemas        -- Wire/data types: messages, events, tool calls/results,
                      content parts, completion parameters, and the client protocol.
    draft          -- Singleton wrapper around the admin-configured "draft" model
                      used for cheap utility generation (e.g. chat titles).
    helpers        -- Message-to-API-shape conversion.
    token_counting -- Pre-request tiktoken-based context-window estimation.
    typedefs       -- Shared type aliases (finish reasons).
"""
