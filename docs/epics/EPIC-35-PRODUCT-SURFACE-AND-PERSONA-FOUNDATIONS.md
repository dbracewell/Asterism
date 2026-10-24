# EPIC-35: Product surface and persona foundations

Status: US-35.1 confirmed complete on 2026-10-24; US-35.2 pending; source reassessed 2026-10-24. Source: [2026-10-17 codebase review](../reviews/2026-10-17-codebase-review.md), F8.

## Objective

Separate usable settings from planned capabilities and implement the persona invariant independently of agent configuration.

## Ownership and delivery

Implementation stays within the owning domain/component. Preserve existing authorization, shared mutation-cache invalidation and generated API contracts. Use fresh initialization for schema changes; no migrations, compatibility shims or live-database resets. Work on one story at a time, create its feature branch, complete relevant lint/type/format/test gates, synchronize generated clients when contracts change, document behavior and obtain user confirmation before merge.

## US-35.1: Finish planned-settings coverage and capability documentation

As a user, I want settings navigation to describe capabilities I can actually configure.

Estimate: 0.5–1 day. Dependencies: None. Existing planned presentation was
absorbed by US-33.2; preserve it rather than build it again.

Acceptance criteria:

Groups, Users, Image Generation, Code Execution and Export already carry
`Planned` badges in `admin-settings/lazy-sections.tsx` and render future-release
explanations. `SettingsCard` already renders the badges. Preserve that choice and
the corrected Code Execution label. Finish coverage of all five panes, keyboard
navigation and the distinction between available and planned settings. Existing
admin/user authorization and the backend user lifecycle are real; the Users pane
must describe the missing management UI/policy controls rather than imply that
all role-based access control is absent. Add a concise current-versus-planned
inventory to both READMEs and align it with `frontend-and-themes.md`. Providers,
agents, tools, theme editing and captioning stay discoverable. Do not implement
placeholder administration APIs or activate image generation/code execution.

Tasks:

- [x] Retain the implemented Planned badges, future-release panes and corrected labels delivered with US-33.2; no new placeholder navigation design is required.
- [x] Audit all five planned panes, correct remaining capability copy (including existing authorization versus planned Users administration), and cover badges/keyboard/accessibility without inventing APIs.
- [x] Add a current-versus-planned capability inventory to READMEs and product planning.

Completed checklist history: [archive](../archive/todo-completed-2026-10-24.md#us-351--planned-settings-and-capability-documentation).
Implementation inventory: [current versus planned product surface](../architecture/frontend-and-themes.md#current-versus-planned-product-surface).
Verification: [US-35.1](../reviews/us-35.1-verification-2026-10-24.md).
This story does not activate the distinct persona/default-profile policy below.

## US-35.2: Implement distinct user persona/default-profile foundations

As a user, I want at least one persona profile, exactly one default, and separate USER.md instructions without changing my main-agent configuration.

Estimate: 5–8 days, re-estimate after the ADR. Dependencies: preserve the completed
EPIC-31 trust checks; establish US-34.3's baseline before changing execution/UI
contracts. US-35.1 is independent and does not supply persona storage.

Acceptance criteria:

No persona table/service exists in the registered schema. `user/service.py`
currently provisions only the singleton main-agent configuration; that is not a
persona profile. The composer accepts an optional profile layer, but chat
execution supplies `user_profile_id=None` and no persona layer. Typed context and
memory namespace fields are extension points, not an implemented persona store.

Provisioning creates an owner-scoped persona in the same transaction as user and
main-agent creation. Service and database rules preserve at least one persona
and exactly one default, including default/delete races and direct constraint
violations. Define selection ownership (chat versus user default), deletion of a
selected persona, edit/default-switch effects on pending work, and explicit
revision/conflict behavior in the ADR before schema/UI implementation. Validate
USER.md size/content as user instructions with no capability-granting effect.

Capture the selected persona identity/revision and prompt input in server-owned
execution snapshots and provenance. Specify new-turn, resume, regeneration and
delegation behavior so a changed default cannot silently rewrite an accepted
execution. Reauthorize owner/profile access; IDs and namespace keys grant no
access. General chats still never delegate, and project delegates retain their
capability/model/file ceilings. No long-term memory engine, profile memory store,
automatic memory reads/writes, or cross-chat summaries are activated.

Tasks:

- [ ] Write an ADR for persona ownership, user-default versus chat selection, USER.md limits, edit/delete/default races and new-turn/resume/regeneration/delegation binding; distinguish it from `agent_profiles` and typed future memory namespaces.
- [ ] Implement fresh-initialized schema/service invariants, atomic provisioning and owner-scoped persona lifecycle with race/authorization tests; no migrations or compatibility paths.
- [ ] Expose typed APIs, regenerate Hey clients and implement profile selection/settings through TanStack Query and existing UI components.
- [ ] Test immutable execution/prompt/provenance binding, edit/default/delete races, cross-owner denial, delegation ceilings and unavailable/error states; document memory as future work and run all relevant gates.
