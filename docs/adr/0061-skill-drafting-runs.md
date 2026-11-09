# ADR-0061 — Skill drafting runs reuse a hidden chat

Status: accepted; backend implemented in US-71.1 on 2026-11-08
([EPIC-71](../epics/EPIC-71-MODEL-WRITTEN-SKILLS.md)).

## Context

EPIC-71 lets a user describe a skill and have their main agent write a
SKILL.md draft. The writer must stream progress (including delegations), accept
follow-up instructions, stop on cancel and stay inspectable like a chat run. It
may delegate only through the General chat sub-agent set (ADR-0059) and use
only tools assigned to the main agent. Nothing becomes a skill until the user
saves it through the normal create path.

Chats already provide every one of those behaviours: the send/receipt path,
the WebSocket job with cancel and resume, branch replay, the run record and run
graph, General delegation scope (a chat without a project), tool policy, group
model access (`require_chat_model`) and compaction. A new run type would have
to duplicate them.

## Decision

### A drafting run is a chat with `purpose = "skill_draft"`

`chats.purpose` is `conversation` (default) or `skill_draft`. It is set only
by the server when a draft starts and never changes. A drafting chat:

- has no project, so delegation resolves through the General chat set with
  the usual live checks (ADR-0059); moving it into a project is refused;
- runs in Standard learning mode with no mode layer, and with no active
  skills: a send that selects skills is refused;
- keeps the chat's persona layer, so the writer knows who the skill is for;
- is hidden from the chat list (`chatSessionGetMany`) and from search, but is
  reachable by id for streaming, the run record, the run graph and deletion.

Streaming, cancel, regeneration and revisions use the existing chat endpoints
and WebSocket. A revision is an ordinary follow-up message.

### The writing instructions are a fixed `task` prompt layer

The composer gains a `task` layer kind, ordered after `mode` and before
`project`. It is server-owned text (`SKILL_WRITER_INSTRUCTIONS`, revision 1)
added only for the main agent of a drafting chat; delegated sub-agents never
receive it. The platform rules name it in the conflict order. Like every other
layer it cannot grant tools, files, MCP or delegation, and the instructions
say so: the skill text the writer produces is instructions only.

### Output contract and validation

The writer ends each reply with exactly one fenced block whose info string is
`skill`, containing a complete SKILL.md (frontmatter with `name` and
`description`, then Markdown instructions). `GET /skills/drafts/{chat_id}`
reads the latest completed assistant message on the active branch, extracts the
last `skill` block and validates it with `parse_document`, the same check skill
create uses. It returns `ready` with the content, name and description, or
`invalid` with the validation error, or `pending` / `none`. The client turns an
invalid draft into a follow-up asking the writer to fix it (US-71.2). The draft
is never stored as a skill; saving goes through `skillCreate`.

### Policy is checked live

Starting a draft requires the `skills_enabled` policy. Building the prompt for
any turn of a drafting chat (send, resume, regenerate, fork) checks it again
and fails the turn when skills are off, so turning the policy off stops
drafting immediately. Reading a draft also requires it.

## Consequences

- One code path for streaming, cancel, replay and inspection; the run graph
  shows the writer's tool calls and delegations with no new UI contract.
- Drafting chats count against the user's chat capacity like any chat.
- Hidden chats accumulate until deleted. The editor deletes the chat when the
  user saves or discards the draft (US-71.2); otherwise they remain owner data
  and are removed with the account.
- Anything that lists chats must filter with `select_conversations`; new list
  or export surfaces must use it too.
