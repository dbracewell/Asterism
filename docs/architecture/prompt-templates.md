# Prompt templates — US-51.1 through US-51.3

Private template CRUD and the bundled, read-only framework catalog are
implemented in the `prompt_templates` backend domain. The composer's template
builder (US-51.2), slash discovery and message provenance (US-51.3) are
implemented. The editor and scaffolding levels are later
[EPIC-51](../epics/EPIC-51-PROMPT-FRAMEWORKS-AND-TEMPLATES.md) stories.

The document format, bounds, placeholder grammar, assembly semantics and catalog
versioning are decided in
[ADR-0026](../adr/0026-prompt-template-documents-and-framework-catalog.md).

## APIs

All routes require authentication. Only the owner can read or change a template.
Foreign and missing IDs return the same 404 body.

| Route                                               | Contract                                                         |
| --------------------------------------------------- | ---------------------------------------------------------------- |
| `GET /prompt-templates/frameworks`                  | `{version, items}`: every bundled framework with its document    |
| `GET /prompt-templates/frameworks/{id}`             | One framework, 404 if unknown                                    |
| `GET /prompt-templates/`                            | Owner-scoped metadata page; `query`, `page`, `page_size` (1–100) |
| `POST /prompt-templates/`                           | Create from `{document}`, 201 with the full template             |
| `GET /prompt-templates/{id}`                        | Full template including `document`                               |
| `PUT /prompt-templates/{id}`                        | Replace `{document, expected_revision}`                          |
| `DELETE /prompt-templates/{id}?expected_revision=N` | Revision-checked deletion, 204                                   |

The catalog has no write routes (`405`). Search is literal, bounded to 200
characters, and filtered in the database before pagination with deterministic
updated-time/ID ordering. List pages defer the document column. A template starts
at revision 1 and each accepted replacement increments it; stale updates and
deletes return 409 and change nothing. Expected revisions are positive 32-bit
integers. Templates cascade with their owner.

## Trust

Template text is prompt content only. It grants no tools, files, MCP or
delegation, and assembly output is ordinary editable composer text.

## Builder (US-51.2)

`src/features/templates` owns the frontend. `lib/assemble.ts` mirrors the
ADR-0026 grammar and assembly rules in TypeScript; the server has already
validated each document, so the builder does not re-validate shape. The picker
reads the catalog and up to 100 owned template summaries (owner-keyed queries),
loading a template's document only when it is chosen. Assembly happens entirely
in the browser and is never sent as a separate request: "Use prompt" inserts the
text at the composer cursor.

## Slash discovery and provenance (US-51.3)

At the start of a message, typing `/` lists eligible skills first, then
`/template` (opens the list), bundled frameworks by ID (`/rtf`, `/co-star`) and
owned templates by a slug of their name (`/my-weekly-brief`). Matching is a
prefix of the command or of any hyphen-separated word. Choosing a template entry
removes the slash token and opens the builder; template entries are not offered
from the **Skills /** button, and typed template commands are not executed on
send.

After **Use prompt**, the composer shows a removable "Built with <name>" chip.
Sending includes `template: {source, id, revision, level}` on
`POST /chat/` and `POST /chat/{id}/message`. The chip is dropped when removed,
when the draft is cleared, and after acceptance. Like skill chips, it is saved
with the composer draft in this tab's session storage (scoped to user and
workspace) and survives a reload. A restored chip is only a client claim; the
server re-resolves it on send, so a template deleted meanwhile rejects the send
with 404 until the chip is removed.
`level` is `guided` until scaffolding levels exist (US-51.5).

The server resolves the claim before accepting the message: a framework must be
in the catalog and an owned template must exist (foreign, missing and malformed
IDs return the same 404). A claimed revision newer than the current one is
rejected with 400; older revisions are accepted because the template may have
changed after the prompt was built. The stored snapshot uses the server's name
and canonical ID, never client text. It lives in `messages.accepted_template`,
is immutable (SQLite trigger) and is never inherited by follow-ups; regenerating
an answer leaves the user message's label unchanged.

Reading chat history adds live `available`. A deleted owned template, or a
framework no longer in the catalog, keeps its recorded name and is shown as
"Built with <name> · unavailable". The label is provenance only: it does not
change execution, prompt composition or capabilities.
