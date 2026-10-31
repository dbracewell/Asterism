# EPIC-51: Prompt frameworks and templates

Status: proposed. Source: product direction discussion (2026-10-31), learner track.

## Objective

Teach users to write effective prompts. Structured frameworks (RTF, CO-STAR,
CRAFT, few-shot, step-by-step) are presented as forms. As the user fills in the
form, the assembled prompt text is shown, so they can see how each field shapes
the prompt. Over time, learners need less scaffolding and write strong prompts
on their own.

## Ownership and delivery

- A new owner-scoped `prompt_templates` backend domain, modeled on `skills`. One
  canonical template document per record, derived metadata, revision-checked
  updates, and the same 404 for foreign and missing IDs.
- A bundled, read-only framework catalog ships with the server and is versioned.
  Users duplicate a framework to customize it.
- A template is a field schema plus a body with `{{field}}` placeholders. Field
  kinds: short text, long text, select, and examples list. Each field has a
  label, help text, a required flag and an optional default.
- Template text is prompt content only. Like skills, it never grants tools,
  files, MCP or delegation.
- The composer reuses EPIC-40 slash discovery. The assembled prompt is ordinary,
  editable composer text. Message provenance records the template ID, revision
  and scaffolding level, not a separate execution path.
- The frontend form is generated from the field schema (see `form-generator.ts`).

## US-51.1: Template document and framework catalog

As a user, I want reusable prompt templates built on known frameworks.

Estimate: 2 days. Dependencies: none.

Acceptance: users can create, read, update and delete their own templates.
Every caller can list the bundled frameworks, which are read-only. The bounded
parser rejects unknown field kinds, duplicate keys, placeholders without a
matching field and oversized documents. Templates are owner-scoped, with the
same 404 for foreign and missing IDs.

- [ ] Write an ADR for the template document format, placeholder grammar and catalog versioning.
- [ ] Implement the domain model, queries, service and router, and regenerate the client.
- [ ] Ship the initial framework catalog (RTF, CO-STAR, CRAFT, few-shot, step-by-step).
- [ ] Test parsing limits, owner isolation, revision conflicts and catalog immutability.

## US-51.2: Template builder with live preview

As a learner, I want to fill in a form and watch the prompt take shape.

Estimate: 2 days. Dependencies: US-51.1.

Acceptance: picking a template opens a generated form beside a live preview.
Each preview segment is visually linked to the field that produced it (hover or
focus highlights both). Required fields are validated. "Use prompt" inserts the
assembled text into the composer, where it stays editable. Works at 320px wide.

- [ ] Build the schema-driven form and preview with field/segment linking.
- [ ] Add composer insertion and responsive layout; add unit and Playwright tests.

## US-51.3: Composer integration and provenance

As a user, I want to start from a template without leaving the chat.

Estimate: 1 day. Dependencies: US-51.2, EPIC-40.

Acceptance: `/template` (and template names) appear in slash discovery. A sent
message records the template ID, revision and scaffolding level, and shows a
small "Built with RTF" label. Deleting the template later leaves the label shown
as unavailable.

- [ ] Extend slash discovery and message provenance; regenerate the client.
- [ ] Test label rendering, missing-template history and branch regeneration.

## US-51.4: Template library and editor

As a user, I want to manage and customize my templates.

Estimate: 1.5 days. Dependencies: US-51.1.

Acceptance: Settings → Templates lists bundled frameworks and the user's own
templates. Users can duplicate a framework, edit fields and body with a preview,
and delete with a revision check.

- [ ] Build the library list, duplicate action and editor with preview.
- [ ] Test editing, conflicts and accessibility (axe, keyboard).

## US-51.5: Scaffolding levels

As a learner, I want less hand-holding as I improve.

Estimate: 1 day. Dependencies: US-51.2.

Acceptance: each template can define guided, standard and freeform levels. Guided
shows every field with examples and defaults. Standard hides optional fields
behind "More". Freeform shows only a checklist of what a good prompt covers. The
user chooses the level, and the choice is recorded in provenance.

- [ ] Add level definitions to the template schema and the builder UI.
- [ ] Test that each level renders the right fields and that provenance records the level.

## US-51.6: Prompt coach

As a learner, I want feedback on my prompt before I send it.

Estimate: 2 days. Dependencies: US-51.2.

Acceptance: an optional "Review prompt" action critiques the composer text
against a rubric: goal, audience, context, constraints, output format and
examples. It returns a short checklist of suggestions, each with an "apply"
action that edits the composer text. Nothing is sent to the chat automatically.
The critique runs on the draft model, with the same owner-plan fallback as chat
titles (EPIC-50); with no usable model, the action is unavailable. Critiques are
ephemeral and not stored. The feature is off by default and enabled in user
settings.

- [ ] Add the coach endpoint and rubric prompt, reusing title-model resolution.
- [ ] Build the suggestion checklist and apply actions in the composer.
- [ ] Test model resolution, unavailable state, ephemerality and the UI flow.

## US-51.7: Before/after comparison

As a learner, I want to see what a better prompt actually changes.

Estimate: 1 day. Dependencies: US-51.6, US-54.4.

Acceptance: after applying coach suggestions, the user can run both the original
and the improved prompt on the same model and compare the answers side by side,
using the comparison view from US-54.4.

- [ ] Wire the coach's before/after pair into the comparison flow; test it end to end.
