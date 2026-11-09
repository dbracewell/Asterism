# EPIC-75: Skills follow-ups

Status: in progress (US-75.1–75.3 done; US-75.4). Source: user request (2026-11-09), after using skill drafting
(EPIC-71). Comes before EPIC-72 (Canvas).

## Objective

Fix three problems found while using skills:

1. Long model names overflow the sub-agent cards in agent settings.
2. Sub-agents can't use skills. They should be able to, without `/`: each
   sub-agent sees the names and descriptions of its skills and loads one with a
   tool when it decides the skill applies.
3. The Skills settings page squeezes the activation notice into a small box,
   and assignment happens somewhere else (a dialog under Agents). The page
   should use the full width, show and change assignment beside each skill,
   and page through long lists.

## Ownership and delivery

- Skills stay private to their owner, and admin `skills_enabled` still gates
  every use. Skill text never grants tools, files, MCP or delegation; this
  also applies to skill text loaded by an agent.
- Sub-agent skills are explicit assignments on the sub-agent definition, like
  its tools. A sub-agent gets only its own assigned skills, never the main
  agent's or a chat's active skills.
- `load_skill` is an internal, context-managed tool like `sub_agent`. It is
  derived server-side (assigned skills present, policy on, model
  `supports_tools=True`) and is omitted from user capability pickers.
- Each skill load is recorded with the run (skill id, revision, which agent
  loaded it) so the run record and run graph show it.
- Main-agent chats keep explicit `/` activation. Whether the main agent should
  also get the catalog and `load_skill` is decided in the ADR (US-75.3) and is
  off unless the user approves it.

## US-75.1: Truncate long model names

As a user, I want long model names to fit their cards.

Estimate: 0.5 day. Dependencies: none.

Acceptance: on the sub-agent cards in Settings → Agents, a long model name
(for example `unsloth/Qwen3.8-27B-GGUF:UD-Q4_K_M`) stays on one line with an
ellipsis and the availability icon stays visible. The full name is available
on hover/focus and to screen readers. Other places that show a model name in a
narrow space (project sub-agents, General chat set, run graph, model chips) get
the same check. No horizontal overflow at 320px.

- [x] Fix the card header (`min-w-0` on the label, full name in a tooltip/title); audit other model-name spots.
- [x] Unit test for the accessible full name; E2E overflow check with a long model name at 1280 and 320px.

## US-75.2: Skills page layout and assignment

As a user, I want to see and change which skills my main agent can use from
the Skills page, and to manage a long list easily.

Estimate: 1.5 days. Dependencies: none.

Acceptance: the activation notice is a full-width banner (an `Alert`, not a
centred empty-state box). Each skill row shows whether it's assigned to the
main agent, with a control to assign or unassign it there (same optimistic
revision rules as the Agents dialog). The list pages through skills with a
visible count (for example "11–20 of 34") and a page-size choice, keeps search
and the page in the URL, and stays usable at 320px. The Agents dialog keeps
working and both places stay in sync.

- [x] Banner; per-row assignment state and control; pagination with count and URL state.
- [x] Help updates; unit tests; E2E covering assignment from the list, paging and narrow widths.

## US-75.3: Skills for sub-agents (backend)

As a user, I want my sub-agents to use skills I assign to them, choosing when
to load them on their own.

Estimate: 2.5 days. Dependencies: none.

Acceptance: an ADR records the design. Sub-agent definitions can be assigned
skills (lift the main-only constraint on `agent_skills`, with owner checks and
the same per-request limit). When a sub-agent runs with skills assigned and the
policy on, its prompt gains a skills catalog layer (name and description of
each assigned skill) and it gets `load_skill(name)`, which returns the current
skill body. Eligibility is checked live on every load; an unassigned, deleted
or disabled skill, or the policy turned off, returns a tool error. Loaded text
is treated as instructions only and grants nothing. Loads are recorded on the
delegation record. Project pack export/import carries sub-agent skill
assignments where packs already carry skills.

- [x] ADR (catalog layer, `load_skill`, recording, main-agent decision); schema and assignment API for sub-agents.
- [x] Catalog layer and `load_skill` tool; tests for scope, live eligibility, policy, recording and capability isolation.

## US-75.4: Skills for sub-agents (UI)

As a user, I want to pick a sub-agent's skills and see when it used one.

Estimate: 1.5 days. Dependencies: US-75.3.

Acceptance: the sub-agent editor has a Skills picker (searchable, paged) next
to its tools. The run graph and delegation details show "Loaded skill
<name>" for each load. Help explains that sub-agents load their skills on
their own, while main-agent chats use `/`.

- [x] Sub-agent skills picker; skill loads in run graph and delegation details; approving requested sub-agent skills in pack import review.
- [x] Help; unit tests; E2E from assigning a skill to a sub-agent to seeing its load in a delegated run.
