# ADR-0059 — Sub-agents in General chats

Status: accepted; backend implemented in US-68.1 and the settings picker and
composer indicator in US-68.2, both on 2026-11-08
([EPIC-68](../epics/EPIC-68-SUB-AGENTS-IN-GENERAL-CHAT.md)). Amends the rule
"General chats never delegate" in AGENTS.md §2.3 and the delegation sections of
the [agent runtime](../architecture/agent-runtime.md) and
[context isolation](../architecture/context-isolation.md) docs.

## Context

Delegation is allowlist-based: a project selects which of the owner's sub-agent
definitions its chats may delegate to, and `resolve_delegation_scope` returns no
scope for a chat without a project, so the internal `sub_agent` tool is never
offered there. Users want the main agent to hand work to sub-agents in ordinary
General chats as well.

## Decision

### A General set on the main-agent configuration

Each user's main-agent configuration owns an ordered set of their sub-agent
definitions for General chats (`general_sub_agents`: user, agent, position)
and its own revision counter (`agent_profiles.general_sub_agents_revision`, used
on the main row only). A new user starts with an empty set and revision 1.

- Rows reference `(agent_profiles.id, user_id, sub_agent = true)` through the
  same owner-and-role composite foreign key project selections use, so the set
  can hold only the owner's sub-agents, never the main configuration or another
  user's definitions, even through direct SQL.
- `PUT /settings/user/main-agent/general-sub-agents` replaces the whole ordered set with an
  expected revision (409 on mismatch). A change bumps the revision; saving the
  same list does not. `GET` returns the set with live availability.
- Deleting a sub-agent bumps the revision when it was in the set, and the row
  goes with the definition (cascade). Editing the main configuration does not
  touch the set's revision; the two are independent.
- `GET` and `PUT` also return `delegation_allowed`: whether admin policy
  currently enables `sub_agent`. It is display-only and grants nothing.

The set lives with the main agent, not with chats, so it is one choice per user
that applies to every General chat, and a project chat ignores it.

### One scope type, two sources

`DelegationScope.project_id` becomes optional: `None` means the General set
authorized it, and `context_revision` is then the set's revision. A chat's
scope is decided by where the chat is, live: a project chat uses its project's
selections, any other chat uses the General set. Nothing else changes:

- `sub_agent` is still internal. It is offered only when the live scope has an
  eligible target other than the caller, admin policy allows it and the chat
  model has explicit `supports_tools=True`. Prompt text, chat preferences and
  approvals cannot grant it.
- `require_delegation_target` rechecks every call against the live scope: same
  source (project or General), same revision, target still in the set,
  definition still the same, fixed model still available. A changed set refuses
  the next delegation with "start a new turn". Unavailable models block that
  target and nothing is substituted.
- Moving a chat into or out of a project changes its source, so a turn started
  under one source can't delegate under the other.

### File scope

A General chat has no project files. Its file scope is the chat's own
attachments on the active branch, and a child receives the same or a narrower
set, exactly as it inherits the ceiling in a project chat. A child can never
reach project files through a General chat.

### Provenance

Run inspection and delegation records say which source authorized each target:
sub-agent capability entries carry `general_selection` instead of
`project_selection`, and each sub-agent trace stores `delegation_scope`
(`general` or `project`).

## Consequences

- General chats can delegate once the user picks a General set; with an empty
  set nothing changes.
- User Settings → Agents → Main agent shows the set with each fixed model and
  its availability, and a dialog replaces it under the revision guard. A newly
  chosen target needs an available model; an already chosen unavailable one
  stays removable.
- In a General chat the composer shows a robot icon when the set is non-empty:
  available when policy allows, the chat model has `supports_tools=True` and a
  chosen fixed model is available; otherwise it names the block. It mirrors
  the server checks for display only; each turn still re-derives the scope.
- The architecture docs and AGENTS.md describe two allowlists instead of one.
- Future memory partitions are unaffected: a General chat's derived context is
  still keyed by user, profile and chat.
