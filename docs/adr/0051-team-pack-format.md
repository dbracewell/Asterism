# ADR-0051 — Team pack format and validation

Status: accepted and implemented for US-59.1 on 2026-11-06
([EPIC-59](../epics/EPIC-59-SHAREABLE-TEAM-PACKS.md)). Amended for export by US-59.2
(see the addendum).

## Context

EPIC-59 shares a whole working setup as one file. The file comes from another
person, so it must be safe to parse, must not carry secrets, and must not be able
to grant anything. Sub-agents bind one fixed model and capabilities need explicit
assignment, so a pack can only describe what it would like.

## Decision

### Manifest

A pack is one UTF-8 JSON object, defined by
[`team-pack-v1.schema.json`](../schemas/team-pack-v1.schema.json) and the models
in `asterism/domains/packs/documents.py`. The schema is generated from the models
(`scripts/export_pack_schema.py`), and a test keeps the two in sync.

```json
{
  "format": "asterism.team-pack",
  "format_version": 1,
  "pack": { "id": "research-team", "version": "1.2.0", "name": "Research team" },
  "sub_agents": [
    {
      "key": "researcher",
      "name": "Researcher",
      "instructions": "…",
      "max_steps": 8,
      "generation": { "temperature": 0.2 },
      "requested_tools": ["web_search"],
      "model_requirements": { "tools": true, "vision": false, "min_context_window": 32000 }
    }
  ],
  "skills": [{ "key": "cite", "content": "---\nname: …", "request_main_agent_assignment": true }],
  "templates": [{ "key": "summary", "document": {} }],
  "rubrics": [{ "key": "essay", "document": {} }],
  "project": { "name": "Research", "sub_agents": ["researcher"] }
}
```

- **Item types** are exactly sub-agents, skills, prompt templates, rubrics and one
  optional project. A pack needs at least one. Tools, MCP servers, providers,
  memories and files are not item types, so any such section is rejected. Version
  1 has no file section; carrying files later needs a new format version.
- **Keys** are pack-local (`^[a-z][a-z0-9_-]{0,63}$`), unique per section, and
  exist only so items can refer to each other. They are not record IDs. The file
  has no record, owner or model IDs.
- **Identity.** `pack.id` and the `MAJOR.MINOR.PATCH` `pack.version` are for
  provenance. They are claims by the author, not proof of origin: packs are
  unsigned.
- **Nested documents** reuse their own validators: `parse_document` for skills
  (ADR-0022) and templates (ADR-0026), `parse_rubric` for rubrics (ADR-0044).
- **Project** carries name, description, instructions, accent, goal and selected
  sub-agent keys. `goal_target_date` is left out as a personal deadline.

### Requests, not grants

- `model_requirements` replaces the fixed model binding. The importer picks a
  model. A sub-agent with `requested_tools` must state `tools: true`.
- `requested_tools` and `request_main_agent_assignment` ask for an assignment.
  Skills stay main-agent only, as the database requires. Admin policy still
  applies, and a request for a tool that is unknown or inactive here is left to the
  import review (US-59.3), because availability differs per installation.
- `sub_agent` and `search_knowledge` are rejected outright: they derive from live
  context and can never be assigned.
- All pack text is untrusted. Parsing it enables nothing.

### Bounds

| Item                                     | Limit                                  |
| ---------------------------------------- | -------------------------------------- |
| Whole pack                               | 1,048,576 bytes, checked before decode |
| Nesting                                  | 12 levels                              |
| Sub-agents / skills / templates / rubrics | 16 / 32 / 32 / 16                      |
| Requested tools per sub-agent            | 32, unique                             |
| Sub-agent name / description             | 200 single-line / 10,000 characters    |
| Instructions                             | 100,000 characters                     |
| Pack name / description / author         | 120 single-line / 2,000 / 200          |

Project fields match the project API limits. Names are unique per section after
case and whitespace folding.

### Validation order

`parse_pack(bytes)` runs these steps and raises `BadDataException` (HTTP 400):

1. Bound the size, then decode strict UTF-8 and JSON. Duplicate fields, `NaN` and
   `Infinity` are rejected.
2. Check `format` and `format_version`, so a newer pack reports its version rather
   than an unknown field.
3. Screen every field name and string: nesting depth, null characters, lone
   surrogates and credential shapes.
4. Validate against the models in strict mode. Nothing is coerced, and unknown
   fields are rejected.
5. Check semantics: nested documents, uniqueness, references, internal tools.

### Credential screening

Field names are rejected when they name a secret (`api_key`, `client_secret`,
`password`, `auth_token`, `refreshToken` and so on). `max_tokens` is not a match.

Values are rejected only for high-confidence formats: private key blocks, `sk-`,
GitHub, AWS, Slack and Google keys, long Bearer values, JWTs and URLs with embedded
credentials. Prose about credentials stays valid. The screen is a backstop, not
proof that a pack holds no secrets, so export (US-59.2) must still build packs from
an allowlist of fields. A skill that shows a realistic example, such as a
`postgres://user:pass@host` URL, is rejected and needs a placeholder instead.

Errors give the location and never quote a value. Because screening comes before
schema validation, a schema error cannot echo a secret. The patterns cap every
repeat that can restart at a word boundary, since an unbounded one took minutes
on a crafted 1 MiB string; a test holds this.

## Consequences

- No routes or tables yet, so OpenAPI and the database are unchanged. Export and
  import add them in US-59.2 and US-59.3.
- Any new field on a pack model is a format change: regenerate the schema, and bump
  `format_version` when older readers would reject or misread the file. Older
  versions need no reader while the project has no production users.
- The JSON Schema cannot express the semantic rules or credential screening, so
  only `parse_pack` decides whether a pack is valid.

## Addendum: export (US-59.2)

`POST /projects/{id}/pack-export` takes a name, description, version, the IDs to
include and `include_project_settings`, and returns the manifest. The browser
writes the file. Nothing is stored or changed, and nothing is included by default.

- **Fields are allowlisted.** Each item is built from named fields. Generation
  settings are limited to `GenerationDefaults`, so `extra_body` and similar values
  in `chat_parameters` never reach the file. Internal tools are dropped.
- **The parser is the last step.** Export ends in `parse_pack`, so a file has met
  the same bounds and credential screen as an import. A credential in instructions
  stops the export with a 400 that names the location; the user removes it.
- **Requirements.** `tools` is true when the sub-agent requests tools. `vision`
  follows the bound model, since configuration cannot show whether a sub-agent
  relies on images. `min_context_window` stays null: the bound model's window says
  what it has, not what the sub-agent needs.
- **Scope.** The project and every item must be owned (404). Sub-agents must be
  selected on the project, because a pack exports that project's setup, so
  `project.sub_agents` is every exported sub-agent. Skills, templates and rubrics
  are user-owned and may come from outside the project.
- **Keys and identity.** Keys are positional (`sub-agent-1`) in name order. `pack.id`
  is a slug of the pack name, so a new version under the same name keeps its
  identity. `author` stays empty, so a pack does not reveal who exported it.
- `request_main_agent_assignment` records whether the skill is assigned today.
