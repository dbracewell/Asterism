# EPIC-56: Inline user files in Markdown output

Status: proposed. Source: user request (2026-10-31). Groundwork for agents that create PowerPoint, Word, spreadsheet, PDF and image files.

## Objective

When an agent produces a file, or refers to one of the user's files, the user
should see it inline in the reply: an image displayed in place, a document as a
card with a preview and a download action. This must not weaken the Markdown
trust boundary from US-31.3.

## The constraint

The Markdown trust boundary ([markdown-content.md](../architecture/markdown-content.md))
blocks every automatic resource today, including same-origin images, and says
Markdown cannot turn an endpoint into an authenticated request. This epic keeps
that rule. **Markdown never carries a fetchable URL.** It carries an opaque file
reference. The server resolves that reference against the run's recorded file
scope when the message is saved. The renderer shows only references the server
resolved, and it fetches bytes only through the generated client and the
existing scoped chat-file routes.

## Ownership and delivery

- **Reference form.** A dedicated token, such as an `asterism-file:<uuid>` link
  target or a fenced directive, chosen in the ADR. It is not an HTTP URL, so
  the existing URL policy keeps blocking everything else.
- **Resolution at save time.** The chat domain parses references and checks each
  one against the execution's file scope (chat files, project files, and files
  produced in this run). It stores typed `MessageFileReference` records: file
  ID, role (`produced` or `referenced`), producing execution ID and
  display hints. Foreign, missing and out-of-scope IDs are stored as
  unavailable, the same as a missing ID, so nothing leaks.
- **Rendering.** The Markdown renderer maps a token to an `InlineFile` component
  that looks the file up in the message's resolved reference list. The raw ID
  in the text is never trusted on its own. Unresolved tokens render as an inert
  "file unavailable" label.
- **Produced files.** Tools write output through `FileStore` using an internal
  registration API. Each produced file becomes a chat file with
  `origin = agent`, provenance (agent, execution, tool, timestamp) and bounded
  size, and its type is detected from content (`filetype`), not trusted from
  the name. A produced file joins the chat's file scope so later turns can use
  it. Files produced by sub-agents belong to the parent chat. The user can add
  any produced file to a project explicitly.
- **Active content.** SVG and HTML are never rendered as live documents. SVG is
  rasterized server-side or displayed only through an image element from a
  response with a restrictive content type and a sandbox CSP
  (`Content-Security-Policy: sandbox`). Office and PDF previews are generated server-side as images or text.
- **Out of scope:** the tools that generate PowerPoint, Word or images. Those
  get their own epic once this display layer exists.

## US-56.1: Reference contract and ADR

As a maintainer, I want one safe way for messages to point at files.

Estimate: 1.5 days. Dependencies: none.

Acceptance: an ADR defines the token syntax, resolution rules, storage of
`MessageFileReference`, unavailable semantics and the update to the Markdown
trust policy. `markdown-content.md` is updated to describe the single allowed
file-reference path.

- [ ] Write the ADR and update the Markdown trust documentation.

## US-56.2: Produced-file registration

As an agent tool, I need to save a file into the user's chat with provenance.

Estimate: 2.5 days. Dependencies: US-56.1.

Acceptance: an internal service lets a tool register bytes as a produced chat
file. It records origin, execution, agent and tool, detects the content type,
and enforces size and count limits per run. Registration returns a reference
token for the tool result. It is not exposed as a user or model-facing upload
route.

- [ ] Add the `origin` and provenance columns and the registration service in the files domain.
- [ ] Enforce limits and content detection; return reference tokens in tool results.
- [ ] Test limits, type detection, provenance, sub-agent ownership and scope membership.

## US-56.3: Reference resolution at save time

As a user, I want only files I'm allowed to see to appear in replies.

Estimate: 2 days. Dependencies: US-56.1.

Acceptance: when an assistant message (or sub-agent output) is saved, its
references are resolved against the recorded scope and stored. Replay and
regeneration resolve again against live access, and deleted files render as
unavailable. The message API returns the resolved list; the client is
regenerated.

- [ ] Implement parsing and resolution in the chat domain; expose resolved references.
- [ ] Test foreign, missing, out-of-scope and deleted files, and identical 404 behavior.

## US-56.4: Inline images

As a user, I want generated and referenced images shown in the reply.

Estimate: 2 days. Dependencies: US-56.3.

Acceptance: resolved image references render inline at a bounded size, with alt
text from the token label or file name. Clicking opens a lightbox with download.
Bytes load through the scoped chat-file route only. SVG follows the active-content
rule. Browser tests confirm that no request goes to any other URL.

- [ ] Build `InlineFile` image rendering and the lightbox; implement SVG handling.
- [ ] Add adversarial browser tests (foreign IDs, URL-shaped tokens, script-bearing SVG).

## US-56.5: Document cards and previews

As a user, I want Word, PowerPoint, Excel and PDF outputs shown as rich cards.

Estimate: 3 days. Dependencies: US-56.3.

Acceptance: document references render as a card with type icon, name, size,
and page or slide count when known, plus Open and Download actions. The preview
shows a text excerpt from the existing MarkItDown conversion. Rendering
thumbnails of slides and pages is evaluated in the ADR: LibreOffice headless is
a heavy dependency, so it may be deferred.

- [ ] Build the document card and preview using cached conversions.
- [ ] Decide and document the thumbnail approach; test cards for each supported type.

## US-56.6: Model instructions and accessibility

As a user, I want agents to reference files correctly, and the result to work for everyone.

Estimate: 1.5 days. Dependencies: US-56.4, US-56.5.

Acceptance: the agent prompt layer explains the reference syntax only when
produced or scoped files exist. Tool results return ready-to-use tokens. Inline
files can be reached and opened by keyboard, have accessible names, and pass
axe checks. Copying a message replaces tokens with file names.

- [ ] Add the conditional prompt guidance and copy-text behavior.
- [ ] Add accessibility and keyboard tests.
