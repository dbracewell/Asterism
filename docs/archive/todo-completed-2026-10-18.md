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
