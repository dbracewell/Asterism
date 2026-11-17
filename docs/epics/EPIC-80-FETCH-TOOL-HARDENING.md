# EPIC-80: Fetch tool hardening

Status: in progress. Source: [codebase review](../../codebase_review.md), verified 2026-11-14 (item 11).

## Objective

Bound the memory, network and CPU cost of `web_fetch` / `web_search`, and close the DNS rebinding gap.

## User stories

### US-80.1: Bounded, streamed fetch

- [x] Stream the response in `fetch_page`, stop at a byte cap, and reject non-textual `Content-Type` before reading the body.
- [x] Tests: large binary, oversized text, redirect to an internal host still rejected.

### US-80.2: Pin the resolved address

- [x] Connect to the address that passed validation (custom transport or resolver), including each redirect hop; keep the Host header and TLS name.
- [x] Decide and document the Playwright path (route guard re-validates, but resolution is separate).
- [x] Test with a resolver that returns a public address first and a private one second.

### US-80.3: Parse once, off the event loop

- [ ] Parse HTML once; run `extract_clean_markdown` with `asyncio.to_thread`.
- [ ] Test `web_search` over 10 URLs does not block the loop.

## Notes

US-80.1: plain-HTTP fetches read at most 2 MiB (`_MAX_RESPONSE_BYTES`) and truncate the rest unread. Only `text/*`, XHTML, XML and JSON media types (including `+xml`/`+json`) are accepted; others raise `UnsupportedContentTypeError` before the body is read. The Playwright path applies the same type check and truncates rendered HTML to the same length.

US-80.2: see [ADR-0065](../adr/0065-pinned-fetch-transport.md). Plain HTTP connects to the validated IP (Host header and SNI keep the name); Chromium is locked out of the network and every browser request is served through the same pinned client. The unused `force_playwright` option was removed.
