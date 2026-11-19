# Team packs

This guide explains team packs: files that share a working setup (sub-agents,
skills, prompt templates, rubrics and a project's settings) between people. It
covers the file format, how a pack is checked, exported and imported, and why a
pack can only ever ask for things, never grant them. Read it before changing the
`packs` domain or adding a field a pack carries. Courses reuse the same export
([classes and courses](classes-and-courses.md#publishing-a-course)).

## Concepts

- **A team pack** is one JSON file in the `asterism.team-pack` format, version 1.
  It describes a setup; it holds no record IDs, owners, models, files, keys or
  provider details.
- **Requests, not grants.** A pack can ask for a sub-agent to have certain tools, or
  for a skill to be assigned to the main agent. Only the person importing it decides,
  item by item, and admin policy still applies.
- **Keys** are short names local to the file (`researcher`, `sub-agent-1`) so items
  can refer to each other. They aren't IDs.
- **Starter packs** are packs bundled with Asterism, offered through the same import
  as any downloaded file.

## How it works

### The format

A pack is defined by the models in
[`packs/documents.py`](../../apps/backend/asterism/domains/packs/documents.py). A JSON
Schema, [`team-pack-v1.schema.json`](../schemas/team-pack-v1.schema.json), is
generated from them by `scripts/export_pack_schema.py`, and a test keeps the two in
step ([ADR-0051](../adr/0051-team-pack-format.md)).

```json
{
  "format": "asterism.team-pack",
  "format_version": 1,
  "pack": {
    "id": "research-team",
    "version": "1.2.0",
    "name": "Research team"
  },
  "sub_agents": [
    {
      "key": "researcher",
      "name": "Researcher",
      "instructions": "…",
      "max_steps": 8,
      "requested_tools": ["web_search"],
      "model_requirements": {
        "tools": true,
        "vision": false,
        "min_context_window": 32000
      }
    }
  ],
  "skills": [
    {
      "key": "cite",
      "content": "---\nname: …",
      "request_main_agent_assignment": true
    }
  ],
  "templates": [{ "key": "summary", "document": {} }],
  "rubrics": [{ "key": "essay", "document": {} }],
  "project": { "name": "Research", "sub_agents": ["researcher"] }
}
```

- **Item types** are exactly sub-agents, skills, prompt templates, rubrics and one
  optional project, and a pack needs at least one. There is no section for tools,
  MCP servers, providers, memories or files, and any such section is refused.
- **Sub-agents carry model requirements, not a model.** The importer picks a model
  that meets them. A sub-agent that requests tools must require tool support.
- **Internal tools can't be requested.** `sub_agent` and `search_knowledge` come from
  live context and are refused in a pack.
- **Identity is a claim.** `pack.id` and `pack.version` record where a pack came
  from, but packs are unsigned, so they prove nothing.
- **Nested documents** (skills, templates, rubrics) go through their own validators.

### Checking a pack

`parse_pack(bytes)` decides whether a pack is valid, and every path, including
export, ends with it. The checks run in this order, and any failure is a 400:

1. **Size and syntax.** At most 1 MiB, checked before decoding; strict UTF-8 and
   JSON, with duplicate fields, `NaN` and `Infinity` refused.
2. **Format and version,** first, so a newer pack reports its version rather than an
   unknown field.
3. **Screening,** of every field name and string: nesting (at most 12 levels), null
   characters, lone surrogates and credential shapes.
4. **Schema,** in strict mode: nothing is coerced, and unknown fields are refused.
5. **Meaning:** nested documents, unique names, references between items and no
   internal tools.

Other limits: 16 sub-agents, 32 skills, 32 templates and 16 rubrics; 32 requested
tools per sub-agent; 100,000 characters of instructions.

**Credential screening** refuses field names that name a secret (`api_key`,
`password`, `refreshToken` and so on) and values in well-known secret formats:
private keys, `sk-` keys, GitHub, AWS, Slack and Google keys, long Bearer values,
JWTs and URLs with embedded credentials. Prose that talks about credentials is
fine. Errors give the location and never quote the value, and screening comes before
schema validation so a schema error can't echo a secret. The screen is a backstop,
which is why export also builds packs from an allowlist.

### Exporting

`POST /projects/{project_id}/pack-export` takes a name, description, version, the
items to include and whether to include the project's settings, and returns the
file. Nothing is stored, and nothing is included unless chosen.

- **Fields are allowlisted.** Each item is built from named fields, and generation
  settings are limited to the supported defaults, so stray provider parameters never
  reach the file.
- **The project's sub-agents.** A pack exports one project's setup, so its
  sub-agents must be selected on that project. Skills, templates and rubrics may
  come from anywhere the user owns.
- **Requirements are inferred.** `tools` is true when a sub-agent requests tools,
  and `vision` follows its current model.
- **No author.** Keys are positional and `author` is left empty, so a pack doesn't
  reveal who exported it.
- **Parsed last.** A credential found in instructions stops the export with a 400
  naming where it is.

### Importing

Import is two calls, and the server keeps nothing between them, so the second call
parses the file again and trusts nothing from the first:

1. **`POST /team-packs/review`** returns what the pack asks for: each item, the
   tools it requests, its model requirements, and any name conflicts.
2. **`POST /team-packs/import`** takes the same file and one decision per item.

The decisions are explicit:

- **Every item is decided,** including skips, so an out-of-date page can't drop an
  item unnoticed.
- **Nothing is implied.** No model is chosen for the user, approved tools must be a
  subset of the requested ones, and a skill is assigned only when the pack requests
  it and the user approves. Tools and skill assignment are checked against admin
  policy again at import.
- **Requirements.** A sub-agent with approved tools needs a model that supports
  tools; that is a hard stop. Other unmet requirements are warnings the user accepts
  by choosing the model anyway.
- **Conflicts.** A name already used by the user, ignoring case and spaces, must be
  renamed or skipped. Nothing is replaced and no suffix is added.
- **One transaction.** Each domain provides a builder that its own create path also
  uses, so imported records meet the same rules. All checks run before the first
  write, and any failure rolls everything back.
- **The project** becomes a new project, selecting only the sub-agents that were
  imported.

`pack_imports` and `pack_import_items` record what was imported and what it created.
They are history: they grant nothing and survive deletion of the records they name.

Pack text is shown as plain text during review, never as Markdown. Imported
instructions become the user's own; the safeguard is that the user reads them first,
and that instructions grant nothing.

### Starter packs

Three packs ship in
[`packs/bundled/`](../../apps/backend/asterism/domains/packs/bundled/): _Research,
Critique, Synthesis_, _Write, Review, Fact-check_ and _Study Buddy_.
`GET /team-packs/starters` returns their text, and the browser sends it through the
same review and import as an uploaded file. They are checked with `parse_pack` at
startup, so a broken one stops the server. They get no extra trust: their tools
start unapproved and their sub-agents still need a model.

Packs have no workflow or learning-mode fields. A project's instructions tell the
main agent in what order to delegate, which is guidance for the model rather than an
enforced pipeline.

## Rules

- A pack describes; it never grants. Every tool, assignment and model is the
  importer's choice, within admin policy.
- Packs never carry files, keys, provider details or record IDs.
- `parse_pack` is the only judge of validity, and both export and import end with it.
- Import trusts nothing from review and writes everything in one transaction.
- A new field on a pack model is a format change: regenerate the schema, and raise
  `format_version` when older readers would misread the file.

## Where the code lives

1. [`packs/documents.py`](../../apps/backend/asterism/domains/packs/documents.py): the
   format and `parse_pack`.
2. [`packs/export.py`](../../apps/backend/asterism/domains/packs/export.py): export.
3. [`packs/review.py`](../../apps/backend/asterism/domains/packs/review.py) and
   [`packs/importer.py`](../../apps/backend/asterism/domains/packs/importer.py): review
   and import.
4. [`packs/starters.py`](../../apps/backend/asterism/domains/packs/starters.py): starter
   packs.

## Related

- [ADR-0051](../adr/0051-team-pack-format.md): the format, export, import and starters
- [ADR-0054](../adr/0054-course-packs.md): courses, built on the export
- [Skills](skills.md) and [prompt templates](prompt-templates.md)
