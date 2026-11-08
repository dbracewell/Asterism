# ADR-0058 — User groups

Status: accepted and implemented for US-70.1 on 2026-11-08
([EPIC-70](../epics/EPIC-70-USER-GROUPS-AND-ACCESS.md)). Replaces the educator
grant in [ADR-0053](0053-classes-and-educators.md); the request flow, class
scope and student privacy rules there are unchanged. Group model and tool access
added for US-70.2, and the admin page, export and import for US-70.3, on
2026-11-08.

## Context

Administrators can only turn a model or tool on or off for everyone. EPIC-70 adds
groups so access can differ, starting with the three kinds of user the product
already has: administrators, educators and students. ADR-0053 recorded educator
access as a grant row in `educators`, separate from anything else about the
user. Better Auth owns identity and the `admin` role
([ADR-0057](0057-user-identity-copy.md)).

## Decision

### One group per user

`groups` holds every group; `users.group_id` is non-null, so each user is in
exactly one. One group per user follows from "approving moves the user into the
educator group" and keeps access a single lookup. Multiple groups per user were
rejected until a need appears; they would force a rule for combining access.

### Built-in groups

`admin`, `educator` and `student` are seeded when the `groups` table is created,
with those strings as their ids, so code and tests refer to them directly. They
cannot be renamed or deleted. New users join `student` (the column default).

### The admin group mirrors the token role

Better Auth stays the source of truth for the admin role. On each authenticated
request the backend brings the row in line with the verified token, cached per
user and role like the name and email copy:

- role `admin` and any other group → `admin`;
- role `user` and group `admin` → `student`.

Nothing else can put a user into or take a user out of `admin`: the membership
API refuses it, and an admin-role user's group cannot be changed there. Admin
checks keep reading the token role, never the group.

### Educator access is membership

The `educators` table is removed. Asking for access writes a row to
`educator_requests` (the pending request only). An administrator's decision is a
group change:

- approve → `educator`, and the request row is deleted;
- deny → the request row is deleted;
- revoke → `student`.

`require_educator` reads the group live on every educator request, so revoking
works at once, as before. Members of `admin` may also run classes: one group per
user would otherwise stop an administrator from ever teaching. This replaces
ADR-0053's "an administrator is not automatically an educator"; administrators
still see no student chats through a class. An admin-role user who loses the
role drops to `student`, including one who was an educator before.

Revoking leaves classes in place, unmanaged, and invites to them stop working,
exactly as before.

### Custom groups

Administrators can create, rename and delete further groups and move non-admin
users between non-admin groups (including into and out of `educator`, which is
the same as approve and revoke). Names are unique, case-insensitively, and 1 to
80 characters. Deleting a group that still has members is refused with a 409:
moving people silently to `student` could change what they can use without the
administrator noticing. Membership is read live, never cached.

### Model and tool access (US-70.2)

Each group stores a model list and a tool list, each either null ("every enabled
one", which follows models and tools the administrator enables later) or an
explicit list (`groups.model_access`, `groups.tool_access`, JSON). Access is
effective only where admin policy, the group list and the agent's own assignment
all allow it: a group list never enables anything. Lists are replaced whole with
`PUT /groups/{id}/access`; they may name only shared models and user-configurable
tools. Entries for deleted models are ignored.

- **Models.** `ModelAvailability` reads the group once per check, live. A shared
  model outside the list is unavailable with the reason "Not available to your
  group", so every path that already uses it refuses: chat sends and retries,
  compare, drafts, delegation, sub-agent saves, course adds, pack imports, study
  tools and verification. Model pickers leave such models out; existing chat
  selections and sub-agent bindings keep their model and show the reason.
  Nothing is retargeted. A user's own ChatGPT plan models are governed by the
  ChatGPT plan policy and are not group-limited.
- **Tools.** `user_active_tools` is the admin's active tools narrowed by the
  group. It decides the tools offered to a turn, the capability picker
  (`/tools/active`) and agent saves, and the tool registry rechecks the group at
  every call. The internal tools `sub_agent` and `search_knowledge` are decided by
  live context as before and can't be listed. MCP servers and image generation
  are not implemented yet; when they are, they join the same list.

### Managing groups (US-70.3)

Admin Settings → Groups lists groups with member counts and edits each group's
access as "every enabled" or a checklist, from `GET /groups/access-options`
(shared models and user-configurable tools, each marked if the administrator
turned it off). Admin Settings → Users moves non-admin users between non-admin
groups; admin-role users show Admin and have no control. Users see their own
group in Settings → General (`UserSettings.group`); only administrators change
it.

Settings export carries every group's name and access lists, with models by
provider and model name like other model references, but never membership.
Import matches built-in groups by key (keeping their names) and custom groups by
name, case-insensitively; it adds missing custom groups, replaces the access
lists of the groups it names, and never deletes a group or moves anyone. A file
whose custom group takes a built-in group's name, repeats a name, lists an
internal tool or names a model it doesn't contain is refused, and nothing
changes.

### Background models

Models the administrator picks for background work (the draft model that writes
chat titles, and image captioning) are not checked against any group. Answer
verification and study tools run on a model the user chooses, so they are.

## Consequences

- Every user row needs a group; there is no migration (reset data if needed).
- The admin user list shows each user's group. The educator status shown there
  and on the Classes page is derived from the group and a pending request.
- Model and tool access is per group and only narrows admin policy, and is
  managed in Admin Settings → Groups. Settings files carry it; membership stays
  with each installation.
