# EPIC-64: User identity sync

Status: in progress (US-64.1 and US-64.2 complete; US-64.3 awaiting confirmation). Source: user request (2026-11-07).

## Objective

The backend knows each user only by ID; Better Auth holds their name and email.
Features that show people to each other therefore copy a name at the moment of
use (educator requests, class "Run by", class rosters), and those copies go stale
when someone is renamed. Store each user's current name and email in the backend
users table, keep them in sync, and show live names everywhere.

## Ownership and delivery

- Better Auth stays the source of truth for identity and sign-in. The backend
  keeps a copy of `name` and `email` on `users`, for display and for admin
  lists, and never authenticates with it.
- The copy is written when the user is provisioned and refreshed from the
  verified JWT claims on authenticated requests when they differ. An in-memory
  check keeps this from writing on every request. A rename appears within one
  token lifetime.
- Snapshot columns are removed (`educators.display_name`, `educators.email`,
  `classes.educator_name`, `class_members.display_name`) and their readers join
  the users table instead. Class invites keep `redeemed_name` only until the
  account exists, then show the live name.
- Privacy is unchanged: students still see only who runs a class, never
  classmates; educators see names on their own rosters only. Email is shown only
  to administrators (educator requests, user list).
- No migrations: fresh initialization and the development reset.
- AGENTS.md and the user-domain docs stop saying the backend stores no identity
  data; an ADR records the change.

## US-64.1: Store and sync name and email

As an administrator, I want the backend to know each user's current name and
email, so that features can show people correctly.

Estimate: 1 day. Dependencies: none.

Acceptance: `users` has `name` and `email`. Provisioning (install, admin-created
accounts, invite signups) stores them. An authenticated request whose verified
claims differ updates the row; unchanged claims cause no write. A test renames a
user in the token and sees the backend copy follow. Tokens without the claims
never blank an existing value.

- [x] Write the ADR (source of truth, sync points, what is shown to whom).
- [x] Add the columns, provisioning and claim-driven sync; test write avoidance and edge cases.

## US-64.2: Live names in classes and educator access

As an educator or administrator, I want to see people's current names, not the
name they had when they joined or asked.

Estimate: 1 day. Dependencies: US-64.1.

Acceptance: educator requests, "Run by", rosters, invite "used by" and insights
read live names; the snapshot columns are gone. A rename shows up in each place
without the person doing anything. Existing isolation tests still pass.

- [x] Replace snapshot columns with joins; update schemas and the client.
- [x] Test renames across every reader; keep privacy tests green.

## US-64.3: Admin user list

As an administrator, I want to see who has an account.

Estimate: 0.5 day. Dependencies: US-64.1.

Acceptance: an admin-only paginated, searchable list of users (name, email, role
where known, created date), replacing the bare ID list. Non-admins are refused.
It is read-only; account deactivation and deletion stay with the deployment
readiness work.

- [x] Implement the owner-neutral admin query and route; test search and authorization.
- [x] Add the list to Admin settings with help; test it.
