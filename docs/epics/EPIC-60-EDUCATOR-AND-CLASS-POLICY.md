# EPIC-60: Educator and class policy

Status: proposed, deferred. Source: product direction discussion (2026-10-31), learner track.

This epic only makes sense if Asterism stays a multi-user web app. It is
deferred until the deployment direction (multi-user web or single-user desktop)
is decided.

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

Estimate: 3 days. Dependencies: deployment decision.

Acceptance: an educator can create a class, invite students and remove them.
Membership is enforced at the service and database layers.

- [ ] Write an ADR for classes, the educator role and the authorization model.
- [ ] Implement the domain and membership; test isolation between classes and roles.

## US-60.2: Course packs

As an educator, I want to publish a course setup to my class.

Estimate: 2 days. Dependencies: US-60.1, EPIC-59.

Acceptance: an educator publishes a team pack plus course files to a class.
Students see it as a ready-to-use project. Updates are versioned, and students
see what changed.

- [ ] Implement publishing and student provisioning; test versioning and access.

## US-60.3: Class mode policy

As an educator, I want to require learning modes for my course.

Estimate: 2 days. Dependencies: US-60.1, EPIC-52.

Acceptance: class policy can require or forbid modes and disable answer reveal
in course projects. Students see the active policy and who set it. Policy is
checked live on every execution.

- [ ] Implement policy composition and live checks; build the policy display; test narrowing-only behavior.

## US-60.4: Aggregate misconception insights

As an educator, I want to know where my class struggles, without reading their chats.

Estimate: 2.5 days. Dependencies: US-60.1, EPIC-53.

Acceptance: an opt-in dashboard shows weak topics aggregated from quiz and
review data across consenting students, hidden below a minimum group size. It
never shows transcripts or individual results.

- [ ] Implement thresholded aggregation and consent; build the dashboard; test privacy limits.
