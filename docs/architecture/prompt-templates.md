# Prompt templates — US-51.1

Private template CRUD and the bundled, read-only framework catalog are
implemented in the `prompt_templates` backend domain. The builder, composer
integration, editor and scaffolding levels are later
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
