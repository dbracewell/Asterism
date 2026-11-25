# ADR-0083 — Images in the canvas

Status: accepted. Read-time resolution and the canvas preview (US-107.1) and
the agent guidance (US-107.2) are implemented (2026-11-25)
([EPIC-107](../epics/EPIC-107-IMAGES-IN-CANVAS.md)).

## Context

Replies embed chat files as `![description](asterism-file:<id>)` (ADR-0039),
and `generate_image` hands the agent exactly that Markdown (ADR-0064). A reply's
references are resolved when the message is saved and rechecked against the
live chat scope on every read. The viewer shows a file only through that
resolved list; the ID in the text grants nothing.

Canvas versions (ADR-0063) store only text, and their preview had no resolved
list, so every reference, including an image the same run had just made,
showed "File unavailable". Save-time resolution, as for messages, would not
cover canvas versions well: people write and restore versions too, and a
version is read long after it is written.

## Decision: resolve canvas references when a version is read

- Every `CanvasVersion` response (read, create, user save and restore) carries
  `inline_files`, resolved from its content by
  `chat.inline_files.resolve_in_live_scope`. It uses the same reference shape
  and the same bare unavailable entry as ADR-0039, and the same limit of 32
  distinct IDs per text, in order of first occurrence.
- A reference is available while the file is in the chat's **live file scope**
  (`resolve_chat_file_scope`): the chat's attachments, files produced by the
  chat's runs, and the project's files. Anything else (another chat's file, a
  library-only file, another person's file, a missing ID) is indistinguishable.
- There is no run ceiling, unlike reply resolution: canvas versions are read
  only by the chat's owner, who can already open every file in scope through
  the scoped chat-file routes, and either the owner or the agent may have
  written the text.
- Nothing is stored, so there is no schema change, and a file removed from the
  chat stops showing on the next read. The `canvas_read` tool still returns
  only the text.

## Decision: the preview uses the reply's renderer

The canvas preview provides `InlineFilesContext` with the chat ID and the
version's `inline_files`, so images, document cards and file chips behave as
they do in replies, and bytes still come only through
`GET /chat/{chat_id}/files/{file_id}`. A reference typed into unsaved edits
shows "File unavailable" until the version is saved, because the resolved list
belongs to a saved version. HTML canvases are unchanged: their sandboxed
preview loads nothing.

## Consequences

- Each version read runs one live-scope query and one file query when the
  content has references; content without references costs nothing extra.
- DOCX and PDF downloads embed them (US-107.3).

## Decision: the agent is told (US-107.2)

`CANVAS_GUIDANCE` says a markdown canvas can hold images and files from the
conversation as `![short description](asterism-file:<file id>)`, such as the
`embed` that `generate_image` returns, and that other ids show as unavailable.
`IMAGE_GUIDANCE` now asks the agent not to repeat generated images in its
reply, rather than never to repeat their ids, so the two don't conflict. The
canvas tools store references as written; the guidance grants nothing.
