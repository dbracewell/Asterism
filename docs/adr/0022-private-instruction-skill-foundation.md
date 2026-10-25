# ADR-0022 — Private instruction skills and activation eligibility

Status: accepted; US-40.1 user-confirmed complete on 2026-10-25.

## Decision

Store private SKILL.md-style documents in an owning `skills` domain. Canonical
Markdown source is authoritative; parsed name/description are derived searchable
metadata. Bound and validate YAML syntax before node composition; never construct
arbitrary YAML objects or accept executable/capability frontmatter declarations.

Keep ownership, assignment and policy separate. Owners can manage their documents
while activation is disabled. Explicit owner-consistent main-agent assignments
and live admin `skills_enabled` policy determine discovery eligibility. Policy
defaults to disabled and is not tied to model tool support. Neither ownership nor
skill text grants tool/file/MCP/delegation permissions.

Assignments use composite owner/role foreign keys and the main-agent configuration
revision for compare-and-set updates. Skill deletion removes assignments and bumps
that revision atomically, while the document revision protects concurrent edits
and deletion. Do not couple assignment lifetime to future recorded executions.

The agent runtime does not import skill storage or policy. Future chat composition
roots will resolve snapshots through the owning domain. Persistent per-branch
activation and per-turn immutable provenance remain US-40.3, with UI in US-40.2
and US-40.4. No automatic activation, skill-directory access, or script execution
is added by this foundation.

## Consequences

New `skills` and `agent_skills` tables are registered for fresh initialization;
there are no migrations or working-data resets. CRUD and eligibility APIs can be
verified independently before UI/runtime work. The admin owns activation policy,
not a shared copy of users' private skill content. Existing agent settings retain
their contract; assignment editing is a separate revisioned API so saving unrelated
main-agent defaults cannot silently clear skill assignments.

See the [skills architecture contract](../architecture/skills.md) for bounds,
endpoint semantics, lifecycle behavior, and later-story boundaries.
