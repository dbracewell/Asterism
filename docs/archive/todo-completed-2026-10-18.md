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

## US-32.1 — Authentication and mobile workspace reachability

The user confirmed completion on 2026-10-18, authorizing commit and local merge
from `feat/us-32.1-authentication-reachability`.

- [x] US-32.1: Make short-screen authentication reachable
  - [x] Give authentication pages a dynamic-height and scroll contract while preserving workspace-specific scroll ownership.
  - [x] Add short-screen/landscape and enlarged-text browser cases with submit/validation reachability checks.
  - [x] Check focus visibility and keyboard navigation, and update the frontend layout guide.
  - [x] Repair reported mobile sidebar, header and page-scroll regressions; verify authenticated mobile routes.

Verification passed: frontend lint, TypeScript, formatting, production build,
221 unit tests, six database-script checks and 51 relevant isolated browser checks
with retries disabled. Authentication, sidebar touch/keyboard dismissal, full-width
mobile header and page/pane scrolling are covered. See the
[verification report](../reviews/us-32.1-verification-2026-10-18.md) for failed-run
repairs, coverage and physical-device/full-suite/remote-CI limitations.

The working database was untouched. No push or deployment is claimed. EPIC-32
remains in progress; US-32.2 is recommended next.

## US-32.2 — Settings, dialogs and file-pane responsiveness

The user confirmed completion on 2026-10-18, authorizing commit and local merge
from `feat/us-32.2-settings-dialog-file-responsiveness`.

- [x] US-32.2: Make settings, dialogs and file panes fit their containers — confirmed complete. [Evidence](../reviews/us-32.2-verification-2026-10-18.md)
  - [x] Audit actual flex/grid minimums, SettingsCard, Theme Editor and file grid; use shrinkable content and container-based adaptation where appropriate.
  - [x] Define dialog height/scroll ownership and inspect every production dialog caller with long validation content.
  - [x] Preserve unrelated settings URL parameters through the shared search-param helper.
  - [x] Add browser tests at 320/390/768/1440px, 640px nested panes and short heights; verify hidden overflow and focused actions, not just scrollWidth.

Settings navigation and Theme Editor adapt to container width, unrelated URL
parameters survive section changes, file cards/actions/pagination fit narrow panes,
and dialogs expose scrollable content and close/footer controls. Tab keyboard
orientation follows the layout. Picker bodies reserve usable height while ordinary
workspace file panes shrink without overlapping their footer.

Verification passed: frontend lint/types, direct formatting checks, production build,
221 frontend tests, six auth database-script checks, backend lint/types/compileall,
437 backend tests, 30 root configuration checks, and the full isolated Chromium
suite with 72 passes and retries disabled. The root formatting wrapper's pnpm
no-TTY failure is distinguished from the passing direct formatting checks in the
[verification report](../reviews/us-32.2-verification-2026-10-18.md).

The working database was untouched. No push or deployment is claimed. EPIC-32
remains in progress; US-32.3 is recommended next.

## US-32.3 — Rich chat content and composer reachability

The user confirmed completion on 2026-10-18, authorizing commit and local merge
from `feat/us-32.3-rich-chat-reachability`.

- [x] US-32.3: Bound rich chat content and composer overlap — confirmed complete. [Evidence](../reviews/us-32.3-verification-2026-10-18.md)
  - [x] Define renderer-level wrapping and local scroll policies for tables, code, math, images and long tokens.
  - [x] Measure composer height or use flow layout so message clearance follows actual content instead of a fixed 150px reserve.
  - [x] Test long tool arguments, citations, attachments and sidebar/panel combinations using synthetic stress content.
  - [x] Add reachability assertions, screenshots and keyboard checks at mobile and nested desktop widths.

Conversation history and the bounded composer share normal flow. Wide Markdown
content scrolls locally, long text and filenames wrap, and response actions remain
reachable with expanded file context and a multiline draft. Loading, empty, error,
cached-refresh, streaming and file-scope states retain their intended behavior.

Verification passed: frontend lint/types, direct formatting checks, production build,
223 frontend tests, six auth database-script checks, backend lint/types/compileall,
437 backend tests, 30 root configuration checks, and 81 isolated Chromium tests
with retries disabled. The [verification report](../reviews/us-32.3-verification-2026-10-18.md)
separates initial failed runs and the root formatting wrapper limitation from
passing final checks.

The working database was untouched. No remote CI, push or deployment is claimed.
EPIC-32 is confirmed complete; EPIC-33 / US-33.1, repairing bundled palette
mappings and contrast, is recommended next.
