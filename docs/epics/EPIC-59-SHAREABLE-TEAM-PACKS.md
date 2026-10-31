# EPIC-59: Shareable team packs

Status: proposed. Source: product direction discussion (2026-10-31), core value proposition.

## Objective

Open WebUI shares single prompts and functions. Asterism can share a whole
working setup: a **team pack** containing sub-agent definitions, skills, prompt
templates, rubrics and project settings, exported as one file and imported
elsewhere. Asterism also ships starter packs for common workflows.

## Ownership and delivery

- A versioned pack manifest (an ADR covers the format and validation). Packs
  contain no secrets, no provider credentials and, by default, no files.
- **Importing grants nothing.** Each sub-agent's fixed model binding becomes a
  stated requirement (for example "needs tools, vision"), and the importer picks
  a model explicitly. No model is selected silently, consistent with the
  sub-agent invariants. Capabilities in the pack are requests: they need
  explicit assignment and are still limited by admin policy.
- Imported items become ordinary owner-scoped records. The pack's identity and
  version are recorded for provenance.

## US-59.1: Pack format and ADR

As a maintainer, I want a safe, versioned pack format.

Estimate: 1.5 days. Dependencies: US-51.1 for templates.

Acceptance: an ADR and JSON schema define the manifest, the included item types,
size limits and validation. The bounded parser rejects unknown types,
credential-shaped fields and oversized packs.

- [ ] Write the ADR and schema; implement the validator with tests.

## US-59.2: Export

As a user, I want to export a project's agent setup.

Estimate: 1.5 days. Dependencies: US-59.1.

Acceptance: from project settings, the user picks which sub-agents, skills,
templates and settings to include and downloads a pack. Models are exported as
requirements, not IDs.

- [ ] Implement export selection and serialization; test the round trip and that no secrets are included.

## US-59.3: Import with explicit review

As a user, I want to see exactly what a pack asks for before using it.

Estimate: 2.5 days. Dependencies: US-59.1.

Acceptance: importing shows a review screen listing every item and every
requested capability. The user chooses a model for each sub-agent and approves
each capability assignment. Nothing is created until the user confirms. Name
conflicts are resolved explicitly. Pack instructions are treated as untrusted
text.

- [ ] Implement the import review API and transactional creation.
- [ ] Build the review screen; test conflicts, model selection, policy limits and rollback.

## US-59.4: Starter packs

As a new user, I want working setups I can start from.

Estimate: 1.5 days. Dependencies: US-59.3.

Acceptance: Asterism ships bundled packs: Research → Critique → Synthesis,
Write → Review → Fact-check, and Study Buddy (tutor mode, flashcards, rubric
feedback). They install through the same review flow.

- [ ] Author and validate the bundled packs; add install tests.
