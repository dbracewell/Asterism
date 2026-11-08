# EPIC-72: Canvas

Status: proposed. Source: user request (2026-11-08).

## Objective

Add a canvas, similar in purpose to Gemini's Canvas: a side panel beside the chat
where the agent creates and revises documents and code, the user edits them
directly, and either can download them as files. It is off by default; users turn
it on in their settings.

## Ownership and delivery

- Opt-in at two levels: an admin policy (`canvas_enabled`, default off) and a
  per-user setting (default off). `canvas` tools are internal, like
  `sub_agent`: offered only when both are on and the model has explicit tool support.
- A canvas item belongs to one chat (and its owner), has a type (document,
  code with language, HTML), a title and a linear list of versions. Each version
  records whether the agent or the user made it and which message it came from.
- The agent gets `canvas_create`, `canvas_update` (full replace or targeted
  edits) and `canvas_read`. Canvas content in prompts is untrusted text and
  grants nothing.
- Storage reuses the file store abstraction for content; downloads come from the
  backend. HTML previews render in a sandboxed iframe with no same-origin
  access and no network; never inline into the app DOM.
- Exports: Markdown, plain text and source files at first; DOCX and PDF for
  documents in a later story.
- Forks and branches: a canvas version created on one branch is visible on
  branches that include its message. Record the rule in the ADR.

## US-72.1: Canvas domain and agent tools

As a user, I want the agent to put long documents and code in a canvas instead of the chat.

Estimate: 3 days. Dependencies: none.

Acceptance: canvas items and versions are stored per chat with owner checks;
agent tools create, read and update them; messages link to the version they
produced; admin policy and the user setting gate the tools live. Deleting the
chat deletes its canvas content.

- [ ] Write the ADR (data model, tool contracts, branch rules, sandboxing, exports).
- [ ] Implement storage, tools and settings; regenerate the client.
- [ ] Tests: gating, owner isolation, versions, branch visibility, deletion.

## US-72.2: Canvas panel

As a user, I want to see, edit and compare canvas versions next to the chat.

Estimate: 3 days. Dependencies: US-72.1.

Acceptance: a resizable side panel (full-screen sheet on mobile) opens from a
canvas card in the message. It shows a Markdown editor/preview for documents,
a code editor with highlighting for code, and a sandboxed preview for HTML.
User edits save as new versions; the agent sees the latest version next turn.
Version history allows viewing and restoring. Selecting text and asking the agent
to change it sends a targeted request.

- [ ] Build the panel, editors, history and "ask about selection".
- [ ] Unit tests, keyboard/contrast checks and an E2E with a fake provider.

## US-72.3: Downloads and settings

As a user, I want to download what's in the canvas and decide whether to use it at all.

Estimate: 2 days. Dependencies: US-72.2.

Acceptance: download any version as its natural file type (`.md`, `.txt`,
source extension, `.html`), DOCX and PDF for documents, and a ZIP of all items in
a chat. Users can save a version to their file library. User Settings has the
canvas toggle; Admin Settings has the policy. Help covers canvas.

- [ ] Implement exports (server-side) and save-to-library.
- [ ] Settings toggles, help and glossary; tests for each export type.
