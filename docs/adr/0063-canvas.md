# ADR-0063 — Canvas items are versioned, branch-aware chat records

Status: accepted; domain and agent tools in US-72.1, panel and user edits in
US-72.2, downloads and settings in US-72.3, user-started items in US-72.4 on
2026-11-09
([EPIC-72](../epics/EPIC-72-CANVAS.md)).

## Context

EPIC-72 adds a canvas: a panel beside the chat where the agent writes and
revises documents and code, the user edits them, and either can download them.
Chats branch (edits, regeneration, forks), so a canvas must not show a version
written on a branch the user has left. The feature is opt-in at two levels and
must grant nothing through its content.

## Decision

### Data model

- `canvas_items`: `id`, `chat_id`, `user_id`, `kind` (`document`, `code`,
  `html`), `language` (required for `code`, else empty), `created_at`. The
  composite foreign key (`chat_id`, `user_id`) to `chats` keeps owner and chat
  consistent; deleting the chat or the user deletes its items.
- `canvas_versions`: `item_id`, `number` (1, 2, … per item, never reused),
  `title`, `content`, `author` (`agent` or `user`), `message_id`,
  `execution_id`, `created_at`. Versions are immutable.
- Content is UTF-8 text of at most 256 KiB per version, stored in the
  relational database. An item keeps at most 200 versions and a chat at most
  50 items; beyond that the tools return an error.

The epic suggested storing content through the file store. Canvas content is
small, text-only and must disappear with its chat and messages; database rows
get that from foreign-key cascades in the same transaction, while file bytes
would need a separate cleanup path for chat, message and user deletion. The
file store is still used when a version is saved to the file library
(US-72.3).

### Branch rule

A version is anchored to a message: for agent versions, the run's request
(user) message, plus the run's `execution_id`; for user edits (US-72.2), the
last message on the active branch when the edit was saved, with no execution.

A branch is the list of messages from the root to its leaf. A version is
**visible on a branch** when its anchor message is on the branch and, for an
agent version, its execution produced a message on that branch or is the run
in progress (the request message's pending execution). So:

- a regenerated turn hides versions written by the run it replaced;
- an edited earlier message hides versions written after it on the old path;
- versions made in the current run are visible to its later tool calls.

An item is visible when any of its versions is. Its current version on a
branch is the highest-numbered visible version. Deleting a message deletes the
versions anchored to it.

### Agent tools

Three internal, context-managed tools: `canvas_create`, `canvas_update` and
`canvas_read`. They are offered to the **main agent only**, in ordinary chats
(not skill-drafting chats), when the admin policy `canvas_enabled` and the
user's `canvas_enabled` setting are both on and the run's model has
`supports_tools=True`. Like `load_skill` (ADR-0062), their admin gate is their
own policy rather than the Tools allowlist, and they are not listed among
admin tools. Every call rechecks both switches and the chat's ownership live.
Sub-agents do not get canvas tools in this version.

- `canvas_create(kind, title, content, language?)` → `{item_id, version,
  kind, language, title}`.
- `canvas_update(item_id, title?, content?, edits?)`: exactly one of
  `content` (full replace) or `edits` (each `{find, replace}`, where `find`
  must occur exactly once in the current visible version). The base is the
  item's current version on the run's branch. → `{item_id, version, title}`.
- `canvas_read(item_id?)`: without an id, the visible items with their current
  version and size; with an id, that item's current content.

Results carry ids and version numbers, not the content written, so the
persisted tool results are the link from a message to the versions it
produced. The runtime prompt lists the visible items (id, title, kind,
version) so the agent knows what exists. Canvas content is untrusted task
data: it can't grant tools, files or delegation, and the platform rules say so.

### Reading API

`GET /chat/{chat_id}/canvas` lists items visible on the chat's active branch;
`GET /chat/{chat_id}/canvas/{item_id}` returns the visible versions' metadata
and `GET …/versions/{number}` one version's content. Reads are owner-scoped and
work while canvas is switched off, so existing content stays reachable; only
writing is gated.

### User edits and restores (US-72.2)

`POST /chat/{chat_id}/canvas/{item_id}/versions` (`{base_version, content,
title?}`) saves the user's edit as a new `user` version, and
`POST …/versions/{number}/restore` (`{base_version}`) copies an earlier visible
version's title and content into a new one; history is never rewritten. Both
need canvas on (both switches) and anchor to the last message on the active
branch, so the agent's next turn, a child of that message, sees them.
`base_version` must be the item's current version on that branch, else 409: an
edit never silently overwrites a version the agent wrote meanwhile.

`POST /chat/{chat_id}/canvas` (`{kind, title, language?, content?}`, content
empty by default) starts an item as the user (US-72.4), with the same switches
and anchor as an edit, so a chat needs a message first. The composer's Canvas
chip lists the items on the active branch, since a user-started item has no
tool-result card, and offers "New canvas item".

"Ask about selection" is a client feature: it sends an ordinary chat message
that quotes the selected text with the item's id and version and asks for a
targeted `canvas_update`. It grants nothing a typed message couldn't.

### Settings

`canvas_enabled` is a strict-boolean application setting (default off) with
admin endpoints `GET/PUT /settings/app/canvas`. Each user has a boolean
`canvas_enabled` setting (default off), and `GET /settings/user` reports
`canvas_allowed` (the admin policy) so the UI can explain why it's off.

### Downloads and the file library (US-72.3)

Exports are made on the server from one stored version visible on the active
branch, and work while canvas is switched off:

- `GET …/versions/{number}/export?format=` with `md`, `txt`, `docx` or `pdf`
  for documents, `source` (the extension for the item's language, else `.txt`)
  or `txt` for code, and `html` or `txt` for HTML pages. Other combinations
  return 400.
- `GET /chat/{chat_id}/canvas/export` is a ZIP of every visible item at its
  current version in its natural type, with repeated names numbered.
- `POST …/versions/{number}/library` (`{format}`) adds the export to the
  user's file library through the files domain (sanitized, deduplicated name,
  upload size limit, knowledge processing queued after commit).

Downloads carry `Content-Disposition: attachment` with a UTF-8 name, and the
file-store response headers (`nosniff`, `sandbox` CSP), so an HTML export
opened from the API origin stays inert.

DOCX (python-docx) and PDF (fpdf2) are rendered from Markdown parsed with
markdown-it with raw HTML **and images disabled**, so no export embeds markup
or fetches a URL from canvas content. PDF uses DejaVu Sans
(`fonts-dejavu-core` in the image) for Unicode text; without a Unicode font it
falls back to the Latin-1 core fonts and replaces other characters. Layout
runs in a worker thread.

The user's `canvas_enabled` toggle is in User Settings → General (disabled,
with an explanation, when the admin policy is off); Admin Settings → Canvas
holds the policy.

### Sandboxing

HTML is never inlined into the app DOM. The panel (US-72.2) previews it in an
`iframe` with `sandbox="allow-scripts"` (no `allow-same-origin`, popups, forms
or top navigation) and `srcdoc` content, prefixed with a CSP `<meta>` that
allows only inline script and style and `data:`/`blob:` media
(`default-src 'none'`), so the page can't fetch anything. Links target a new
window, which the sandbox refuses. A script can still navigate its own frame;
that page also loads in the opaque, sandboxed origin with no access to the
app.

## Consequences

- Canvas history follows the conversation the user is looking at.
- Deleting a chat, a message or a user removes the matching canvas content in
  the same transaction.
- One admin switch and one user switch turn canvas writing off immediately.
