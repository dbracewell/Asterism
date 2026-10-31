# EPIC-54: Run inspection, replay and comparison

Status: proposed. Source: product direction discussion (2026-10-31), core value proposition.

## Objective

Asterism's signature is coordinated agents you can see and trust. EPIC-44 already
draws the delegation graph. This epic adds: what each step cost, what each agent
was allowed to do and why, what was in its context, how runs compare side by
side, and the ability to fork a run from a step with changed instructions.

This also serves the learner track as AI literacy: learners can see how an
answer was produced.

## Ownership and delivery

- Builds on EPIC-44 `DelegationRecord`s and existing message provenance.
  Inspection views show what was **recorded at execution time**. They never
  recompute permissions from current settings, which could show something
  false about past runs.
- Nothing is revealed that the owner could not already see. Thinking is still
  not stored (EPIC-44 decision).
- Cost uses admin-configured price metadata per model. Runs on the ChatGPT plan
  show plan usage, not dollars.
- Forks and comparisons create ordinary chat branches with their own provenance.
  They are not a new execution path.

## US-54.1: Per-step usage and cost

As a user, I want to know what a run cost and where.

Estimate: 2 days. Dependencies: EPIC-44.

Acceptance: each assistant message shows total input and output tokens and an
estimated cost. Expanding it breaks the totals down per agent and per step.
Models without pricing show tokens only. Plan-backed runs show "ChatGPT plan".

- [ ] Record per-step usage on delegation records and messages.
- [ ] Add optional price metadata to model settings; regenerate the client.
- [ ] Build the usage summary and breakdown; test totals, missing prices and plan runs.

## US-54.2: Capability manifest

As a user, I want to see what each agent could do in a run, and why.

Estimate: 2 days. Dependencies: EPIC-44.

Acceptance: for each agent in a run, a manifest lists the tools, skills, MCP
servers, file scope and sub-agents it had. Each entry names the grant that
allowed it (agent assignment, admin policy, model support, project selection).
The manifest is captured at execution time.

- [ ] Capture the effective capability set with grant reasons at execution time.
- [ ] Build the manifest panel; test accuracy against authorization fixtures.

## US-54.3: Context inspector

As a user, I want to see what the model was given.

Estimate: 2 days. Dependencies: US-54.2.

Acceptance: an inspector lists the prompt layers used (persona, main-agent
instructions, skills, learning mode, template), the retrieved chunks with their
files, the attached files, and anything truncated or omitted, with the reason.
Layer content is shown only to the owner. Retrieved text renders as untrusted
content.

- [ ] Record a context manifest (layer IDs and revisions, chunk references, truncations).
- [ ] Build the inspector; test owner-only access and the untrusted rendering path.

## US-54.4: Side-by-side comparison

As a user, I want to run the same prompt on different models or agent setups.

Estimate: 3 days. Dependencies: none.

Acceptance: from the composer or an existing message, the user can run a prompt
against two or three targets (models, or agent configurations). The answers
stream into columns, each showing usage and a link to its run graph. Each column
is a chat branch, and the user can continue from any of them.

- [ ] Implement multi-target submission as sibling branches within chat admission limits.
- [ ] Build the comparison layout (columns that stack on narrow screens).
- [ ] Test admission limits, branch provenance and continuation.

## US-54.5: Fork from a step

As a user, I want to change one sub-agent's instructions and re-run from there.

Estimate: 3 days. Dependencies: EPIC-44.

Acceptance: from a delegation node, "Fork from here" opens that sub-agent's
instructions for this run only. Re-running creates a new branch: steps before
the fork are reused from the record, and steps from the fork onward run fresh.
The original branch is unchanged. The sub-agent definition is not modified
unless the user saves it explicitly.

- [ ] Write an ADR for fork semantics (what is reused versus re-executed).
- [ ] Implement the fork execution path; build the fork UI.
- [ ] Test isolation of the original branch, scope inheritance and explicit-save behavior.

## US-54.6: Run diff

As a user, I want to see what changed between two runs.

Estimate: 1.5 days. Dependencies: US-54.4 or US-54.5.

Acceptance: comparing two branches shows a text diff of the final answers plus
differences in agents, models, tools called, usage and capability manifests.

- [ ] Build the diff view over recorded data; test it with fixture runs.
