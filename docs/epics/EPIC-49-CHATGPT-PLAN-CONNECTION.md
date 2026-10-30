# EPIC-49: ChatGPT plan connection

Status: in progress (US-49.1 complete; US-49.2 active). Source: Sign in with ChatGPT research (2026-10-30).

## Objective

Let a user run Asterism chats on their own ChatGPT Plus or Pro plan instead of
an administrator-configured API key or a local model, using OpenAI's Sign in
with ChatGPT plan-usage flow
([docs](https://developers.openai.com/siwc/token-sharing-open-source)).

Asterism stays multi-user. Each user connects their own plan; their plan models
appear only in their own pickers and only ever run on their own tokens. No
user's plan is shared with another user, and no request silently falls back to
another billing source.

## Constraints from the OpenAI preview (verify at epic start)

The feature is a preview; re-read the linked docs before each story begins and
update this section if they changed. Last verified 2026-10-30 at US-49.1 start
against the overview, models-and-inference, preview-limitations and
errors-and-recovery pages.

- Eligibility: plan usage is available to open-source and locally hosted apps.
  Asterism is Apache-2.0 licensed (2026-10-30). Paid or remotely hosted
  deployments need OpenAI's interest form and are out of scope.
- OAuth: authorization code + PKCE (S256), no client secret. First
  authorization uses `client_id=dynamic_agent_client` with a stable
  `ext_agent_host_id` and returns an issued `oaiapp_…` client ID to keep.
  Scopes `openid profile email offline_access resource.invoke
  chatgpt.tokens.use.direct`; resource `https://api.openai.com/v1`.
- Callback: an HTTP loopback URI on `127.0.0.1` (not `localhost`), so the
  user's browser must run on the same machine as Asterism. Only the port may
  vary between sign-ins; scheme, host and path stay fixed. Reauthorization
  sends the saved client ID with `id_token_hint`/`login_hint` and omits
  `agent_name_hint`; a callback with a different client ID is rejected.
  Revocation uses the `revocation_endpoint` from
  `https://auth.openai.com/.well-known/openid-configuration` (verified
  2026-10-30 at US-49.2 start).
- Tokens: access tokens last one hour; refresh tokens last 30 days and rotate on
  every refresh (reuse fails with `refresh_token_reused`). Each issued client
  ID is bound to one ChatGPT user and workspace.
- Host ID: `ext_agent_host_id` is chosen and persisted before first sign-in;
  stable and opaque (`urn:ietf:params:oauth:jwk-thumbprint:…` recommended,
  `urn:uuid:…` UUIDv4 or `did:key:…` accepted), never a personal identifier.
- Inference: `POST https://api.openai.com/v1/responses` with `stream: true` and
  `store: false`; resend all needed history in `input` (no
  `previous_response_id`). Explicit system message items are rejected: use
  `instructions` (or developer messages). Rejected fields: `background`,
  `conversation`, `max_output_tokens`, `max_tool_calls`, `metadata`,
  `moderation`, `multi_agent`, `prompt`, `prompt_cache_retention`,
  `safety_identifier`, `temperature`, `top_logprobs`, `top_p`, `truncation`,
  `user`. Function and custom tools work; image generation, file search, Code
  Interpreter, computer use, hosted MCP/connectors and `tool_search` do not.
  Text, image and file inputs work when the model accepts them; audio/video and
  the Files upload API do not. Success requires `response.completed`;
  `response.incomplete`, `response.failed` and interrupted streams are handled
  separately. Models come from `GET /v1/models` (`models[]` with
  `visibility == "list"`, server order kept, show `display_name`, send `slug`).
- Errors: `subscription_sharing_usage_limit_exceeded` (429, may also arrive as
  `response.failed` mid-stream) pauses plan requests and points to "Manage
  usage" without inferring a reset time; `subscription_sharing_usage_unavailable`
  and `subscription_sharing_user_unavailable` (503) keep credentials and retry
  with bounded backoff; `subscription_sharing_user_not_eligible` (403) explains
  the restriction without retrying; `subscription_sharing_unsupported_capability`
  (400) names the rejected `error.param`. `invalid_grant`, `invalid_refresh_token`,
  `token_expired`, `refresh_token_expired`, `refresh_token_invalidated` and
  `refresh_token_reused` on refresh are terminal: clear tokens and repeat OAuth
  with the saved issued client ID. Do not delete credentials on temporary
  failures. Preserve status, code and request ID for diagnostics. Declined
  consent or a grant without `chatgpt.tokens.use.direct` keeps the sign-in with
  plan usage disabled. Fallback to another billing path must be the user's
  explicit choice.
- UI wording: "Continue with ChatGPT", "Using ChatGPT plan", "Manage usage",
  and a one-time "You're using your ChatGPT plan" notice dismissed with
  "Got it" ([guidelines](https://developers.openai.com/siwc/ui-ux-guidelines)).
- Do not call ChatGPT's private `backend-api` endpoints.

## Ownership and delivery

Backend and frontend. The connection is a user-owned credential stored
encrypted at rest (like provider API keys) behind the existing storage
interfaces. Admin policy `chatgpt_plan_enabled` controls eligibility and
defaults to disabled; disabling it makes connected plan models unavailable
without deleting connections or rebinding chats. Plan models obey the existing
invariants: chats persist their selection and per-execution provenance;
sub-agent definitions keep their fixed model binding and become unavailable,
not replaced, when the connection or policy goes away. Record the design in an
ADR. Multi-user hosted deployments with a registered HTTPS callback are a
possible later epic if OpenAI approves access.

## US-49.1: Responses API streaming adapter

As the platform, I want an LLM client for the Responses API so providers that
only support it can run chats, tools and agent loops.

Estimate: 2 days. Dependencies: none.

Acceptance: a Responses streaming client sits beside the Chat Completions
client behind the same LLM interface and emits the same `LLMEvent` stream
(content, thinking, tool calls, usage, errors). It maps system prompts to
`instructions` and history to `input`, and uses `store: false` with
`stream: true`. Per-provider request capabilities decide which generation
parameters are sent, so unsupported defaults (`temperature`, `top_p`,
`max_tokens`) are omitted rather than rejected. Existing providers keep Chat
Completions unchanged.

- [x] Add the Responses streaming client and event reducer behind the existing LLM interface.
- [x] Add per-provider request capabilities for generation parameters and tool kinds.
- [x] Test streaming, tool calls in the agent loop, interrupted and failed streams against a local double.

## US-49.2: Per-user ChatGPT connection

As a user, I want to connect my ChatGPT plan to Asterism so my chats can use it.

Estimate: 2.5 days. Dependencies: US-49.1.

Acceptance: when the admin policy is enabled, User Settings shows a "Continue
with ChatGPT" connection. It starts the registration or reauthorization flow
with PKCE, `state` and `nonce`; a loopback callback on `127.0.0.1` completes it
and validates the ID token against OpenAI's JWKS. The issued client ID, host ID,
ID token and token set are stored encrypted per user. Refreshes are serialized
per user and replace the access token, expiry, scopes and rotating refresh
token together. Declined plan consent keeps the connection marked "plan usage
disabled". Users can disconnect, which removes their tokens. Requests and
refreshes never use another user's connection. The instructions state that the
browser must run on the Asterism machine.

- [x] Add the admin policy (default disabled) and the encrypted per-user connection store.
- [x] Implement registration, reauthorization, loopback callback, ID-token validation and disconnect.
- [x] Implement serialized refresh with terminal-error handling; test ownership isolation, rotation and policy changes.
- [x] Write the ADR (connection ownership, loopback limit, no fallback, preview constraints).

## US-49.3: Plan models in the pickers

As a connected user, I want my ChatGPT plan models in the chat and sub-agent
model pickers.

Estimate: 1.5 days. Dependencies: US-49.2.

Acceptance: the user's plan models come from `GET /v1/models` and appear only in
their own chat and sub-agent pickers, with a ChatGPT provider identity and
capability badges (US-46.3). Chats and sub-agents bind them like other models
and record provenance per execution. If the user disconnects, the policy is
disabled or a model leaves the account, bound chats and sub-agents show the
model as unavailable and are never retargeted. Delegation to a sub-agent bound
to a plan model runs only on its owner's connection.

- [ ] Sync owner-scoped plan models and expose them through the chat model choices.
- [ ] Mark unavailable bindings without replacement; cover chats, sub-agents and project selections.
- [ ] Test owner isolation, provenance and availability changes.

## US-49.4: Plan usage experience and limits

As a user on my ChatGPT plan, I want to see when requests use it and know what
to do when I hit a limit.

Estimate: 1 day. Dependencies: US-49.3.

Acceptance: the composer shows "Using ChatGPT plan" with a "Manage usage" link
when a plan model is selected. The first successful connection shows "You're
using your ChatGPT plan" once, dismissed with "Got it". A usage-limit error
pauses plan requests and shows "Manage usage" as the primary action, offering
other models only as the user's explicit choice. Usage-unavailable errors retry
with bounded backoff, and revoked sessions ask the user to connect again. All
of it is keyboard and screen-reader accessible in every theme.

- [ ] Add the plan label, Manage usage link and first-use notice.
- [ ] Map usage-limit, unavailable and revoked errors to their recovery UI.
- [ ] Add unit and isolated browser tests with a local OAuth and Responses double.
