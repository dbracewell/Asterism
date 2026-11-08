# EPIC-70: User groups and model/tool access

Status: in progress (US-70.1 complete). Source: user request (2026-11-08).

## Objective

Admins can only enable or disable a model or tool for everyone. Add user groups:
each group has access to all or a subset of the enabled models and tools. The
built-in groups are **admin**, **educator** and **student**. New users join
**student**; the admin account is in **admin**; approving educator access moves a
user to **educator**, and revoking it moves them back.

## Ownership and delivery

- Each user is in exactly one group (decided from "moves into the educator
  group"; revisit in the ADR if multiple groups are needed). The three built-in
  groups can't be deleted or renamed. Admins can create additional custom groups
  and move users between non-admin groups.
- Better Auth stays the source of truth for the admin role
  ([ADR-0057](../adr/0057-user-identity-copy.md)). The admin group mirrors the
  JWT `admin` role; it is not assigned by editing group membership.
- The educator grant (`educators`, [ADR-0053](../adr/0053-classes-and-educators.md))
  becomes group membership: approve → educator group, revoke → student group. The
  request/approve flow stays. Replace the grant table rather than keeping both.
- Group access only narrows admin policy. Effective access = admin-enabled ∩
  group allowlist ∩ explicit agent assignment. Each group's list is either "all
  enabled" (which follows future additions) or an explicit subset.
- Checked live and centrally: model access extends `available_user_model` /
  `ModelAvailability`, so chat model selection, compare, sub-agent bindings,
  delegation, course adds and study tools all use it. Tool access extends the
  existing tool policy (tools, MCP servers and image generation).
- Losing access never substitutes a model: the chat, sub-agent or course item
  shows it as unavailable, same as a disabled model today.
- Background models chosen by the admin (titles, captioning, verification)
  are not restricted by group; record that in the ADR.

## US-70.1: Groups and membership

As an admin, I want every user in a group, with sensible defaults.

Estimate: 2 days. Dependencies: none.

Acceptance: a `groups` table with the three built-ins seeded at initialization and
a non-null group on every user. New users land in student; admins in admin.
Educator approval and revocation move users between educator and student, and
class/educator checks read the group live. Admins can create, rename and delete
custom groups (deleting a group with members is refused or moves them to student;
decide in the ADR).

- [x] Write the ADR (replaces the educator grant in ADR-0053; admin-role mirroring).
- [x] Implement groups, seeding, membership and the educator flow change; update AGENTS.md §2.1.
- [x] Tests: defaults, educator approve/revoke, admin mirroring, owner isolation, built-ins protected.

## US-70.2: Group model and tool access, enforced

As an admin, I want to limit which models and tools each group can use.

Estimate: 2.5 days. Dependencies: US-70.1.

Acceptance: each group stores "all" or a subset for models and for tools. Model
pickers, sub-agent editors and capability pickers list only what the user's group
allows. Execution, delegation, compare, study generation and course adds refuse
models and tools outside the group, live. Existing bindings to a now-forbidden
model show as unavailable with the reason "not available to your group".

- [ ] Extend `ModelAvailability` and tool policy with group access; add the unavailable reason.
- [ ] Tests across every entry point (chat, compare, delegation, sub-agent save, course add, study tools, title model exemption).

## US-70.3: Admin Settings → Groups

As an admin, I want to manage groups and members in one place.

Estimate: 1.5 days. Dependencies: US-70.2.

Acceptance: an Admin Settings page lists groups with member counts; edits model
and tool access with "all" or a checklist; moves users between groups from the
existing user list. Admin → Educators approves requests into the educator group.
Settings export/import ([EPIC-63](EPIC-63-ADMIN-SETTINGS-EXPORT-AND-IMPORT.md))
includes custom groups and access lists (not membership). Users see their group
on their profile. Help covers groups.

- [ ] Build the page and user-list group control; regenerate the client.
- [ ] Extend settings export/import; help, glossary, unit tests and an E2E restricting a student's models.
