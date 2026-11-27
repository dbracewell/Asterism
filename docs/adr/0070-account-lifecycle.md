# ADR-0070 — Account lifecycle: suspension, reset links, deletion

Status: accepted and implemented for US-86.2 on 2026-11-17
([EPIC-86](../epics/EPIC-86-MULTI-USER-DEPLOYMENT-READINESS.md)). Builds on
[ADR-0057](0057-user-identity-copy.md) and
[ADR-0069](0069-versioned-schema-migrations.md).

## Context

An admin running Asterism for a class needs to suspend, reactivate, reset and
delete accounts without touching a database. Identity lives in Better Auth
(`users.db`); everything a person owns lives in the backend (`database.db`). A
JWT stays valid for 15 minutes after it is issued, whatever happens to the
session behind it. There is no email sender.

## Decision

**Admin server actions coordinate both stores.** `features/auth/server/account-lifecycle.ts`
runs every lifecycle change with the admin's own session; Better Auth checks the
admin permission and refuses self-ban and self-removal, and the backend checks
again. Better Auth's `/admin/ban-user`, `/admin/unban-user` and `/admin/remove-user`
HTTP routes, and the public `/request-password-reset`, are listed in
`disabledPaths`. They remain callable from the server only, so no change can skip
the backend half. Since US-112.2 every other admin plugin route (such as
`/admin/set-role`, `/admin/create-user` and `/admin/set-user-password`) is
listed too: nothing calls them, and over HTTP they would skip the backend and
the last-admin guard.

**Suspension.** Suspending calls the backend first (`users.suspended_at` is set,
the account's chat jobs are retired and its file jobs cancelled), then bans the
account in Better Auth (sign-in refused, sessions revoked). The backend refuses
the still-valid JWT of a suspended account in `get_current_user` and on chat
WebSocket connect, from a per-process cache that suspend and reactivate update
directly (one process, ADR-0019). Reactivating lifts the ban, then the backend
suspension. Data is kept.

**Reset links.** The admin action writes the same verification record Better
Auth's own reset request writes (`reset-password:<token>`, valid one hour, a
256-bit random token) and shows the link once. `/reset-password` posts the new
password to Better Auth's `/reset-password`, which checks the expiry, deletes the
record on use and, with `revokeSessionsOnPasswordReset`, ends every session. No
email is sent, so there is no public "forgot password" request. Since US-112.3 a
new link deletes the account's earlier unused reset records first, so only the
latest link works.

**Deletion.** The Better Auth account goes first, then the backend data
(`delete_user`, which also writes the tombstone). If the second step fails the
admin is told and retries; an already-missing auth account counts as done. The
confirmation names what goes, including classes the person teaches.

**Guards.** Admins can't suspend or delete themselves or the last active
administrator, checked from Better Auth's roles in the action and from the admin
group in the backend.

**Deletion requests.** A user who isn't an admin can ask for deletion and
withdraw it (`account_deletion_requests`, one row per user). Users shows open
requests; the admin deletes or dismisses. A request grants nothing and changes no
other data.

**Sign out everywhere** revokes the user's Better Auth sessions. Tokens already
issued keep working until they expire (up to 15 minutes); the UI says so.

## Consequences

- One migration (`e720dd8451d4`) adds `users.suspended_at` and the requests table.
- A suspended token is refused within one request; a signed-out-everywhere token
  is not, until it expires. Closing that gap would need a backend session
  revocation time and is left out.
- Admins send reset links themselves. An optional SMTP sender can later deliver the
  same link.
