# EPIC-68: Sub-agents in General chat

Status: in progress (US-68.1 confirmed and merged; US-68.2 implemented, awaiting confirmation). Source: user request (2026-11-08).

## Objective

Today only project chats can delegate: `resolve_delegation_scope` returns
nothing when a chat has no project, and AGENTS.md states "General chats never
delegate". Let the main agent delegate to sub-agents in General chats too.

## Ownership and delivery

- Delegation stays allowlist-based. Projects already pick their sub-agents; for
  General chats the user picks a "General chat sub-agents" set on their
  main-agent configuration in User Settings. A new user starts with none.
- `sub_agent` stays an internal tool: available only when the live General set is
  non-empty, admin policy allows it, and the chat model has explicit
  `supports_tools=True`. Prompt text, chat preferences and approvals cannot grant it.
- File scope for a General-chat child is the parent chat's own attachments (the
  same or narrower than the parent), never project files.
- Same live rechecks as project delegation: a turn records the scope revision,
  and a changed set refuses the next delegation with "start a new turn".
- Fixed models are kept; an unavailable model blocks that target, no substitution.
- Update AGENTS.md §2.3/§2.4 and the context-isolation and agent-runtime docs; write an ADR.

## US-68.1: General delegation scope in the backend

As a user, I want my main agent to hand work to my sub-agents in a normal chat.

Estimate: 2 days. Dependencies: none.

Acceptance: the main-agent configuration stores an ordered, owner-consistent set
of sub-agent IDs for General chats with a revision counter. Delegation scope for
a chat without a project resolves from that set. `require_delegation_target`
works for both scopes and still refuses targets outside the live set. Deleting a
sub-agent removes it from the set. Delegation records and run inspection show
which scope (General or project) authorized each call.

- [x] Write the ADR (amends the "General chats never delegate" rule) and update AGENTS.md and architecture docs.
- [x] Add the General set to the main-agent configuration and resolve it in `resolve_delegation_scope`.
- [x] Tests: no set → no `sub_agent` tool; set → delegation works; removing a target mid-turn is refused; child file scope is limited to the chat's attachments; owner isolation.

## US-68.2: Choose General chat sub-agents

As a user, I want to pick which sub-agents my main agent can use outside projects.

Estimate: 1 day. Dependencies: US-68.1.

Acceptance: User Settings → Main agent has a sub-agent picker for General chats,
showing each sub-agent's model and whether it's currently available. The
composer shows when delegation is available in a General chat. Help explains the
difference between General and project sub-agents.

- [x] Build the picker with generated client hooks; show availability.
- [x] Update help and glossary; unit tests and an E2E delegating from a General chat with a fake provider.
