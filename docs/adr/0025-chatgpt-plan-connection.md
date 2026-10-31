# ADR-0025: Per-user ChatGPT plan connections

Status: Implemented in US-49.2 (user-confirmed on 2026-10-30) and extended in US-49.3 (user-confirmed on 2026-10-31) and US-49.4 (user-confirmed on 2026-10-31).

## Context

OpenAI's Sign in with ChatGPT plan-usage preview lets open-source, locally hosted
apps run Responses API requests on a user's own ChatGPT Plus or Pro plan
([docs](https://developers.openai.com/siwc/token-sharing-open-source)). Asterism
is multi-user, so a plan must never serve another user's requests, and plan
errors must never switch silently to an administrator-paid provider.

## Decision

**Ownership.** The `chatgpt` domain stores at most one connection per Asterism
user (`chatgpt_connections`, keyed by `user_id`). The issued `oaiapp_…` client ID,
host ID, verified subject, email, ID token and token set are `EncryptedText`
(Fernet under `SYSTEM_KEY`), like provider API keys. Responses never carry tokens.
Every read, refresh and disconnect is scoped to the caller's user ID; the only
unauthenticated route, the OAuth callback, derives the user solely from its
single-use authorization attempt. The installation has one stable, opaque
`ext_agent_host_id` (`urn:uuid:` UUIDv4) in `chatgpt_host`, shared by all of its
users' registrations, as OpenAI asks for one ID per host.

**Authorization.** `POST /chatgpt/connection/authorize` creates an attempt with
fresh `state`, `nonce` and PKCE (S256) values and returns the authorize URL. Only
a SHA-256 digest of `state` is stored; the verifier and nonce are encrypted. An
attempt expires after ten minutes, a new attempt replaces the user's earlier one,
and the callback consumes it before doing anything else, so replays fail. First
sign-in registers with `dynamic_agent_client` and `agent_name_hint`; later
sign-ins reauthorize with the saved client ID, `id_token_hint` and `login_hint`.
The callback rejects a different client ID than the attempt's and a different
verified subject than the saved one, and stops on `access_denied` before any
code exchange. The ID token is verified against the issuer's JWKS (from
OpenID discovery) for signature, issuer, audience (issued client ID), expiry and
nonce. A grant without `chatgpt.tokens.use.direct` (or with no `scope` at all)
is saved as `plan_usage_disabled`.

**Loopback callback.** OpenAI requires an HTTP redirect to `127.0.0.1` where only
the port may vary. Asterism uses `http://127.0.0.1:<PUBLIC_URL port>/api/py/chatgpt/callback`,
reaching the backend through the same route as every other API request (Next.js
rewrite in development, nginx in Docker, which publishes on `127.0.0.1`). No
second listener is opened. The browser must therefore run on the Asterism
machine; remote and multi-machine deployments need a registered HTTPS callback
and OpenAI approval, which is out of scope. Because the callback host differs
from a `localhost` `PUBLIC_URL`, it carries no session cookie; `state` alone
authorizes it, and it redirects back to User Settings at `PUBLIC_URL`.

**Refresh.** `service.access_token(user_id)` returns a current access token for
that user only, refreshing within five minutes of expiry. Refreshes are
serialized per user with an in-process lock (Asterism is single-process, see
ADR-0019), and the write is a compare-and-swap on `token_revision`, so a
rotating refresh token is used once and a stale result never overwrites a newer
token set. The access token, expiry, scopes and refresh token are replaced
together. Terminal refresh errors (`invalid_grant`, `refresh_token_reused`, …)
clear the tokens and require signing in again; network or 5xx failures keep the
credentials and reuse a still-valid token.

**Policy and fallback.** Admin policy `chatgpt_plan_enabled` defaults to disabled
and fails closed. Disabling it blocks new sign-ins and makes `access_token`
unavailable without deleting connections; re-enabling restores them. Every
unavailable state raises `ChatGPTPlanUnavailable` with a reason; nothing falls
back to another connection or provider. Choosing another model is always the
user's explicit action.

**Disconnect.** Disconnect revokes the refresh token at the discovered
`revocation_endpoint` (bounded retries on network/5xx), then removes all tokens
even when revocation is unconfirmed, and reports which happened. The registration
(client ID, subject, email) is kept for a later sign-in, as OpenAI recommends;
"Use a different account" (`forget`) deletes it so the next sign-in registers
anew.

**Plan models (US-49.3).** A user's plan models are ordinary `models` rows under
that user's own `providers` row (`provider_type = 'chatgpt'`, `owner_user_id`
set; a CHECK ties the two together and each user has at most one). Chats,
sub-agent definitions and project selections therefore bind them by model ID
exactly like admin models, with no parallel tables. Global provider names stay
unique through a partial index on `owner_user_id IS NULL`.

