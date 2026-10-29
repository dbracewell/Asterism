# EPIC-44: Agent constellation

Status: complete. Source: the approved visual design audit (2026-10-26).

## Objective

Make multi-agent coordination, Asterism's defining capability, the product's one
signature visual moment. Today sub-agent activity is a small bordered box with a
bot icon. The new view draws the main agent and each delegated sub-agent as stars
joined by chart lines, echoing the constellation logo.

## Ownership and delivery

Mostly frontend presentation over the sub-agent activity stream. US-44.1 added
three display fields to the live `sub_agent` event (`parent_execution_id`,
`model_id`, `model_name`) so lines and model labels are exact: the old fields
couldn't tell parallel nested delegations apart. There are no authorization
changes, and nothing is revealed that the user can't already see (the model is
the fixed binding of the user's own sub-agent definition). US-44.2 persists one
`DelegationRecord` per delegation on the assistant message whose step ran it, so
history can render the same graph and each agent's timeline and output. The record
holds identity, model, timing, the child's tool calls and results, and its output
or error. Thinking and prompts are not kept. Uses `flare` only for live state and `star` for settled state
(EPIC-41). Reuses `AgentTimeline` from US-43.2. This is the only place in the
product with orchestrated, non-user-triggered motion.

## US-44.1: Delegation graph

As a user, I want to see my agents working together.

Estimate: 2 days. Dependencies: EPIC-41, US-43.2.

Acceptance: while delegation runs, an inline SVG graph shows the main agent and
each sub-agent (name and model) as nodes joined by lines. Running nodes glow in
`flare`; completed nodes settle to `star` and failed nodes use destructive
styling. Layout is deterministic and works from 320px wide up to many agents
(wrapping or scrolling beyond a set maximum).

- [x] Design the layout (deterministic placement of up to N nodes, plus an overflow strategy); build the SVG component.
- [x] Map the existing activity states to node states; test state transitions and many-agent/narrow layouts.

## US-44.2: Compact summary

As a user, I want a finished run to take up little space.

Estimate: 1 day. Dependencies: US-44.1.

Acceptance: after the run completes, the graph collapses to a summary line, for
example "3 agents · 12s · 7 tools". Expanding it shows each agent's timeline and
output. History loaded from the server renders in the collapsed state.

- [x] Build the summary and expand interaction; test reload and history rendering.

## US-44.3: Accessibility and reduced motion

As a user with assistive technology or reduced-motion preferences, I want the
same information.

Estimate: 0.5 day. Dependencies: US-44.1.

Acceptance: under reduced motion the graph is static. Screen readers get an
equivalent ordered list with live status announcements. Nodes can be reached and
expanded by keyboard.

- [x] Add the text equivalent, a polite live region and keyboard handling; add axe and keyboard tests.
