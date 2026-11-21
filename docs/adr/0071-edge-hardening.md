# ADR-0071 — Edge hardening: CSP, one upload limit, rate limits

Status: accepted and implemented for US-86.5 on 2026-11-18
([EPIC-86](../epics/EPIC-86-MULTI-USER-DEPLOYMENT-READINESS.md)). Amends the
canvas preview in [ADR-0063](0063-canvas.md).

## Context

An operator should be able to put one Asterism container on the internet,
behind their own TLS proxy, with the usual web protections on by default.
Before this, responses had no security headers. The upload limit differed by
layer: nginx allowed 100 MB per request, the Next.js proxy 500 MB, and the
backend 100 MiB per file, with any number of files in one request. Only Better
Auth's own sign-in limiter restricted request rates, and nginx saw the TLS
proxy's address as the client.

The target is a class of about 30 students and their educators. In a school,
they often share one public address.

## Decision

**Page CSP with a per-request nonce.** `src/proxy.ts` makes a fresh nonce for
every page and sets the policy on both the forwarded request (Next.js reads the
nonce there and adds it to its own scripts) and the response. Every page already
renders dynamically, because the root layout reads cookies. The proxy now also
runs for `/sign-in` so it gets the policy too. The policy
(`src/lib/content-security-policy.ts`):

- `script-src 'self' 'nonce-…' 'strict-dynamic'`, plus `'unsafe-eval'` only
  under `next dev`. No inline or third-party script runs.
- `style-src 'self' 'unsafe-inline'`. React, Radix positioning and KaTeX write
  inline styles. Inline style can't run code, and a nonce for styles would mean
  changing every component.
- `img-src 'self' blob: data:`, `font-src 'self' data:`, `media-src 'self' blob:`.
  API files reach the page as `blob:` URLs, and Markdown already refuses
  remote images.
- `connect-src 'self'` plus the explicit `ws:`/`wss:` origin of `PUBLIC_URL`.
- `worker-src 'self'`. Otherwise workers fall back to `script-src`, where
  `'strict-dynamic'` ignores `'self'`, and the shared event worker would be
  refused.
- `frame-src 'self'` (only the canvas preview), `object-src 'none'`,
  `base-uri 'self'`, `form-action 'self'`, `frame-ancestors 'none'`
  (and `X-Frame-Options: DENY`), plus `upgrade-insecure-requests` under HTTPS.

`next.config.ts` adds `X-Content-Type-Options: nosniff` and
`Referrer-Policy: same-origin` to every Next.js response.

**Canvas preview frame.** A `srcdoc` frame inherits its parent's policy, so the
nonce rule would refuse a canvas page's own inline scripts. The preview frame
now loads `public/canvas-preview.html`, whose header policy is the preview
policy plus `frame-ancestors 'self'`. The panel posts the page to that frame once
it has loaded. The listener is attached before `src` is set, so a frame that
loads before hydration doesn't miss the page. The frame keeps
`sandbox="allow-scripts"`, an opaque origin, no network, and a fresh mount for
each version.

**API responses are data.** For `/api/py/` and `/api/auth/`, nginx replaces
any upstream security headers with `default-src 'none'; frame-ancestors 'none'`,
`nosniff`, `X-Frame-Options: DENY` and `Referrer-Policy: same-origin`
(`docker/nginx-api-headers.conf`). The page never navigates to an API URL.

**HSTS follows `PUBLIC_URL`.** With an `https://` origin, nginx sends
`Strict-Transport-Security: max-age=31536000` on every response. It is sent
even when nginx itself speaks HTTP behind the operator's TLS proxy, since
browsers only see it over HTTPS. `includeSubDomains` and preload are left to
the operator. Better Auth already marks its cookies `__Secure-`, `Secure`,
`HttpOnly` and `SameSite=Lax` for an HTTPS base URL; a unit test and the
container smoke test check this.

**One upload limit.** `MAX_UPLOAD_FILE_SIZE_BYTES` (default and maximum
100 MiB) is the largest upload request: one file or several together. nginx's
`client_max_body_size` and the Next.js `proxyClientMaxBodySize` are that value
plus 1 MiB for the multipart framing. The backend now counts the files of one
request together against the limit, so a request nginx would refuse is also
refused when the backend is reached directly. Lowering the limit also lowers
`MAX_PROCESS_FILE_SIZE_BYTES` and `MAX_VISION_IMAGE_BYTES` when they are left at
their defaults; otherwise they would sit above the limit and the backend would
refuse to start. nginx's refusal is JSON
(`{"detail": …}`) like the API's own errors.

**Rate limits at nginx, by trusted client address.** `TRUSTED_PROXIES` (comma-separated
addresses or CIDR networks, so it fits the strict `.env` syntax) enables nginx's real-IP module. Only a
connection from a listed proxy may set the client address through
`X-Forwarded-For`. nginx then passes the services only the resolved address, so
Better Auth's limiter sees the same client. Per address and minute:

| What                                                           | Rate | Burst |
| -------------------------------------------------------------- | ---- | ----- |
| Better Auth writes (`POST /api/auth/…`; reads are not limited) | 60   | 60    |
| Uploads (`/api/py/files/`, chat draft uploads)                 | 60   | 60    |
| Chat WebSocket handshakes                                      | 120  | 60    |

The burst lets a whole class behind one address sign in or open chats at once.
Refusals are a JSON 429 with `Retry-After: 60`.

**Settings render at startup.** `scripts/edge-config.mjs` writes the nginx
snippets that depend on settings (`client_max_body_size` with its 413 response,
HSTS, real-IP) to `/tmp/asterism-nginx/` after configuration validation. The
static policy stays in `docker/nginx.conf`. Both new settings are in the
configuration contract, so invalid values stop the container before anything
starts.

## Consequences

- Every Playwright case fails on a CSP report, so the suite as a whole shows that
  the app runs under the policy. One spec checks the nonce, enforcement and the
  preview frame. The container smoke test checks headers, cookies, the upload
  limit and the auth rate limit under an HTTPS `PUBLIC_URL`.
- Pages can't be cached by a CDN, because each one carries its own nonce. This
  was already true, since every page is dynamic.
- A new third-party script, frame or remote resource needs a CSP change and a
  decision here.
- The container health check uses `/sign-in` instead of `/`. `/` redirects
  signed-out clients to `PUBLIC_URL`, which the container may not be able to
  reach under an HTTPS origin.
- Better Auth's built-in sign-in limit (3 per 10 seconds per address) still
  applies, and is stricter than nginx for a class signing in from one address.
  US-86.7's capacity check measures whether it needs raising.
