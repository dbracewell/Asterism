# ADR-0053 — Classes and the educator role

Status: accepted and implemented for US-60.1 on 2026-11-06
([EPIC-60](../epics/EPIC-60-EDUCATOR-AND-CLASS-POLICY.md)). Amended by US-64.2
([ADR-0057](0057-user-identity-copy.md)): names and emails are no longer copied
into class rows but read live from `users`; who may see them is unchanged.
Amended by US-70.1 ([ADR-0058](0058-user-groups.md)): the `educators` grant
table is replaced by the educator group, with pending requests in
`educator_requests`, and members of the admin group may also run classes.

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

A code is not a way to sign up; it joins an existing account. New students use
an invite (below). A student who gets 10 wrong codes in 15 minutes is refused for
the rest of that window; the limit is per backend process and per user.

A wrong code, a disabled code and a blocked student all get the same error, so a code
cannot be used to probe classes.

### Student invites (US-60.2)

An invite creates an ordinary account and joins one class, once.

- **Made by educators.** An approved educator creates up to 50 at a time for their
  own class, one per label (usually the student's name). Each is a 32-character
  random URL-safe token (192 bits). Only its SHA-256 hash is stored, so the link is
  shown once, at creation. Invites expire after 14 days and can be withdrawn until
  used. The label is a reminder for the educator, not a check on who uses it.
- **Signup path.** The link opens `/invite/<token>`, the only public page besides
  sign-in. A server action creates the Better Auth account and then calls
  `POST /class-invites/redeem`. The Better Auth signup check accepts an invite
  signup only when the call carries the system key, which only the server holds,
  and always makes it an ordinary user. Redeem claims the invite with a
  conditional update and creates the backend user in the same transaction, then
  adds the membership. If the claim fails, the action deletes the new account.
  So of two signups racing for one invite, exactly one keeps an account.
- **Only after setup.** Invite signup is refused until an administrator account
  exists. In practice an invite also needs an approved educator, which needs an
  administrator.
- **One error.** Unknown, used, expired and withdrawn invites, and invites whose
  educator lost access, all get the same message.
- **Rate limit.** Invite signups are limited to 10 per 15 minutes per client
  address, per frontend process. The token's entropy already rules out guessing;
  the limit slows account spam.
- **New accounts only.** An invite can't attach an existing account; signed-in
  visitors are told to use the class code.

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

- Names were snapshots from the token; since ADR-0057 (US-64.2) they are read
  live from `users`, so a rename reaches every class view.
- Rate limits are in memory, so they reset on restart and aren't shared between
  processes. That is enough for one container; several replicas would need a
  shared store.
- Invites aren't bound to a person. A student can forward an unused link; single
  use limits that to one account, and the educator sees who used each invite and
  can remove them. Binding invites to an email needs email delivery, which
  Asterism doesn't have.
- A lost invite link can't be shown again; the educator withdraws it and creates
  another.
- Rosters and class lists show the first 100 rows, with a notice on rosters.
