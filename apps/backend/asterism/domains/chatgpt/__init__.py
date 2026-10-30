"""ChatGPT plan connection: per-user Sign in with ChatGPT credentials.

Modules:
    models   -- Connection, pending-authorization and host-identity tables.
    schemas  -- API payloads (policy, connection status, authorization start).
    oauth    -- OpenAI OAuth protocol: authorize URL, PKCE, code exchange,
                refresh, revocation and ID-token validation.
    policy   -- Admin ``chatgpt_plan_enabled`` policy (fail-closed).
    service  -- Connection lifecycle and serialized per-user token refresh.
    router   -- HTTP routes, including the loopback OAuth callback.

See ``docs/adr/0025-chatgpt-plan-connection.md``.
"""
