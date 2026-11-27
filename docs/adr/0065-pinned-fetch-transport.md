# ADR-0065 — Web fetches connect only to the address that passed validation

Status: accepted; US-80.2 on 2026-11-17
([EPIC-80](../epics/EPIC-80-FETCH-TOOL-HARDENING.md)).

## Context

`web_fetch` and `web_search` fetch URLs chosen by the model, which can be
steered by untrusted page text. `validate_public_http_url` resolves the
hostname and rejects any non-public address, but httpx and Chromium then
resolved the name a second time to connect. A hostile DNS server can answer
the check with a public address and the connection with a private one (DNS
rebinding), reaching loopback, the cloud metadata service or the LAN.

## Decision

### Plain HTTP connects to the validated IP

`resolve_public_http_url` returns a `PublicUrl`: the normalized URL plus the
first validated address. `_pinned_request` rewrites the request URL's host to
that IP and keeps the original name in:

- the `Host` header, so virtual hosting works;
- httpx's `sni_hostname` request extension, which httpcore passes to TLS as
  `server_hostname`, so SNI and certificate verification use the real name
  (literal-IP URLs send no override).

httpx is never given a hostname, so it never resolves one. `_send_pinned`
follows redirects itself: every hop is re-validated, re-resolved once and
pinned. 307/308 keep the method and body; other redirects become a bodiless
GET. Cookies and `Authorization` are dropped when a hop changes origin. The
clients are built with `trust_env=False`, so `HTTP(S)_PROXY` and other proxy
settings in the server's environment never route a fetch (US-116.3).

We chose this over a custom transport or httpcore network backend: httpx has
no public hook for the resolver, and a request-level rewrite needs no private
API.

### Chromium cannot reach the network itself

Chromium resolves names in its own network stack, so a route guard that
validates and then calls `route.continue_()` still leaves the rebinding gap.
Instead:

- The pooled browser (`asterism/common/headless_browser.py`, shared with the
  canvas export diagram renderer since
  [ADR-0082](0082-diagrams-in-canvas-exports.md)) launches with
  `--host-resolver-rules=MAP * ~NOTFOUND`
  and a dead proxy (`--proxy-server=http://blackhole.invalid:9`,
  `--proxy-bypass-list=<-loopback>`). Any request Chromium makes on its own
  fails, including loopback IPs, WebSockets and redirects it follows itself.
- Each fetch uses a fresh context with service workers blocked. A context
  route (`_serve_browser_request`) answers every request through the same
  pinned httpx client and `route.fulfill`: it forwards method, headers and
  body, follows redirects with `_send_pinned`, and caps bodies at
  `_MAX_RESPONSE_BYTES` (an oversized response is aborted rather than
  truncated). Images, media and fonts are aborted unfetched. URLs that fail
  validation are aborted with `accessdenied`. A page may make at most
  `_MAX_BROWSER_REQUESTS` (100) requests, its own included; later ones are
  aborted unfetched.
- Only HTML (`text/html`, `application/xhtml+xml`) is rendered. A short text,
  JSON or CSV response is used as fetched, never loaded into the browser.

A probe confirmed that Chromium does not route the follow-up request after a
fulfilled 3xx, so redirects must be resolved in the handler.

## Consequences

- Rebinding can no longer redirect a fetch after validation, on either path.
- Browser pages that redirect receive the final response under the original
  URL, so relative URLs resolve against the pre-redirect address. `fetch_page`
  starts the browser at the URL plain HTTP already redirected to, so this is
  rare.
- WebSockets and other requests Playwright cannot route do not work in
  rendered pages. That is acceptable for text extraction.
- Pages see a single pinned address per hostname per request, with no
  fallback to other A/AAAA records if it is unreachable.
- Real-browser tests (`test_fetch_security.py`) skip when Playwright's
  Chromium is not installed; CI's backend job does not install it, so the
  route-handler unit tests carry the CI coverage.
