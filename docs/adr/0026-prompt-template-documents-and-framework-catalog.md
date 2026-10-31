# ADR-0026 — Prompt template documents, placeholder grammar and framework catalog

Status: accepted; US-51.1 user-confirmed complete on 2026-10-31. Amended for
scaffolding levels by US-51.5 (see the addendum).

## Context

EPIC-51 teaches prompt writing through structured frameworks presented as forms.
The form, the live preview (US-51.2), provenance (US-51.3) and the editor
(US-51.4) all need one stable description of a template: which fields exist,
what kind each is, and where each value lands in the assembled prompt. Users must
also be able to start from well-known frameworks that the server ships and keeps
consistent.

## Decision

### Document format

A template is one structured JSON document, not Markdown with YAML frontmatter.
Fields are a list of typed objects, which a scalar-only YAML parser like the
skills parser (ADR-0022) would have to reject; a typed JSON object maps directly
onto the generated client types and the schema-driven form.

```json
{
  "name": "RTF",
  "description": "Role, Task, Format ...",
  "fields": [
    {
      "kind": "short_text",
      "key": "role",
      "label": "Role",
      "help": "...",
      "required": true,
      "default": "an experienced teacher"
    }
  ],
  "body": "Act as {{role}}. ..."
}
```

- `kind` is one of `short_text`, `long_text`, `select` (requires 1–20 unique
  `options`; `default` must be one of them) and `examples` (`default` is a list of
  up to 10 strings). Unknown kinds and unknown properties are rejected.
- Every field has `key`, `label`, `help` (optional, default empty), `required`
  (strict boolean, default false) and an optional `default`.
- Name and description are derived searchable metadata; clients never write
  them separately. Owner, revision and timestamps are never part of the document.
- The canonical form is the server's JSON serialization of the validated model.
  It is stored verbatim in `prompt_templates.document`.

### Bounds

| Item               | Limit                                         |
| ------------------ | --------------------------------------------- |
| Whole document     | 65,536 UTF-8 bytes (canonical JSON)           |
| Name / description | 1–80 / 1–500 characters, nonblank             |
| Body               | 1–16,000 characters, nonblank                 |
| Fields             | 1–32                                          |
| Key                | `^[a-z][a-z0-9_]{0,31}$`, unique per document |
| Label / help       | 1–80 nonblank / ≤ 500 characters              |
| Short / long text  | default ≤ 500 / ≤ 8,000 characters            |
| Select             | 1–20 unique options, each 1–120 characters    |
| Examples           | ≤ 10 defaults, each 1–4,000 characters        |

Null characters and invalid UTF-8 (lone surrogates) are rejected.

### Placeholder grammar

```
body        := ( literal | escape | placeholder )*
placeholder := "{{" key "}}"            ; no inner whitespace
escape      := "\{{"                    ; a literal "{{"
key         := [a-z][a-z0-9_]{0,31}
```

Any other `{{` is malformed and rejected. A lone `}}` or `\` is literal. The body
is stored verbatim; escapes are interpreted only at assembly time.

Every placeholder must name a declared field, and every field must appear at
least once in the body (unused fields usually mean a typo). A key may repeat.

### Assembly semantics (for US-51.2)

Assembly replaces each placeholder with the field's value and each `\{{` with
`{{`. Text values (`short_text`, `long_text`, `select`) are inserted verbatim.
An `examples` value is rendered as `Example N:\n<text>` blocks separated by a
blank line. An empty optional value inserts the empty string. The result is
ordinary prompt text: it is never re-parsed for placeholders.

### Framework catalog and versioning

Bundled frameworks (`rtf`, `co-star`, `craft`, `few-shot`, `step-by-step`) are
Python source in `domains/prompt_templates/catalog.py`, validated through the same
parser at import, and exposed as an immutable mapping of frozen models. A bad
bundled framework fails startup and tests, not a request.

- Each framework has a stable string ID and an integer `revision`; any change to
  its document bumps it.
- `CATALOG_VERSION` is bumped whenever any framework is added, removed or revised.
- The catalog has read routes only. Customizing means duplicating a framework's
  document into a new owned template, which is fully independent afterwards.
- Provenance (US-51.3) records either `(template UUID, revision)` or
  `(framework ID, revision)` with the scaffolding level and a server-resolved
  name snapshot. Old framework revisions are not retained; a recorded revision
  that no longer matches is shown as a historical label only. Revisions newer
  than the current one are rejected.

### Ownership and trust

Templates live in a `prompt_templates` domain modeled on `skills`: owner-scoped
selects, revision compare-and-set on update and delete (409 on stale), and the
same 404 body for foreign and missing IDs. Admins have no cross-user exception.
Template text is prompt content only: it grants no tools, files, MCP or delegation,
and there is no admin activation policy because nothing is activated.

## Consequences

- One new table, `prompt_templates`, created by fresh initialization; no migration.
- Shape errors (unknown kinds, extra properties, type mismatches) fail request
  validation with 422; semantic errors (duplicate keys, unmatched placeholders,
  unused fields, bad select defaults, size) fail the domain parser with 400.
  Direct parser callers (catalog, stored rows) get 400-class `BadDataException`
  for both.
- Templates have no unique-name constraint: they are referenced by ID, and a
  duplicated framework may keep its name.
- Optional fields leave their surrounding body text in place when empty. Bundled
  frameworks therefore mark fields required (with defaults where helpful).
  Conditional sections are deferred to scaffolding levels (US-51.5).

## Addendum — scaffolding levels (US-51.5)

Scaffolding levels (guided, standard, freeform) are a builder concern, but each
level needs something from the document. Rather than defining a separate field
list per level, which would drift from the body, the levels are derived from the
existing schema plus three additions:

- **Standard** shows `required` fields and puts optional fields under "More".
  Without conditional text, an empty optional field would leave its sentence in
  the prompt, so the grammar gains **sections**:

  ```
  section := "{{#" key "}}" ( literal | escape | placeholder )* "{{/" key "}}"
  ```

  Sections do not nest. Every open must be closed by the same key, and a stray
  close is malformed. A section key must name a declared field. Using a key only
  as a section tag does not count as using the field: it must still appear as a
  placeholder. At assembly time, a section whose field renders blank is dropped
  with all of its text; otherwise its tags are removed and its contents
  assembled normally.

- **Guided** pre-fills defaults and shows an optional per-field `example` (1–500
  nonblank characters). The example is a hint only and is never assembled into
  the prompt.
- **Freeform** shows an optional document-level `checklist` (≤ 12 items, each
  1–200 nonblank characters). An empty checklist is derived from the fields by
  clients.

Both new properties have defaults, so existing documents remain valid. The
canonical serialization always includes them (`example: null`, `checklist: []`).
`TemplateUse.level` is now required: every send states its level, and the
client no longer relies on a server default. The bundled frameworks moved to
revision 2 and `CATALOG_VERSION` to 2, and some framework fields became optional
inside sections.

See the [prompt templates contract](../architecture/prompt-templates.md).
