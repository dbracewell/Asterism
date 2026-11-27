# EPIC-112: Sign-up and account hardening

Status: complete (2026-11-26). Source: repository review (2026-11-26),
verified against the code at `40101ac7`.

## Objective

Sign-up and account changes behave the way
[auth and security](../architecture/auth-and-security.md) and
[ADR-0070](../adr/0070-account-lifecycle.md) describe: sign-up goes only
through the app's own pages, a class behind one school network can join
together, and an account's access ends when it is suspended or deleted.

## Stories

### US-112.1: Sign-up limits that match the docs and fit a classroom

As an educator, I want a whole class to join from one school network, and as
an admin, I want sign-up to go only through the app's own pages.

- [x] The admin passphrase alone creates an account only while no account
      exists; afterwards it also needs the system key, which only operator
      tooling holds (decided 2026-11-26, instead of closing the HTTP route,
      which browser tests, the seed and the capacity and upgrade checks use).
- [x] Invite sign-up is limited per invite as well as per address, so 30
      students on one network can join within a lesson.
- [x] A full rate-limit store makes room by dropping its oldest entries
      instead of refusing everyone; IPv6 addresses are grouped by /64.
- [x] Tests, auth-and-security doc and release note.

### US-112.2: Admin changes only from active admins, through the app

As an admin, I want account changes to go through Asterism's own actions, so
the backend copy, groups and last-admin rule always hold.

- [x] `POST /users/` from a signed-in admin checks the caller is still active
      and not deleted; user ids are bounded and system keys are secret fields.
- [x] Better Auth admin HTTP routes the app doesn't use are closed.
- [x] Suspending or deleting admins re-checks that one active admin remains in
      the same transaction, so two admins acting at once can't remove both.
- [x] Tests and release note.

### US-112.3: Access ends with the account

As an admin, I want a suspended or deleted account's sessions and flows to
stop, and invites to redeem in one step.

- [x] An open chat connection closes when its token expires.
- [x] Invite redemption creates the user, claims the invite and adds the class
      membership in one transaction.
- [x] The ChatGPT connection callback checks the account is active and uses
      its sign-in attempt exactly once.
- [x] Issuing a password reset link revokes the account's earlier unused links.
- [x] Tests and release note.
