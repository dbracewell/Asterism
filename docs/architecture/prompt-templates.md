# Prompt templates — US-51.1 through US-51.7

Private template CRUD and the bundled, read-only framework catalog are
implemented in the `prompt_templates` backend domain. The composer's template
builder (US-51.2), slash discovery and message provenance (US-51.3) and the
settings library and editor (US-51.4), scaffolding levels (US-51.5) and the
prompt coach (US-51.6) and the before/after comparison (US-51.7) are
implemented, completing [EPIC-51](../epics/EPIC-51-PROMPT-FRAMEWORKS-AND-TEMPLATES.md).

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
`level` is the scaffolding level the prompt was built at (US-51.5) and is
required.

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

## Scaffolding levels (US-51.5)

Every template supports three levels, chosen with the **Guided / Standard /
Freeform** tabs at the top of the builder (composer and editor preview alike).
The level only changes how much help the builder shows; the result is still
ordinary composer text.

| Level    | Shows                                                                                                                            |
| -------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Guided   | Every field with its help, its `example` hint and its default pre-filled.                                                        |
| Standard | Required fields with help, starting empty; optional fields are under a collapsed **More (N optional)**. No examples or defaults. |
| Freeform | Only the checklist (with tick boxes for self-checking that are never saved or sent) beside a blank **Your prompt**.              |

The builder opens at guided. Switching levels keeps what the user typed;
switching to guided fills only fields that are still empty with their defaults.
Freeform text is separate from the field values. **Use prompt** validates the
required fields (or, in freeform, a nonblank prompt) and passes the level to the
composer, which shows it on the chip ("Built with RTF · Standard") and sends it
as `template.level`. The server stores it in the message's provenance, and the
history label shows it too. A restored draft whose stored level is unknown drops
the chip.

The document additions behind the levels are in ADR-0026's US-51.5 addendum:

- `fields[].example`: an optional hint of up to 500 characters, shown only at the
  guided level and never inserted into the prompt.
- `checklist`: up to 12 items of up to 200 characters. When empty, the freeform
  checklist is derived from the fields (`Label: help`).
- Conditional sections `{{#key}}…{{/key}}` in the body: the section text is
  kept only when field `key` has a value, so an optional field left empty at the
  standard level drops its surrounding sentence. The editor's body help explains
  the syntax, its validation mirrors the server's section rules, and renaming a
  key renames its section tags as well.

The bundled frameworks are at revision 2 (`CATALOG_VERSION` 2). Each has a
checklist and field examples, and RTF, CO-STAR, CRAFT and step-by-step wrap their
optional fields in sections.

## Prompt coach (US-51.6)

An optional **Review prompt** button in the composer toolbar critiques the
current draft against a fixed rubric: goal, audience, context, constraints,
output format and examples. It is off by default; each user turns it on with
**User Settings → General → Prompt Coach** (user setting `prompt_coach_enabled`,
boolean).

| Route                                 | Contract                                                                                                        |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `GET /prompt-templates/coach`         | `{enabled, available}` for the caller                                                                           |
| `POST /prompt-templates/coach/review` | `{prompt (1–16,000 chars), model_id?}` → `{suggestions}`; 403 when off, 503 with no model, 502 on model failure |

**Model.** Reviews reuse chat-title model resolution
(`chat/title_model.resolve_title_model`): the admin draft model when usable,
otherwise the caller's own available ChatGPT plan model, preferring the
composer's selected chat model (`model_id`) when it is one of them. Another
user's plan is never used. With neither, `available` is false, the button is
disabled with an explanation, and reviews return 503.

**Review format.** `coach.py` sends a system rubric prompt and the draft inside
`<draft>` tags, telling the model to ignore instructions in the draft. The reply
is parsed leniently and bounded: the first JSON object is read; items with an
unknown criterion, empty message or edit, an edit over 2,000 characters, or a
`find` excerpt not present verbatim in the draft are dropped. At most one
suggestion per criterion is kept, in rubric order (so at most six), messages are
capped at 300 characters, and the suggestion `id` is its criterion. A reply
that is not a JSON object with a `suggestions` list is a 502. An empty list
means the draft already covers the rubric.

**Applying.** Each suggestion is a checklist item with an **Apply** button that
edits the composer text only: with `find`, the first exact occurrence is
replaced by `text`; without it, `text` is appended as a new paragraph (never
twice). A rewrite whose text has since been edited away cannot be applied.
Nothing is sent to the chat; sending stays an explicit action.

**Ephemeral.** Neither the draft nor the review is stored: no database writes,
`Cache-Control: no-store`, the draft text is never logged, and the frontend
keeps the review only in component state (not in the saved composer draft). It
is cleared on dismiss and when the message is sent. The coach keeps the
reviewed draft in memory as the "before" prompt for the US-51.7 comparison.

**Trust.** The draft is untrusted text and the review only produces suggested
composer text. Neither grants tools, files, MCP or delegation.

## Before/after comparison (US-51.7)

Once at least one suggestion has been applied, the review panel offers
**Compare before/after** (when the composer has a selected model and the draft
differs from the reviewed original). It sends a normal comparison
([ADR-0027](../adr/0027-side-by-side-comparison-branches.md)) instead of a single
turn: the request's `user_prompt` is the reviewed original and `compare` holds two
targets on the selected model, `{label: "Before"}` and `{user_prompt: <improved>,
label: "After"}`. Leading skill commands are removed from the original because
the parsed skill selection applies to both columns. A template label applies only
to the column whose prompt it built (the original). The columns run one after
another on the same model, are headed **Before** and **After** with the model name
beside them, and the conversation continues from **Before** until the user picks
**After**. Sending clears the composer and the review like any send.

## Rubrics (US-57.1)

Rubrics are the `rubric` kind of this domain: rows of `prompt_templates` with
`kind = "rubric"` and their own document format, owner-scoped selects and API
(prompt templates are `kind = "prompt"`). The format, bounds, catalog and the
Draft feedback mode that uses them are decided in
[ADR-0044](../adr/0044-rubric-draft-feedback.md).

| Route                                      | Contract                                                         |
| ------------------------------------------ | ---------------------------------------------------------------- |
| `GET /rubrics/bundled`                     | `{version, items}`: every bundled rubric with its document       |
| `GET /rubrics/bundled/{id}`                | One bundled rubric, 404 if unknown                               |
| `GET /rubrics/`                            | Owner-scoped metadata page; `query`, `page`, `page_size` (1–100) |
| `POST /rubrics/`                           | Create from `{document}`, 201 with the full rubric               |
| `GET /rubrics/{id}`                        | Full rubric including `document`                                 |
| `PUT /rubrics/{id}`                        | Replace `{document, expected_revision}`                          |
| `DELETE /rubrics/{id}?expected_revision=N` | Revision-checked deletion, 204                                   |

**User Settings → Rubrics** (`?t=user&setting=rubrics`) lists the bundled
rubrics (duplicate only) and a searchable, paged list of the user's rubrics.
The editor edits the name, description, ordered levels (highest first, 2–6;
adding, moving or removing a level reshapes every criterion's descriptors) and
criteria (name, optional description and one descriptor per level).
`lib/rubric-draft.ts` mirrors the server rules; the server stays authoritative.
A save or delete with a stale revision shows the 409 message and offers
**Reload current rubric**.
