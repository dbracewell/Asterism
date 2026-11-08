# ADR-0058 — User groups

Status: accepted and implemented for US-70.1 on 2026-11-08
([EPIC-70](../epics/EPIC-70-USER-GROUPS-AND-ACCESS.md)). Replaces the educator
grant in [ADR-0053](0053-classes-and-educators.md); the request flow, class
scope and student privacy rules there are unchanged.

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

### Background models

Group access (US-70.2) will only narrow what a user may choose. Models the
administrator picks for background work (titles, captioning, verification) are
not checked against any group.

## Consequences

- Every user row needs a group; there is no migration (reset data if needed).
- The admin user list shows each user's group. The educator status shown there
  and on the Classes page is derived from the group and a pending request.
- US-70.2 attaches model and tool access to groups; US-70.3 adds the Admin
  Settings page.
