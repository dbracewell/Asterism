# EPIC-107: Images in the canvas

Status: in progress (2026-11-25); US-107.1 merged; US-107.2 implemented. Source: user request (2026-11-25): "In canvas mode
markdown cannot display created images."

## Objective

An image made or attached in a chat shows as a picture in that chat's markdown
canvas, as it does in a reply, and comes with the document when it is
downloaded. The same rule as chat replies applies: the ID in the text grants
nothing, and only a file in the chat's live file scope is shown.

Out of scope: an image picker or upload in the canvas editor (people and the
agent write the `asterism-file:` reference); images in HTML canvases (the
sandboxed preview loads nothing); images from outside the chat (web URLs stay
"Image omitted").

## Where things stand (verified 2026-11-25)

- Replies embed files as `![description](asterism-file:<id>)` (ADR-0039).
  `generate_image` hands the agent exactly that Markdown (ADR-0064). The backend
  resolves each saved message's references into `inline_files` when it is saved,
  and rechecks them against the live chat scope on every read.
  `MarkdownViewer` shows a file only through `InlineFilesContext`, which carries
  the chat ID and that resolved list.
- The canvas preview (`canvas-panel.tsx`) renders `<MarkdownViewer content={value} />`
  without a provider. The default context has no chat ID and no files, so every
  reference shows "File unavailable", including images the same run just made.
- Canvas versions (`canvas_versions`) store only text. `CanvasVersion` has no
  resolved references, and people can edit or restore versions, so resolving
  when the agent saves would not cover every version.
- Generated images are in the chat's live file scope: `resolve_chat_file_scope`
  includes every file a chat run produced (`domains/chat/scope.py`), plus chat
  attachments and project files.
- Exports parse Markdown with images disabled (`exports.py`), so DOCX and PDF
  drop the image. Markdown and text downloads keep a token that means nothing
  outside Asterism.
- `CANVAS_GUIDANCE` does not tell the agent it can put images in a canvas.

## Decisions

- **Resolve when read, not when saved.** Every canvas version response
  (`CanvasVersion`) gains `inline_files`. These are resolved against the chat's
  live file scope for the owner, in order of first occurrence, with at most 32
  distinct IDs, reusing ADR-0039's reference shape and its unavailable entry.
  This covers agent versions, edits and restores alike, and a file removed from
  the chat stops showing at once. A canvas is visible only to its owner, so
  there is no run ceiling to apply: the owner can already open every file in
  scope. No schema change.
- **The preview uses the reply's renderer.** The canvas preview provides
  `InlineFilesContext` with the chat ID and the version's resolved list, so
  images, document cards and file chips behave as they do in replies. Bytes
  still come only through the scoped chat-file routes. A reference typed into
  unsaved edits shows "File unavailable" until the version is saved, because
  the resolved list belongs to a saved version.
- **The agent is told.** `CANVAS_GUIDANCE` says a markdown canvas can embed an
  image from this chat with the same `asterism-file:` Markdown as a reply.
- **Exports carry the picture.** DOCX and PDF embed raster images
  (PNG, JPEG, GIF, WebP, BMP) from the live scope, fitted to the text width,
  with the description as alt text. They use the same per-export count and size
  limits as replies' inline images. SVG, anything over a limit and unavailable
  files export as an italic "Image not included: <description>". Markdown and
  text downloads replace each token with that description. The chat's ZIP adds
  the images in an `images/` folder and links them relatively.

## User stories

### US-107.1: Show chat images in the canvas preview

- [x] ADR-0083: read-time resolution for canvas versions, the scope rule and
      limits, and why there is no run ceiling
- [x] `CanvasVersion.inline_files` on every version response (read, create,
      save, restore), resolved by `resolve_in_live_scope`, which shares the
      reference building with reply resolution; client regenerated
- [x] The canvas preview provides `InlineFilesContext`; unsaved references stay
      unavailable until saved
- [x] Tests:
      - backend (`test_canvas_inline_files.py`): a generated image and an
        attachment resolve; library-only, foreign, other-chat and missing IDs
        are bare; a deleted file turns bare; a saved edit resolves; the limit
      - frontend: the preview shows the resolved image and leaves the other
        reference unavailable
      - E2E (`canvas.spec.ts`): at 320 px the image loads only through the
        scoped route, fits the sheet, opens full size and passes axe
- [x] Docs: the canvas guide page, ADR-0063 cross-reference, release notes (Behavior)

### US-107.2: Tell the agent it can put images in a canvas

- [x] `CANVAS_GUIDANCE` names the `asterism-file:` image Markdown for a
      markdown canvas and the `embed` from `generate_image`;
      `IMAGE_GUIDANCE` no longer forbids repeating ids, only repeating the
      image in the reply. Guidance test in `test_canvas_inline_files.py`
- [x] `canvas_create`, `canvas_update` (edits) and `canvas_read` keep the
      reference unchanged, and the version API resolves it (test)
- [ ] Check in the running app that "make an image, then a canvas document
      using it" shows the picture (by the user; see the PR)

### US-107.3: Images in canvas downloads

- [ ] DOCX and PDF embed in-scope raster images with alt text, fitted to the
      page; everything else exports as "Image not included: <description>"
- [ ] Markdown and text downloads replace tokens with the description; the
      chat ZIP includes the images under `images/` with relative links
- [ ] Save to Files uses the same path; Download my data keeps the stored text
- [ ] Tests for each format, the limits, a foreign file ID and SVG; ADR-0083,
      canvas guide page and release notes
