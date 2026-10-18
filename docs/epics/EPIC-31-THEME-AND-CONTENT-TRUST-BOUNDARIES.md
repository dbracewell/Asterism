# EPIC-31: Theme and content trust boundaries

Status: confirmed complete on 2026-10-18. US-31.1 was confirmed on 2026-10-17; US-31.2 and US-31.3 on 2026-10-18. Source: [2026-10-17 codebase review](../reviews/2026-10-17-codebase-review.md), F1, F2.

## Objective

Close the confirmed theme read traversal first, then make editing authorized and durable and constrain untrusted rich content.

## Ownership and delivery

Implementation stays within the owning domain/component. Preserve existing authorization, shared mutation-cache invalidation and generated API contracts. Use fresh initialization for schema changes; no migrations, compatibility shims or live-database resets. Work on one story at a time, create its feature branch, complete relevant lint/type/format/test gates, synchronize generated clients when contracts change, document behavior and obtain user confirmation before merge.

## US-31.1: Confine and authorize theme operations

As an administrator, I want theme operations to respect server-side roles and a confined storage boundary.

Estimate: 2–3 days. Dependencies: None.

Implementation verified and user-confirmed complete on 2026-10-17. See [verification evidence](../reviews/us-31.1-verification-2026-10-17.md).

Acceptance criteria:

Ordinary users cannot invoke theme writes or admin-only reads; any public theme reads use validated catalog IDs. Traversal, absolute paths, invalid names and malformed color payloads are rejected before I/O. Valid theme listing/selection remains available to intended users.

Tasks:

- [x] Trace every theme API/server action; centralize server-side session/role checks and runtime schema validation.
- [x] Use catalog IDs and resolved path containment; reject invalid filenames and test direct calls rather than only hidden controls.
- [x] Add unauthenticated, ordinary-user, admin and harmless traversal regressions; preserve normal selection/listing.
- [x] Run relevant frontend tests, lint, types and browser checks; update the security guide.

## US-31.2: Persist theme edits reliably

As an administrator, I want a successful theme save to survive process/container replacement.

Estimate: 2–3 days. Dependencies: US-31.1.

Implementation verified and user-confirmed complete on 2026-10-18. See [verification evidence](../reviews/us-31.2-verification-2026-10-18.md) and [storage decision/lifecycle](../architecture/theme-storage.md).

Acceptance criteria:

The theme repository has an explicit writable storage owner separate from bundled defaults. Writes are awaited and atomic; failures retain edits with retry and never report success. Readers validate files individually and cache invalidation is explicit. Container replacement preserves custom themes.

Tasks:

- [x] Define a small theme repository for bundled defaults and persisted custom themes under configured storage; use a clean-cut schema without migration or legacy shims.
- [x] Await atomic saves, return typed errors, isolate malformed files, and define bounded cache invalidation across supported processes.
- [x] Test write failure, invalid JSON, duplicate names, cache refresh and restart/container persistence using isolated storage.
- [x] Document backup/reset ownership and verify container permissions plus UI failure/retry.

## US-31.3: Constrain untrusted Markdown HTML

As a reader, I want chat and file content to render without taking control of application layout or silently loading unapproved resources.

Estimate: 1–2 days. Dependencies: None; coordinate with US-32.3.

Implementation verified and user-confirmed complete on 2026-10-18. See [verification evidence](../reviews/us-31.3-verification-2026-10-18.md) and [content policy](../architecture/markdown-content.md).

Acceptance criteria:

Document an explicit allowed Markdown/HTML/URL/resource policy. Raw HTML is disabled or sanitized with a maintained allowlist compatible with required math. Unsafe styling, embedded forms/frames and URLs are blocked. Existing fenced code, citations and approved math remain usable.

Tasks:

- [x] Decide allowed HTML, URL schemes and remote-image behavior; keep the policy owned by the shared renderer.
- [x] Remove unrestricted raw HTML or sanitize it with the chosen schema after appropriate transforms; preserve approved KaTeX output.
- [x] Add adversarial rendering tests for overlay styles, raw forms/frames, image requests and dangerous URLs alongside normal Markdown/math.
- [x] Run browser regressions for rich chat/file content and document the trust boundary.

EPIC-31 is complete. Recommended next: [EPIC-32](EPIC-32-RESPONSIVE-LAYOUT-AND-REACHABILITY.md), starting with US-32.1 (short-screen authentication reachability).
