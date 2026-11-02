# ADR-0039 — Inline file references in Markdown output

Status: accepted for US-56.1 on 2026-11-02. Implemented by US-56.2 through US-56.6
([EPIC-56](../epics/EPIC-56-INLINE-USER-FILES-IN-MARKDOWN-OUTPUT.md)).

## Context

Agents will produce files (images, slides, documents) and refer to the user's
existing files. Users should see those files in the reply: images shown in place,
documents as cards. Today the [Markdown trust boundary](../architecture/markdown-content.md)
(US-31.3) blocks every automatic resource, including same-origin images, and says
Markdown cannot turn an endpoint into an authenticated request. That rule stays.

What exists today:

- `user_files` rows are owned by one user. Bytes live in `FileStore` behind an
  opaque `storage_key`. Type is detected with `filetype`, falling back to the
  filename, and `FileKind` decides conversion. `content_cache` holds the
  MarkItDown text conversion. Image kind covers BMP, GIF, JPEG, PNG and WebP only.
- A chat's file scope (`resolve_chat_file_scope`) is the project's files plus
  local files that are both `chat_files` members and attached to a user message on
  the active branch. Runs get a static `ExecutionScope.allowed_file_ids` and a
  live recheck (`read_execution_files`) before every read.
- The scoped routes `GET /chats/{chat_id}/files/{file_id}/info` and
  `GET /chats/{chat_id}/files/{file_id}` return the same 404 for a missing,
  foreign or out-of-scope file. Downloads are `Content-Disposition: attachment`,
  `Cache-Control: private, no-store`.
- Messages already carry `files: list[MessageFileReference]`: the user's
  **attachments**. The message API recomputes their `available` flag against
  live scope on every read. Deleting a file removes its `chat_files` rows but
  keeps message snapshots, so the attachment renders as unavailable.

## Decision

### 1. Reference syntax

A file reference is a Markdown link or image whose destination is exactly:

```
asterism-file:<uuid>
```

`<uuid>` is a canonical lowercase UUID (8-4-4-4-12 hex). Nothing may follow it:
no path, query, fragment, whitespace or title. Both sides use the same grammar:

```
^asterism-file:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$
```

| Form                                  | Meaning                                                                      |
| ------------------------------------- | ---------------------------------------------------------------------------- |
| `![Quarterly chart](asterism-file:…)` | **Embed.** Images display inline; documents render as a card.                |
| `[the slide deck](asterism-file:…)`   | **Mention.** An inline chip with the label; activating it opens the preview. |

The bracket text is the **label**. It is used as alt text and the chip text,
trimmed and capped at 200 characters. An empty label falls back to the file name.

Why a link scheme and not a fenced directive: it uses syntax models already
produce, survives every Markdown parser as a single node, degrades to readable
text in plain-text views, and needs no extra parser plugin. It is not an HTTP
URL, so the existing URL policy keeps blocking everything else. A destination
that is almost a token (`asterism-file://…`, uppercase hex, trailing `?x`,
`https://…/asterism-file:…`) is not a token; it gets the ordinary link/image
treatment, which means it is blocked.

Tokens inside inline code and fenced code are literal text and never resolve on
the client.

### 2. Resolution at save time

The chat domain resolves references when it persists:

- an assistant step's `content` (final step and every intermediate step), and
- a sub-agent's `DelegationRecord.output`.

The server scans the text with the grammar's UUID pattern (`asterism-file:` +
UUID), not with a Markdown parser. It may therefore also resolve a token that
sits in a code span. That superset is safe: resolution only ever confirms files
already in scope, and the client renders only link/image positions. It avoids
keeping two Markdown parsers in agreement.

The **resolution scope** for a save is:

```
(recorded ExecutionScope.allowed_file_ids ∩ live execution files)
  ∪ files produced in this execution tree that are visible to this execution
```

The live part is the existing `read_execution_files` recheck. A sub-agent's
output resolves against its own narrowed scope, not the parent's.

At most **32 distinct file IDs** resolve per saved text, in order of first
occurrence. Later IDs are stored as unavailable.

### 3. Storage

The existing `MessageFileReference` name stays with user attachments. Inline
references use a new type, `InlineFileReference`, stored as JSON:

- `messages.inline_files: list[InlineFileReference]` (assistant messages), and
- `DelegationRecord.inline_files: list[InlineFileReference]` (sub-agent output).

| Field                               | Meaning                                                                      |
| ----------------------------------- | ---------------------------------------------------------------------------- |
| `file_id`                           | The referenced UUID, as written.                                             |
| `role`                              | `produced` (made in this execution tree) or `referenced` (an existing file). |
| `producing_execution_id`            | The execution that registered a produced file; `null` for `referenced`.      |
| `available`                         | Whether it resolved at save time.                                            |
| `name`, `mime_type`, `kind`, `size` | Display hints snapshotted at save. **Only set when `available`.**            |

An ID that did not resolve stores only `file_id` and `available = false`. No
name, type or size is ever recorded or returned for it, so a foreign or guessed
ID reveals nothing that a missing ID would not.

### 4. Unavailable semantics and live recheck

There is one unavailable state, used for foreign, missing, out-of-scope, deleted,
over-limit and no-longer-scoped files. The API and the UI never distinguish the
reasons.

