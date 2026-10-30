"""LLM domain: provider-agnostic chat-completion clients and wire types.

Modules:
    client         -- OpenAI-compatible Chat Completions streaming client
                      (``LLMClient``), shared HTTP client pool, and process-wide
                      request concurrency cap.
    responses      -- Responses API streaming client (``ResponsesLLMClient``) and
                      its stream-event reducer.
    capabilities   -- Per-provider request capabilities (wire API, forwarded
                      generation parameters, tool kinds).
    factory        -- Builds the client a provider's capabilities call for.
    errors         -- ``LLMProviderError`` with provider code/status/request ID.
    schemas        -- Wire/data types: messages, events, tool calls/results,
                      content parts, completion parameters, and the client protocol.
    draft          -- Singleton wrapper around the admin-configured "draft" model
                      used for cheap utility generation (e.g. chat titles).
    helpers        -- Message-to-API-shape conversion.
    token_counting -- Pre-request tiktoken-based context-window estimation.
    typedefs       -- Shared type aliases (finish reasons).
"""