`settings/queries.py` holds the owner-scoped base conditions. Every admin-wide
surface (provider settings, app settings, provider model pages, discovery,
draft model, captioning, knowledge processing) filters to global providers;
user pickers and lookups (`/chat/models`, `/settings/user` models, default
model, sub-agent binding, delegation, tool policy, execution lookup) use
global plus the caller's own models. Admin payloads with `provider_type =
'chatgpt'` are rejected.

`chatgpt/availability.py` is the single availability rule: another user's plan
model is unavailable; an owned plan model is available only while it is active
(still listed by the account), the policy is enabled and the connection has
plan usage. Pickers, chat admission, sub-agent and project listings and
delegation all report its reason and never retarget a binding.

Models sync from `GET /v1/models` (`visibility == "list"`, `slug` as the model,
`display_name` for labels) after a successful sign-in and on "Refresh models".
Unlisted models are deactivated, never deleted, so bindings survive and return
when the model is listed again. Plan models report `supports_tools = true`
(source: provider), because the plan route accepts function tools; vision and
context size stay unknown. Picker order is Asterism's name order, not the
server order.

At execution, `create_llm_client` refuses a plan model unless the executing
user owns it, and the Responses client fetches that owner's token on every
request; an unavailable plan becomes one `ERROR` event with code
`chatgpt_plan_<reason>`. Delegation runs a sub-agent as the delegating user, so
a plan-bound target runs only on its owner's connection.

**Usage and recovery (US-49.4).** `ChatGPTPlanClient` (`chatgpt/plan_client.py`)
wraps the Responses client for plan models and applies the plan error rules
before any output reaches the caller:

- `subscription_sharing_usage_limit_exceeded` (HTTP 429 or `response.failed`,
  even after output) pauses the owner's plan (`usage_paused_at`). Paused plans
  send no requests and their models report `chatgpt_plan_usage_limit`. No reset
  time is inferred; only the user's explicit "Try my plan again" (or a new
  sign-in) resumes it. Other 429s do not pause.
- `subscription_sharing_usage_unavailable`, `…_user_unavailable` and bare 503s
  retry three times (1, 2 and 4 seconds) while no output has been emitted, then
  fail as `chatgpt_plan_temporarily_unavailable` with credentials kept.
- `subscription_sharing_invalid_user` or 401 forces one token refresh and one
  retry. Only a terminal refresh error asks the user to sign in again
  (`chatgpt_plan_reauthorization_required`); a second rejection is reported as
  `chatgpt_plan_session_rejected` and keeps the connection.

Every plan failure is one `ERROR` event whose `error_code` (`chatgpt_plan_<reason>`)
travels on the chat WebSocket, and picker entries carry the same
`unavailable_code`. The UI maps each code to recovery: "Manage usage"
(`https://chatgpt.com/settings/usage`) is the primary action for usage
limits, reconnect codes link to User Settings, and choosing another model is
always the user's action. The composer shows "Using ChatGPT plan" with Manage
usage for available plan models. The one-time "You're using your ChatGPT plan"
notice is stored per registration (`notice_dismissed_at`), so it does not
repeat on later sign-ins.

## Consequences

- Plan usage works only when the user's browser runs on the Asterism machine.
- A second backend process would need a cross-process refresh lock; the
  revision check already prevents stale overwrites.
- OpenAI endpoints are module constants. Backend tests drive the real OAuth,
  models and Responses code against HTTP doubles; browser tests mock the
  Asterism API and a routed `auth.openai.com` consent page instead of making
  the endpoints configurable.
- The preview's constraints are tracked in EPIC-49 and must be re-verified at
  each story start.
