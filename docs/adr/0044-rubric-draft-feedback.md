# ADR-0044 — Rubrics and Draft feedback mode

Status: accepted and implemented for US-57.1 on 2026-11-03
([EPIC-57](../epics/EPIC-57-WRITING-FEEDBACK-AND-AI-USE-TRANSPARENCY.md)).

## Context

A student wants feedback on a draft against an assignment rubric: organized by
criterion, with an estimated level and quotes from the draft, and without the
draft being rewritten for them. The epic asks to reuse the template domain
(EPIC-51) for rubrics and the learning-mode layer (EPIC-52) for the behavior.

## Decision

### 1. Rubrics are the "rubric" kind of the template domain

`prompt_templates` gains a `kind` column (`prompt` or `rubric`). Both kinds share
ownership, revisions, timestamps and derived name/description, but each kind has
its own document format, owner-scoped selects (`select_owned_templates`,
`select_owned_rubrics`) and API, so neither kind's routes or generated client
types become unions. A prompt template ID is not a rubric ID and vice versa
(404 either way).

A rubric document is canonical JSON:

```json
{
  "name": "Argumentative essay",
  "description": "…",
  "levels": ["Exemplary", "Proficient", "Developing", "Beginning"],
  "criteria": [
    { "label": "Thesis", "description": "…", "descriptors": ["…", "…", "…", "…"] }
  ]
}
```

- Levels are ordered from the highest to the lowest: 2–6 unique, single-line
  names of up to 40 characters.
- 1–12 criteria with unique single-line labels (up to 80 characters), an
  optional description (up to 500), and exactly one nonblank descriptor per
  level (up to 1,000 each), aligned by index.
- `Overall` is reserved as a criterion label, because the reply format ends with
  an Overall section. Uniqueness ignores case and repeated whitespace.
- The whole document is at most 65,536 UTF-8 bytes; null characters are rejected.
  Shape errors are 422, semantic errors 400.

Routes: `GET/POST /rubrics/`, `GET/PUT/DELETE /rubrics/{id}` (revision
compare-and-set like templates) and the read-only bundled catalog
`GET /rubrics/bundled[/{id}]`. Bundled rubrics (`argumentative-essay`,
`lab-report`, `personal-narrative`) live in `rubric_catalog.py`, are validated at
import, and carry a revision and `RUBRIC_CATALOG_VERSION`.

### 2. Draft feedback is a learning mode

`draft_feedback` ("Draft feedback") is a server-owned mode with
`rubric_feedback = {level_label: "Estimated level", overall_heading: "Overall"}`.
`GET /learning-modes` serves that format (never the instruction text). The mode
text asks for, in rubric order:

```
### <criterion name>
Estimated level: <level name>

> <passage quoted word for word from the draft>

<what works, what holds it back, one concrete next step>
```

then `### Overall` with the main strength and the first revision to make. The
model asks for a rubric or a draft when one is missing, never rewrites the
draft, and gives an "Example rewrite" of one passage only when the learner asks
for exactly that.

### 3. The rubric is pinned on the user turn

A send in a mode with `rubric_feedback` may carry `rubric: {source, id}`
(`bundled` or `owned`). The server snapshots the rubric's *current* document and
revision into `messages.accepted_rubric` in the acceptance transaction; the
client claims no revision. Unknown, foreign or malformed IDs are 404; a rubric
in any other mode is 400. The column is immutable (SQLite trigger) and copied
to comparison columns.

The model reads the pinned rubric as a text part after the learner's message
(`### Rubric: …`, the levels, then each criterion with its descriptors). It is
part of the request, so resume and regeneration use the same copy even after the
rubric is edited or deleted, and later turns see it in history. Rubric text is
assessment data: it adds no prompt layer and grants nothing.

`MessageExecution.rubric` records public provenance (source, ID, revision, name,
level and criterion names). Messages expose the user turn's `rubric` (the
snapshot plus live `available`).

### 4. Rendering

The UI parses a reply against its execution's rubric labels and the catalog's
format. A reply is structured when the first criterion's heading is present and
the found headings are in order; later sections may be missing while streaming.
Each criterion renders as a card with its level (a badge and a meter; an unknown
level is shown as written, marked "not in rubric"), followed by Overall. Other
replies (asking for a rubric, an example rewrite) render as Markdown.

The composer shows a **Rubric** picker beside the mode picker in modes with
`rubric_feedback`. The choice stays selected for later turns (initially the
chat's latest rubric) and is only sent in such modes. User Settings → Rubrics
lists bundled rubrics (duplicate only) and the user's rubrics, with an editor
for levels and criteria.

### 5. Evaluation

`learning/evals/draft_feedback.json` cases can attach a bundled `rubric` to the
last user turn (rendered as the model reads it) and check `feedback: "rubric"`:
every criterion heading in order, then Overall, a valid level line per
criterion and at least one quoted passage. `free_form` cases check that neither
the level line nor the Overall heading appears. Like other learning fixtures,
they do not gate CI.

## Consequences

- Schema change (`prompt_templates.kind`, `messages.accepted_rubric`) needs the
  development reset; no migration.
- Quotes are not yet anchored to the draft; US-57.2 adds span anchoring and
  resolution state on top of this reply format.
- Levels are estimates by a model and are labelled as such.
