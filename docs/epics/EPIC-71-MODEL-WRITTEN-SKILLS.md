# EPIC-71: Model-written skills

Status: in progress (US-71.1 done; US-71.2 next). Source: user request (2026-11-08).

## Objective

Writing a good SKILL.md by hand is hard. When creating a skill, let the user
describe what they want and have the main agent write a draft, which the user
reviews, edits and saves. The main agent may use the user's sub-agents (for
example to research a topic or check examples) while writing.

## Ownership and delivery

- The draft is only a suggestion. Nothing is saved or assigned until the user
  saves it in the existing skill editor, and saving goes through the normal skill
  create path and validation. Assignment to the main agent stays a separate,
  explicit step.
- The writer runs as a bounded agent run of the user's main-agent configuration
  with a fixed skill-writing system layer, using a model the user picks (subject
  to group access, [EPIC-70](EPIC-70-USER-GROUPS-AND-ACCESS.md)).
- Delegation uses the General chat sub-agent set from
  [EPIC-68](EPIC-68-SUB-AGENTS-IN-GENERAL-CHAT.md) with the same live checks; no
  other way to grant `sub_agent`. Tools the main agent has assigned (for example
  web search) may be used; skill text still never grants tools, files, MCP or delegation.
- Gated by the admin `skills_enabled` policy like the rest of skills.
- The run is recorded and inspectable like a chat run, so the user can see
  what the writer and its sub-agents did.

## US-71.1: Skill drafting run

As a user, I want to describe a skill in plain words and get a SKILL.md draft back.

Estimate: 2 days. Dependencies: EPIC-68 (US-68.1).

Acceptance: an endpoint starts a drafting run from a description (and optional
examples), streams progress including delegations, and returns a draft with
name, description and body that pass skill validation. The user can send
follow-up instructions to revise the draft. Cancelling stops the run. Nothing
is persisted as a skill until saved.

- [x] Decide in an ADR whether drafting reuses a hidden chat (for streaming, replay and inspection) or a new run type; prefer reuse.
- [x] Implement the writing prompt, output schema and validation; tests for validation, revisions, delegation scope and policy gating.

## US-71.2: "Describe it" in the skill editor

As a user, I want to choose between writing a skill myself and describing it.

Estimate: 1.5 days. Dependencies: US-71.1.

Acceptance: New skill offers "Write it" and "Describe it". Describe shows a
prompt box, model picker, progress (including sub-agent activity), then opens
the draft in the existing editor with preview, where the user can edit, ask for
changes or discard. Saving creates the skill; assignment stays a separate control.
Help explains that drafts are suggestions to review.

- [ ] Build the flow with generated client hooks; reuse the skill editor and preview.
- [ ] Help; unit tests and an E2E with a fake provider from description to saved skill.
