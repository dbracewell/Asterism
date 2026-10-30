# ADR-0025: Per-user ChatGPT plan connections

Status: Implemented in US-49.2; pending user confirmation.

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

## Consequences

- Plan usage works only when the user's browser runs on the Asterism machine.
- A second backend process would need a cross-process refresh lock; the
  revision check already prevents stale overwrites.
- OpenAI endpoints are module constants; browser tests (US-49.4) will need a
  configurable issuer to point them at a local double.
- The preview's constraints are tracked in EPIC-49 and must be re-verified at
  each story start.
