# Completed checklist — 2026-10-18

## US-31.2 — Persist theme edits reliably

The user confirmed completion on 2026-10-18, authorizing commit and local merge
from `feat/us-31.2-durable-theme-storage`.

- [x] US-31.2: Persist theme edits reliably — confirmed complete ([verification](../reviews/us-31.2-verification-2026-10-18.md))
  - [x] Define a small theme repository for bundled defaults and persisted custom themes under configured storage; use a clean-cut schema without migration or legacy shims.
  - [x] Await atomic saves, return typed errors, isolate malformed files, and define bounded cache invalidation across supported processes.
  - [x] Test write failure, invalid JSON, duplicate names, cache refresh and restart/container persistence using isolated storage.
  - [x] Document backup/reset ownership and verify container permissions plus UI failure/retry.

- [x] Obtain completion confirmation before commit and merge.

Custom palettes and bundled overrides persist under `STORAGE_ROOT/themes`.
Defaults are read-only static imports. Synced temporary files and atomic renames
preserve committed bytes on failure. Typed failures retain editable drafts with
retry; successful creation returns the ID used for subsequent edits. Malformed
files are isolated, freshness does not depend on a global palette cache, and
single-writer ownership plus backup/reset behavior are documented.

Verification passed: frontend lint, TypeScript, changed-file formatting, production
build, 180 frontend tests, six frontend database-script checks, six backend
initialization/reset tests, and three focused Playwright checks without retries.
Three replacement-container checks passed with UID/GID 10001, read-only application
assets and one new persistent volume. Full-suite and deployment limitations remain
in the [verification report](../reviews/us-31.2-verification-2026-10-18.md).

The working database was untouched. No deployment, remote push or remote CI result
is claimed. US-31.3 (untrusted Markdown HTML) is recommended next; EPIC-31 remains
incomplete until that story is completed and confirmed.

## US-31.3 — Constrain untrusted Markdown HTML

The user confirmed completion on 2026-10-18, authorizing commit and local merge
from `feat/us-31.3-markdown-trust-boundary`. After clarification, the user accepted
that inline Markdown images remain omitted while authorized image attachments
and application-managed previews remain available.

- [x] US-31.3: Constrain untrusted Markdown HTML — confirmed complete ([verification](../reviews/us-31.3-verification-2026-10-18.md))
  - [x] Decide allowed HTML, URL schemes and remote-image behavior; keep the policy owned by the shared renderer.
  - [x] Remove unrestricted raw HTML or sanitize it with the chosen schema after appropriate transforms; preserve approved KaTeX output.
  - [x] Add adversarial rendering tests for overlay styles, raw forms/frames, image requests and dangerous URLs alongside normal Markdown/math.
  - [x] Run browser regressions for rich chat/file content and document the trust boundary.

- [x] Obtain completion confirmation before commit and merge.

Raw HTML and automatic Markdown resources are disabled. Explicit HTTP(S),
application-path and fragment links remain usable; unsafe URLs are inert.
KaTeX trust is disabled with size/expansion limits. Standard math, copyable fenced
code, GFM and scoped citations remain supported. File extraction/captions remain
literal React text. The raw HTML parser dependency and unused dependency graph
were removed.

Verification passed: frontend lint, TypeScript, changed-file formatting, production
build, 215 frontend tests, six isolated database-script checks and two focused
browser checks without retries. Browser interception observed zero adversarial
resource requests. See [verification evidence](../reviews/us-31.3-verification-2026-10-18.md)
for full-suite limitations and [content policy](../architecture/markdown-content.md)
for the exact allowed content/resource contract.

EPIC-31 is confirmed complete: US-31.1, US-31.2 and US-31.3 are finished.
Recommended next: EPIC-32 / US-32.1, short-screen authentication reachability.
No deployment, remote push or remote CI result is claimed. The working database
was untouched.
