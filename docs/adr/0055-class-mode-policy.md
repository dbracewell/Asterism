# ADR-0055 — Class mode policy

Status: accepted and implemented for US-60.4 on 2026-11-07
([EPIC-60](../epics/EPIC-60-EDUCATOR-AND-CLASS-POLICY.md)). Builds on
[ADR-0028](0028-learning-mode-layer.md) (learning modes),
[ADR-0031](0031-self-imposed-mode-lock.md) (the learner's own lock) and
[ADR-0054](0054-course-packs.md) (course projects).

## Context

An educator wants their course used in particular learning modes, for example
Tutor only with no answer reveal. ADR-0031 left room for this: the learner's own
lock is theirs to clear, so an educator's limit has to be a separate layer.

## Decision

**Policy on the class.** `classes.allowed_modes` (a list of mode IDs, or null for
all) and `classes.answer_reveal` (default true). The owning educator replaces both
with `PUT /classes/{id}/mode-policy`. A list must name at least one mode, each
once, from the catalog.

**Scope.** The policy applies to a student's course project (the project in
their `course_copies` row) while they are a current member of the class. It does
not reach their other projects or General chats, and it stops applying when they
leave or are removed, or when the class is deleted; the project stays theirs.

**Only narrowing.** The effective rule is the catalog, narrowed by the class
policy, with the learner's own lock on top. The policy can refuse a mode or a
reveal; it never enables a mode, grants a capability or adds prompt text. A
stored mode the catalog no longer offers is ignored rather than widening
anything, so a policy whose modes are all retired allows nothing.

**Checked live, at every step.** `course_mode_policy` reads the class, the copy
and the membership on each call, and nothing caches it:

- **Send** (new chat or follow-up): the chat's mode must be allowed. An explicit
  answer request is refused while reveals are off. A branch already at the
  answer level continues at the worked-example level, so an earlier reveal does
  not block the branch.
- **Mode change:** the new mode must be allowed.
- **Every run:** first execution, resume of a recorded execution and
  regeneration all check the mode and hint level they would run with. A policy
  tightened after a turn was accepted therefore stops its run, and loosening it
  lets the run go ahead.

Refusals are 409s that name the allowed modes, the educator and the class.

**Visibility.** `GET /course-policy/projects/{id}` returns the limits and who set
them, or null when nothing is limited. The new-chat page and the chat composer
show a notice ("Biology 101: Tutor or Explain-back modes only, answers can't be
revealed. Set by Dr Teach."). The mode picker shows disallowed modes as disabled,
a new chat in a course project starts in the first allowed mode, and the reveal
button is hidden when reveals are off.

## Consequences

- The policy shapes the course project, not the student. A student can still
  use any mode in a General chat or their own projects. That is deliberate:
  Asterism is the student's own tool, and the policy is the educator's course
  design, not an exam control.
- Like modes themselves, a model can still leak an answer. The policy controls
  which instructions run, not what a model writes.
- Changing the policy does not rewrite history. Earlier turns stay readable;
  only new sends and runs are checked.
- Schema changes use the development reset; no migrations.
