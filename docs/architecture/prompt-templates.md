# Prompt templates — US-51.1 through US-51.4

Private template CRUD and the bundled, read-only framework catalog are
implemented in the `prompt_templates` backend domain. The composer's template
builder (US-51.2), slash discovery and message provenance (US-51.3) and the
settings library and editor (US-51.4) are implemented. Scaffolding levels and the
prompt coach are later
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

## Library and editor (US-51.4)

**User Settings → Templates** (`?t=user&setting=templates`) lists the bundled
frameworks (read-only, with their catalog revision) and a searchable, paged list
of the user's own templates (10 per page, the same owner-scoped query keys as the
picker, so saves refresh both).

- **Duplicate** opens the editor as a new, unsaved template prefilled with a
  framework's or owned template's document and the name `<name> (copy)`. Nothing
  is created until **Save template**; the copy is independent afterwards.
- **Edit** loads the full document and edits it as a structured form: name,
  description, an ordered field list (label, key, kind, required, help, kind-
  specific options and default; move up/down and remove) and the body. **Add
  field** appends `{{field_N}}` to the body; the placeholder buttons insert a
  field's `{{key}}` at the body cursor. Enter in a single-line input does not save.
- The body follows the fields. A field added in the editor derives its key from
  its label (`Target audience` → `target_audience`, numbered if taken) until the
  key is edited directly. Whenever a key becomes valid and unique, that field's
  placeholders are renamed in the body (escaped `\{{` text is untouched);
  invalid or duplicate intermediate keys leave the body alone until fixed.
  Saved fields keep their keys when only the label changes.
- `lib/draft.ts` converts between the document and the editable draft and mirrors
  the ADR-0026 parser (key grammar, duplicate keys, malformed, unknown and unused
  placeholders, select options and defaults, length and byte limits). Problems
  are listed in one focused alert when saving; the server remains authoritative
  and its 400/422 text is shown if it still rejects the document.
- **Preview** renders the same `TemplateBuilder` the composer uses, without
  "Use prompt"; values typed there are not saved.
- Saves and deletes send the loaded revision. A 409 keeps the draft and shows the
  server message; **Reload current template** (confirming discard of a dirty
  draft) adopts the current revision. A pristine editor adopts a newer cached
  revision automatically; a dirty one is told to reload before saving. Deletion
  is confirmed; messages built with the template keep their label, shown as
  unavailable.
