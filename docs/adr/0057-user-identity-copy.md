# ADR-0057 — Backend copy of user name and email

Status: accepted and implemented for US-64.1 on 2026-11-07
([EPIC-64](../epics/EPIC-64-USER-IDENTITY-SYNC.md)). Revises the "backend stores
ids only" assumption in [ADR-0053](0053-classes-and-educators.md).

## Context

The backend knew each user only by id; Better Auth held their name and email.
Features that show people to each other (educator requests, a class's "Run by",
class rosters) copied a name at the moment of use, and those copies go stale when
someone is renamed. Administrators also had no way to see who has an account.

## Decision

### Better Auth stays the source of truth

Sign-in, sessions, passwords, roles and signing keys stay in Better Auth. The
`users` row gains nullable `name` and `email` columns: a display copy, never used
to authenticate or authorize. Roles are not copied; they are read from the token
on every request as before.

### When the copy is written

- **Provisioning.** Install (`POST /users/` with the system key), admin-created
  accounts (`POST /users/` with an admin token) and invite signups
  (`POST /class-invites/redeem`, which now requires `email`) pass the name and
  email Better Auth stored. A user first seen through an ordinary authenticated
  request is created with the token's claims.
- **Every authenticated request.** `get_current_user` calls `sync_identity` with
  the verified `name` and `email` claims. A per-process TTL cache of the values
  last confirmed in the row makes unchanged claims a dict lookup; on a cache miss
  the row is read first and only differing columns are updated, so unchanged
  claims never take SQLite's write lock. A rename therefore reaches the backend on the user's next request
  after their token is reissued, within one token lifetime.

### Never blank

Values are trimmed. A missing, non-string or blank value is "unknown" and leaves
the stored column untouched, and one known claim updates only its own column.
Check constraints refuse blank values even for direct SQL. `null` means "not
known yet" (for example an id-only admin create) and is filled by the user's
first authenticated request.

### Who sees what

This story only stores the copy. Display rules for its readers (EPIC-64) are:

- Students see only the name of whoever runs their class, never classmates.
- Educators see names on their own rosters only.
- Email is shown only to administrators (educator requests, the user list).

## Consequences

- Snapshot columns (`educators.display_name`, `educators.email`,
  `classes.educator_name`, `class_members.display_name`) can be replaced by joins
  to `users` (US-64.2), and an admin user list becomes possible (US-64.3).
- The copy can lag Better Auth by up to one token lifetime, or stay unset for a
  user who never makes an authenticated request. Nothing security-relevant reads it.
- No migration: change the schema and reset development data.
