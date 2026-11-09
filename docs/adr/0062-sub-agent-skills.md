# ADR-0062 — Sub-agents load their own skills with `load_skill`

Status: accepted; backend in US-75.3 and UI in US-75.4 on 2026-11-09
([EPIC-75](../epics/EPIC-75-SKILLS-FOLLOW-UPS.md)).

## Context

Skills (SKILL.md instruction documents) reach a chat only through explicit `/`
activation, and only skills assigned to the main agent can be activated. A
delegated sub-agent never receives the chat's active skills, so the user has no
way to give a specialist sub-agent standing know-how short of pasting it into
its instructions. Sub-agents run without a person in the loop, so `/` does not
fit them: they need to see which skills they may use and decide when one
applies.

## Decision

### Assignments live on the sub-agent definition

`agent_skills` holds assignments for both roles. The composite foreign key
(`agent_id`, `user_id`, `sub_agent`) to `agent_profiles` already ties each row
to an owned definition of the stated role; the `sub_agent = false` check is
removed. A sub-agent's skills are read and replaced through
`GET/PUT /agents/sub-agents/{agent_id}/skills` with the same contract as the
main agent's: the whole list of at most 100 unique owned skill ids plus the
definition's `config_revision` as an optimistic token. A change bumps the
revision, so an in-flight delegation to that definition is cancelled, as for
any other definition edit. Class-managed definitions refuse changes. A
sub-agent gets only its own assignments, never the main agent's or the chat's
active skills.

Main-agent eligibility (slash discovery, activation, replay, the Skills page)
reads main-role rows only.

### A skill catalog layer and the internal `load_skill` tool

When a sub-agent runs with at least one assigned skill, the admin
`skills_enabled` policy on and a model with `supports_tools=True`, it gets:

- a `skill_catalog` prompt layer, ordered after `skills` and before `runtime`,
  listing the name and description of each assigned skill and telling it to
  load one with `load_skill` before following it;
- the internal tool `load_skill(name)`, which returns the skill's current id,
  name, revision and instructions.

`load_skill` is context-managed like `sub_agent` and `search_knowledge`: it is
omitted from capability pickers and derived server-side. Unlike them, its admin
gate is the Skills policy, not the Tools allowlist (`active_tools`), so one
switch (Admin Settings → Skills) controls all skill use. It is not listed among
admin tools. Its availability is the sub-agent's own, so it is not inherited
from, or limited by, the parent run's internal-tool ceiling.

Eligibility is checked live on every call: the policy must still be on and the
skill must still be owned and assigned to the calling definition (the server
uses the tool scope's `caller_agent_id`, never model input). Otherwise the call
returns a tool error. The catalog is read when the sub-agent starts; a skill
added later is not listed until its next delegation.

### Loaded text is instructions that grant nothing

The platform rules say that a skill loaded with `load_skill` has the same
standing as an activated skill: below project instructions, above user
requests, and unable to grant tools, files, MCP or delegation. The tool result
is the skill body only.

### Loads are recorded on the delegation record

`DelegationRecord.skill_loads` lists each successful load (skill id, name,
revision) in call order, derived from the child's `load_skill` results as they
arrive. The record already carries the sub-agent's id, so each load is tied to
the agent that made it. The run graph and delegation details (US-75.4) read it.

### Packs carry sub-agent skill requests

A pack sub-agent may list `requested_skills`: keys of skills in the same pack.
Export fills it from the sub-agent's assignments to skills that are also
exported. Import assigns a requested skill only when the user approves it in
`approved_skills` and includes that skill, and only while the Skills policy is
on, mirroring main-agent assignment requests.

### The main agent keeps `/`

The main agent does not get the catalog or `load_skill`. Chats keep explicit
activation so the person sees and controls which instructions shape the reply.
Giving the main agent model-chosen loading is a separate decision for the
user; this ADR does not make it.

## Consequences

- Sub-agent skills cost no prompt space until loaded, apart from the catalog.
- A user can see, after the fact, which skills each delegation used.
- One switch turns all skill use off, including in-flight loads.
- A prompt-injected sub-agent can load only skills its owner assigned to it.
