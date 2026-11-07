# Completed checklist — 2026-11-07

The user confirmed US-60.5 completion and authorized a local merge on
2026-11-07. EPIC-60 (US-60.1 through US-60.5) is complete; each story was
confirmed and merged with `--no-ff` before the next began. US-60.2 (student
invites) was added during the epic at the user's request. See ADR-0053
(classes, educators and invites), ADR-0054 (course packs), ADR-0055 (class mode
policy) and ADR-0056 (class insights).

### [EPIC-60: Educator and class policy](../epics/EPIC-60-EDUCATOR-AND-CLASS-POLICY.md)

- [x] US-60.1: Classes and the educator role (confirmed and merged 2026-11-07)
  - [x] Write an ADR for classes, the educator role and the authorization model.
  - [x] Implement the domain and membership; test isolation between classes and roles.
- [x] US-60.2: Student invites (confirmed and merged 2026-11-07)
  - [x] Extend the ADR with the invite model, the signup path and its limits (no email binding).
  - [x] Implement invites and atomic redemption in the backend; test single use, expiry, revocation, setup gating and role isolation.
  - [x] Extend the signup check in auth with the invite path and rate limiting; build the invite management UI and the invite signup page.
  - [x] Add a real-backend E2E: educator creates an invite, a new student signs up with it and lands in the class, and the invite can't be reused.
- [x] US-60.3: Course packs (confirmed and merged 2026-11-07)
  - [x] Implement publishing and student provisioning; test versioning and access.
- [x] US-60.4: Class mode policy (confirmed and merged 2026-11-07)
  - [x] Implement policy composition and live checks; build the policy display; test narrowing-only behavior.
- [x] US-60.5: Aggregate misconception insights (confirmed and merged 2026-11-07)
  - [x] Implement thresholded aggregation and consent; build the dashboard; test privacy limits.
