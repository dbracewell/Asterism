# Todo

US-31.1 (Confine and authorize theme operations) was user-confirmed complete on
2026-10-17. Its completed checklist is [archived](docs/archive/todo-completed-2026-10-17.md#us-311--confine-and-authorize-theme-operations);
[verification evidence](docs/reviews/us-31.1-verification-2026-10-17.md) records passes and limitations.

No story is active. Recommended next: **US-31.2**, durable theme storage, under
[EPIC-31](docs/epics/EPIC-31-THEME-AND-CONTENT-TRUST-BOUNDARIES.md). US-31.3 remains pending.
Work on one story at a time on a feature branch; obtain completion confirmation
before merge. Broader review/roadmap planning is maintained separately.

Completed Projects/Chat Context and provider-settings checklists remain archived
for [2026-10-14](docs/archive/todo-completed-2026-10-14.md),
[2026-10-15](docs/archive/todo-completed-2026-10-15.md),
[2026-10-16](docs/archive/todo-completed-2026-10-16.md), and
[2026-10-17](docs/archive/todo-completed-2026-10-17.md).

## [EPIC-31: Theme and content trust boundaries](docs/epics/EPIC-31-THEME-AND-CONTENT-TRUST-BOUNDARIES.md)

- [ ] US-31.2: Persist theme edits reliably
  - [ ] Define a small theme repository for bundled defaults and persisted custom themes under configured storage; use a clean-cut schema without migration or legacy shims.
  - [ ] Await atomic saves, return typed errors, isolate malformed files, and define bounded cache invalidation across supported processes.
  - [ ] Test write failure, invalid JSON, duplicate names, cache refresh and restart/container persistence using isolated storage.
  - [ ] Document backup/reset ownership and verify container permissions plus UI failure/retry.
- [ ] US-31.3: Constrain untrusted Markdown HTML
  - [ ] Decide allowed HTML, URL schemes and remote-image behavior; keep the policy owned by the shared renderer.
  - [ ] Remove unrestricted raw HTML or sanitize it with the chosen schema after appropriate transforms; preserve approved KaTeX output.
  - [ ] Add adversarial rendering tests for overlay styles, raw forms/frames, image requests and dangerous URLs alongside normal Markdown/math.
  - [ ] Run browser regressions for rich chat/file content and document the trust boundary.
