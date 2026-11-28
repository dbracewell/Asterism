# Canvas

This guide explains the canvas: a panel beside the chat where the main agent
writes and revises documents, code and web pages, the user edits them, and either
can download them. It covers how canvas items are stored and versioned, how they
follow the chat's branches, the agent tools, and how HTML previews are sandboxed.
Read it before changing the `canvas` domain, its tools or the canvas panel.

## Concepts

- **A canvas item** is one document, piece of code or HTML page in a chat. Its
  `kind` is `document`, `code` or `html`; code also has a `language`.
- **A version** is one immutable state of an item: its title, content, author
  (`agent` or `user`) and the message it belongs to. Versions are numbered 1, 2,
  3… per item and never rewritten or reused.
- **Visible on a branch** means a version belongs to the conversation the user is
  looking at. A chat can branch, so a version written on one branch must not
  appear on another.
- **Two switches.** Canvas writing needs both the admin's Canvas policy and the
  user's own Canvas setting to be on. Both are off by default.

## How it works

### Storage

Canvas lives in the relational database, not the file store
([ADR-0063](../adr/0063-canvas.md)):

- `canvas_items` holds each item's chat, owner, kind and language. A composite
  foreign key to `chats` keeps the owner and chat consistent.
- `canvas_versions` holds each version's number, title, content, author, the
  message it is anchored to and, for agent versions, the execution that wrote it.

Content is text, at most 256 KiB per version. A chat holds at most 50 items and an
item at most 200 versions; beyond those, the tools return an error. Storing canvas
in the database means that deleting a chat, a message or a user removes its canvas
content in the same transaction, by cascade.

### Following the chat's branches

Each version is anchored to a message:

- an **agent version** to the user message its run was answering, plus that run's
  execution;
- a **user edit** to the last message on the active branch when it was saved.

A version is visible on a branch when its anchor message is on the branch and, for
an agent version, its run produced a message on that branch or is the run in
progress. In practice:

- regenerating a turn hides the versions the replaced run wrote;
- editing an earlier message hides versions written after it on the old path;
- versions written during the current run are visible to its later tool calls.

An item is visible when any of its versions is, and its current version on a branch
is the highest-numbered visible one. The logic is in
[`canvas/branches.py`](../../apps/backend/asterism/domains/canvas/branches.py).

### The agent's tools

