# EPIC-60: Educator and class policy

Status: in progress. Source: product direction discussion (2026-10-31), learner track.

The deployment direction was decided on 2026-11-06: Asterism stays a multi-user
web app. Design in [ADR-0053](../adr/0053-classes-and-educators.md).

## Objective

Let educators set up a course once and share it with a class: a tutor persona,
course files and allowed modes (for example, no full-answer reveal). Educators
also get privacy-respecting insight into common misconceptions.

## Ownership and delivery

- A new class (group) domain with an educator role scoped to classes. This is
  distinct from the platform admin role, and educators have no access to
  students' chats.
- Class policy narrows what students can do; it never expands it. Effective
  policy is the most restrictive combination of admin policy, class policy and
  the student's own settings.
- Insights are aggregated, opt-in and thresholded (no data for small groups).
  They never include transcripts.

## US-60.1: Classes and the educator role

As an educator, I want to create a class and invite students.

Estimate: 3 days. Dependencies: none.

Acceptance: an educator can create a class, invite students and remove them.
Membership is enforced at the service and database layers.

- [x] Write an ADR for classes, the educator role and the authorization model.
- [x] Implement the domain and membership; test isolation between classes and roles.

## US-60.2: Student invites

As an educator, I want to give each student a single-use invite, so they can
create an account and join my class without an admin creating it for them.

Estimate: 2 days. Dependencies: US-60.1, EPIC-63 (first-run setup).

Acceptance: an approved educator creates single-use invites for one of their
classes. Each invite can carry an optional student label, expires (14 days by
default) and can be revoked. Signing up with a valid invite creates an
ordinary user account and joins the class in one step. Invite signup is refused
until first-run setup is complete. Exactly one account can use an invite, even
under concurrent attempts; if the invite can't be claimed, the new account is
removed. Invites are random, stored only as hashes, and never grant the admin
or educator role. Signup is rate-limited. The educator sees which invites are
unused, used (and by whom), expired or revoked. The class join code is
unchanged and remains the way for existing accounts to join.

- [x] Extend the ADR with the invite model, the signup path and its limits (no email binding).
- [x] Implement invites and atomic redemption in the backend; test single use, expiry, revocation, setup gating and role isolation.
- [x] Extend the signup check in auth with the invite path and rate limiting; build the invite management UI and the invite signup page.
- [x] Add a real-backend E2E: educator creates an invite, a new student signs up with it and lands in the class, and the invite can't be reused.

## US-60.3: Course packs

As an educator, I want to publish a course setup to my class.

Estimate: 2 days. Dependencies: US-60.1, EPIC-59.

Acceptance: an educator publishes a team pack plus course files to a class.
Students see it as a ready-to-use project. Updates are versioned, and students
see what changed.

Decided on 2026-11-07: each student gets their own copy, applies updates
when they choose, and adds a course in one click after a summary. Design in
[ADR-0054](../adr/0054-course-packs.md). A course holds the project's settings,
selected sub-agents and files; skills, templates and rubrics are not included yet.

- [x] Implement publishing and student provisioning; test versioning and access.

## US-60.4: Class mode policy

As an educator, I want to require learning modes for my course.

Estimate: 2 days. Dependencies: US-60.1, EPIC-52.

Acceptance: class policy can require or forbid modes and disable answer reveal
in course projects. Students see the active policy and who set it. Policy is
checked live on every execution.

- [ ] Implement policy composition and live checks; build the policy display; test narrowing-only behavior.

## US-60.5: Aggregate misconception insights

As an educator, I want to know where my class struggles, without reading their chats.

Estimate: 2.5 days. Dependencies: US-60.1, EPIC-53.

Acceptance: an opt-in dashboard shows weak topics aggregated from quiz and
review data across consenting students, hidden below a minimum group size. It
never shows transcripts or individual results.

- [ ] Implement thresholded aggregation and consent; build the dashboard; test privacy limits.
