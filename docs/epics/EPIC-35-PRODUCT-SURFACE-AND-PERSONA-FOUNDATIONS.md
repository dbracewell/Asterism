# EPIC-35: Product surface and persona foundations

Status: proposed / pending. Source: [2026-10-17 codebase review](../reviews/2026-10-17-codebase-review.md), F8.

## Objective

Separate usable settings from planned capabilities and implement the persona invariant independently of agent configuration.

## Ownership and delivery

Implementation stays within the owning domain/component. Preserve existing authorization, shared mutation-cache invalidation and generated API contracts. Use fresh initialization for schema changes; no migrations, compatibility shims or live-database resets. Work on one story at a time, create its feature branch, complete relevant lint/type/format/test gates, synchronize generated clients when contracts change, document behavior and obtain user confirmation before merge.

## US-35.1: Make unfinished settings surfaces explicit

As a user, I want settings navigation to describe capabilities I can actually configure.

Estimate: 1–2 days. Dependencies: None.

Acceptance criteria:

Groups, Users, Image Generation, Code Execution and Export placeholders are removed from active configuration or clearly marked unavailable with honest scope. Typographical labels are corrected. Existing providers, agents, tools and captioning remain discoverable; no placeholder is represented as a working feature.

Tasks:

- [ ] Inventory placeholder panes and choose hidden or explicit unavailable presentation; document their separate future feature ownership.
- [ ] Update navigation/labels and keyboard/accessibility tests without inventing administration APIs.
- [ ] Add a current-versus-planned capability inventory to READMEs and product planning.

## US-35.2: Implement distinct user persona/default-profile foundations

As a user, I want at least one persona profile, exactly one default, and separate USER.md instructions without changing my main-agent configuration.

Estimate: 5–8 days. Dependencies: EPIC-31 trust checks; finalize persona ownership contract before implementation.

Acceptance criteria:

Provisioning creates a persona atomically; service and database rules preserve at least one and exactly one default. CRUD/default/delete races and ownership are tested. USER.md is validated user-owned data. Profile selection feeds the optional prompt layer and provenance explicitly without granting tools. No long-term memory engine or automatic cross-chat summaries are activated.

Tasks:

- [ ] Write an ADR for persona ownership, default selection, USER.md limits and execution binding; distinguish it from agent_profiles and typed future memory namespaces.
- [ ] Implement fresh-initialized schema/service invariants, atomic provisioning and owner-scoped persona lifecycle with race/authorization tests; no migrations or compatibility paths.
- [ ] Expose typed APIs, regenerate Hey clients and implement profile selection/settings through TanStack Query and existing UI components.
- [ ] Test prompt/provenance integration, default/delete races, cross-owner denial and unavailable/error states; document memory as future work and run all relevant gates.