Three internal tools let the main agent work with the canvas. They are offered only
to the main agent, only in ordinary chats, only when both switches are on and the
model supports tools ([tool authorization](tool-authorization.md#the-internal-tools)).
Every call checks both switches and the chat's ownership again.

| Tool                                               | Does                                                                                                                                                                                | Returns                                        |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| `canvas_create(kind, title, content, language?)`   | Starts an item with version 1                                                                                                                                                       | The item ID, version, kind, language and title |
| `canvas_update(item_id, title?, content?, edits?)` | Writes a new version from the item's current version on the run's branch: either full `content`, or up to 50 `edits`, each a `{find, replace}` whose `find` must occur exactly once | The item ID, new version and title             |
| `canvas_read(item_id?)`                            | Without an ID, lists the visible items with their current versions and sizes; with an ID, returns that item's current content                                                       | Metadata or content                            |

Results carry IDs and version numbers rather than the content written, so the stored
tool results link each message to the versions it produced. The runtime prompt layer
lists the visible items, so the agent knows what exists. Canvas content is task data:
it grants no tools, files or sub-agents, and the platform rules tell the model so.

### What the user can do

- **Read** items and versions (`GET /chat/{chat_id}/canvas`,
  `…/canvas/{item_id}`, `…/versions/{number}`). Reading works even when canvas is
  switched off, so existing content stays reachable.
- **Edit** an item, which saves a new `user` version
  (`POST …/canvas/{item_id}/versions`).
- **Restore** an earlier version, which copies it into a new version
  (`POST …/versions/{number}/restore`). History is never rewritten.
- **Start an item** themselves (`POST /chat/{chat_id}/canvas`), from the composer's
  Canvas chip. A chat needs a message first, because the item is anchored to it.
- **Ask about a selection,** which sends an ordinary chat message quoting the
  selected text with the item's ID and version. It grants nothing a typed message
  couldn't.

Edits and restores need both switches on and name the `base_version` they started
from. If the agent has written a newer version on that branch meanwhile, the save is
refused with a 409, so a user edit never silently overwrites the agent's work, or the
other way round.

### Downloads

Downloads are built on the server from one version visible on the active branch, and
work while canvas is switched off:

| Kind      | Formats                                     |
| --------- | ------------------------------------------- |
| Document  | Markdown, plain text, Word (`docx`), PDF    |
| Code      | The language's own extension, or plain text |
| HTML page | HTML, or plain text                         |

`GET /chat/{chat_id}/canvas/export` downloads every visible item at its current
version as a zip. `POST …/versions/{number}/library` saves an export to the user's
file library through the normal upload path, so it is processed like any upload.

Word and PDF files are rendered from Markdown with raw HTML and images turned off,
so an export never embeds markup or fetches a URL from canvas content. The one
picture they can hold is a drawn mermaid diagram
([ADR-0082](../adr/0082-diagrams-in-canvas-exports.md)): before a Word or PDF
export, `downloads.draw_export_diagrams` draws the document's distinct mermaid
fences (at most 30, within 60 seconds) with `domains/canvas/diagrams.py` in the
shared headless Chromium, offline with every request refused. The writers place
each as a PNG fitted to the page, with the diagram's name and description as alt
text; one that wasn't drawn is written as code after "Diagram not drawn". In PDF
only top-level fences become pictures; a fence inside a list or quote stays code.
Markdown, text, the ZIP and Download my data keep the source. PDF uses
DejaVu Sans for Unicode text. Downloads are sent as attachments with `nosniff` and a
sandboxing security policy, so an exported HTML page opened from the API stays inert.

### Previewing HTML safely

HTML is never inserted into the app's own page. The panel shows it in an `iframe`
with `sandbox="allow-scripts"`: no same-origin access, no popups, forms or top-level
navigation. The frame loads
[`public/canvas-preview.html`](../../apps/frontend/public/canvas-preview.html), whose
security policy allows only inline script and style and `data:`/`blob:` media, so
the page can't fetch anything. The panel posts the page into the frame once it has
loaded.

The frame has to be a separate document rather than a `srcdoc` frame, because a
`srcdoc` frame inherits the app's own nonce-based security policy, which would block
the canvas page's inline scripts ([ADR-0071](../adr/0071-edge-hardening.md)). This is
the one frame the app's policy allows.

## Settings

| Setting                       | Where                                                                        | Default |
| ----------------------------- | ---------------------------------------------------------------------------- | ------- |
| Admin policy `canvas_enabled` | Admin Settings → Canvas (`GET`/`PUT /settings/app/canvas`)                   | Off     |
| User setting `canvas_enabled` | User Settings → General, disabled with an explanation when the policy is off | Off     |

`GET /availability` reports the admin policy as `canvas`, so the interface can say
why canvas is unavailable. Turning either switch off stops writing at once;
reading and downloading keep working.

## Rules

- Versions are immutable and their numbers are never reused.
- A version is visible only on the branch it belongs to.
- Only the main agent writes to the canvas, and only with both switches on.
- A save names its base version and never overwrites a newer one.
- Canvas content grants nothing, and HTML runs only in a sandboxed, network-less
  frame.

## Where the code lives

1. [`canvas/models.py`](../../apps/backend/asterism/domains/canvas/models.py): items and
   versions.
2. [`canvas/branches.py`](../../apps/backend/asterism/domains/canvas/branches.py): the
   visibility rule.
3. [`canvas/service.py`](../../apps/backend/asterism/domains/canvas/service.py): writes,
   edits and restores.
4. [`tools/builtin/canvas.py`](../../apps/backend/asterism/domains/tools/builtin/canvas.py):
   the agent tools.
5. [`canvas/exports.py`](../../apps/backend/asterism/domains/canvas/exports.py) and
   [`canvas/downloads.py`](../../apps/backend/asterism/domains/canvas/downloads.py):
   downloads. Each format has its own module:
   [`export_docx.py`](../../apps/backend/asterism/domains/canvas/export_docx.py) and
   [`export_pdf.py`](../../apps/backend/asterism/domains/canvas/export_pdf.py), sharing
   [`export_markdown.py`](../../apps/backend/asterism/domains/canvas/export_markdown.py).
6. [`features/canvas/`](../../apps/frontend/src/features/canvas/): the panel and the
   preview frame.

## Related

- [ADR-0063](../adr/0063-canvas.md): canvas
- [ADR-0071](../adr/0071-edge-hardening.md): the preview frame and the page policy
- [Markdown and file-content trust](markdown-content.md)
