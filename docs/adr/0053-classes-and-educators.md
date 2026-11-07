# ADR-0053 — Classes and the educator role

Status: accepted and implemented for US-60.1 on 2026-11-06
([EPIC-60](../epics/EPIC-60-EDUCATOR-AND-CLASS-POLICY.md)).

## Context

The deployment direction is decided: Asterism stays a multi-user web app. EPIC-60
lets educators run classes. Educators must be distinct from platform administrators
and must have no access to students' chats. Better Auth owns identity, so the
backend cannot list users or read their names and emails. It cannot send email, and
signup needs an admin key.

## Decision

### Educator is a grant, not a role

The JWT role stays `user` or `admin`. A row in `educators` records a request or an
approved grant, read live on every educator request, so revoking works at once. An
administrator is not automatically an educator, and an educator gets no admin access.

The backend cannot list users, so access is requested rather than assigned. A user
asks from the Classes page, which copies their name and email from their own token
into the row, and an administrator approves, denies or revokes it in Admin settings.

Scope is the class: whoever creates a class is its only educator, and another
educator's class is a 404. Revoking leaves classes in place, unmanaged, so students
keep them.

### Joining

Students join with a code; there is no email to invite with. Codes are 10 characters
from a 32-letter alphabet without 0, O, 1 or I (50 bits), so guessing is impractical
without rate limiting, and they are stored in plain text so the educator can show
them again. An educator can replace a code or turn joining off.

Students still need an account from an administrator; a code is not a way to sign up.

A wrong code, a disabled code and a blocked student all get the same error, so a code
cannot be used to probe classes.

### Membership

- `class_members` has a composite primary key and foreign keys to `classes` and
  `users`, so duplicates and orphans fail at the database. Deleting a class or a user
  removes the rows.
- **Removal sticks.** `removed_at` stops a removed student rejoining with the same
  code. "Allow back" clears the row, and the student then rejoins themselves. Leaving
  a class deletes the row, but cannot erase a removal.
- An educator cannot join their own class as a student, which keeps the two views of
  a class separate.

### Privacy

The only student detail stored is the display name they share by joining; the Join
form says so. No email is kept. Students see the class and who runs it, never the
roster or the code. Nothing in this domain reads chats, projects or files.

## Consequences

- Names are snapshots from the token, so a later rename does not reach old rows.
- Join attempts are not rate limited. The code's entropy covers guessing, but a limit
  is worth adding if classes are exposed to the public internet.
- Rosters and class lists show the first 100 rows, with a notice on rosters.