Saved resolution is not trusted forever. When the message API returns messages
it recomputes `available` for every inline reference against the live chat file
scope, as it already does for attachments. A reference that is no longer in
scope keeps its saved display hints (the user already saw them) and becomes
unavailable. Fetching bytes or info still goes through the scoped routes, so a
stale client flag cannot reach a revoked file: the route returns the same 404.

Replay and resume re-resolve against live access when they save. Regeneration and
forks create new messages and resolve from scratch.

### 5. Rendering

`MarkdownViewer` takes the message's resolved list as a prop. The URL transform
recognises the token grammar and maps link/image nodes with a token destination
to an `InlineFile` component. Nothing else changes:

- The raw ID in the text is never trusted on its own. `InlineFile` looks the ID
  up in the resolved list. Not found, or `available = false`, renders an inert
  "File unavailable" label with the Markdown label text. No request is made.
- A token is never placed in `href` or `src`. Bytes load only through the
  generated client's `chatFileDownload` and metadata through `chatFileGetInfo`,
  as blobs scoped to the message's chat. No other URL is fetched.
- During streaming the resolved list does not exist yet. Tokens render as an
  inert pending label until the saved message arrives.
- Copying a message replaces each token with its label, or the file name when
  the label is empty.
- Every other surface that renders Markdown without a resolved list (study
  tools, notes, harnesses) passes an empty list, so tokens there are inert.

### 6. Produced files

Tools register output through an internal service in the files domain. It is
not an HTTP route and not a model-facing tool; the model cannot upload bytes.

- The file becomes a normal `user_files` row owned by the chat's user, with
  `origin = agent` (uploads are `origin = upload`) and provenance columns:
  `produced_chat_id`, `produced_execution_id`, `produced_agent_id`,
  `produced_tool`. Creation time is the timestamp. Provenance is historical: it
  is not a foreign key, and deleting the chat leaves the file in the library.
- Type is detected from content (`filetype`, plus a narrow SVG sniff), never
  from the tool-supplied name. The name is sanitized and de-duplicated like an
  upload, and its extension must match the detected type or it is replaced.
- Limits per run (top-level execution tree): at most 20 produced files and
  100 MiB in total, each within `max_upload_file_size_bytes`. Exceeding a limit
  fails the registration with a tool error; nothing partial is stored.
- Registration adds a `chat_files` membership and returns the token
  (`asterism-file:<uuid>`) and a ready-made embed string in the tool result.
- **Visibility during the run.** The produced ID joins a run-local produced set
  on the execution tree. The producing execution and its ancestors may read and
  reference it. A sub-agent's produced files belong to the parent chat and
  become visible to the parent when its delegation returns. Siblings and
  descendants do not gain them.
- **Visibility after the run.** `role = produced` entries on active-branch
  assistant messages (and their delegation records) join the chat file scope,
  next to attachments on user messages. A produced file is therefore
  branch-local, like an attachment: switching to a branch that did not produce
  it removes it from scope. The user can add any produced file to a project
  explicitly.

### 7. Active content

- **SVG** is shown only as an `<img>` whose source is a `blob:` URL created from
  the scoped download. Browsers do not run scripts or load external resources in
  SVG used as an image. SVG is never inlined into the DOM, put in an `iframe`,
  `object` or `embed`, or opened by navigation. SVG stays out of the vision
  allowlist. Server-side rasterization is not needed for this rule.
- **HTML** and other markup files are never rendered. They show as a document
  card with a text excerpt.
- All scoped chat-file responses add `X-Content-Type-Options: nosniff` and
  `Content-Security-Policy: sandbox; default-src 'none'`, and stay
  `Content-Disposition: attachment`. A direct navigation to a download is
  inert even if it were somehow opened in a tab.
- Inline image display uses the existing raster image allowlist plus SVG.

### 8. Document previews and thumbnails

Document cards show type icon, name, size, page or slide count when the
conversion reports it, and a text excerpt from the existing MarkItDown
`content_cache`. Open shows the existing scoped plain-text file view; Download
uses the scoped route.

Page and slide thumbnails are **deferred**. LibreOffice headless is a large
runtime dependency with its own sandboxing needs; a PDF-only rasterizer would
cover one type of four. Revisit when the generation-tools epic needs thumbnails.

### 9. Model guidance

The prompt layer explains the syntax only when the run has scoped or produced
files (US-56.6). The guidance grants nothing; resolution is the only authority.

## Consequences

- The Markdown trust boundary keeps one rule: Markdown never carries a fetchable
  URL. File display is a separate, server-resolved path.
- A model can write any UUID. That gets the same inert label as a typo.
- `messages` and `DelegationRecord` gain `inline_files`; `user_files` gains
  `origin` and provenance columns. Per project policy these are schema changes
  with fresh initialization, not migrations.
- Produced files appear in the user's file library like uploads, labelled by
  origin.
- Two chat-file response headers change; existing attachment previews already
  load through blobs and are unaffected.

## Alternatives considered

- **Signed or same-origin URLs in Markdown.** Rejected: it reopens the
  authenticated-resource path US-31.3 closed, and the URL survives copy/paste.
- **Fenced directive (` ```asterism-file `).** Rejected: block-only, cannot sit
  in a sentence, and needs a custom parser on both sides.
- **Resolving at render time only.** Rejected: the client would have to probe IDs
  one by one, and a probe pattern becomes an existence oracle. Save-time
  resolution plus a live availability flag keeps one 404 shape.
- **Reusing `MessageFileReference`.** Rejected: attachments and inline references
  have different roles, provenance and placement; one list would blur which
  files the user supplied.
