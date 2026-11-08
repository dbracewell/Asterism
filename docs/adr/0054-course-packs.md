# ADR-0054 — Course packs

Status: accepted and implemented for US-60.3 on 2026-11-07
([EPIC-60](../epics/EPIC-60-EDUCATOR-AND-CLASS-POLICY.md)). Amended for US-67.1
on 2026-11-08 ([EPIC-67](../epics/EPIC-67-READ-ONLY-COURSE-PROJECTS.md)): course
records are read-only to the student. Builds on
[ADR-0051](0051-team-pack-format.md) (team packs) and
[ADR-0053](0053-classes-and-educators.md) (classes).

## Context

An educator wants to set up a course once and give it to a class. Everything in
Asterism is owned by one user and nothing is shared between accounts: projects,
sub-agents, files and their knowledge, and the chats that use them. A shared
course project would need a new cross-account path through all of these, so
the user chose copies, student-applied updates and one-click adding.

## Decision

### Publishing

- An educator publishes one of their own projects to one of their classes. A
  version holds the project's instructions and settings, the sub-agents
  selected on it and the files attached to it. Skills, prompt templates and
  rubrics are not part of a course yet.
- The version is built by the team-pack export (ADR-0051), so it meets the same
  field allowlist, bounds and credential screen as a shared pack. Sub-agent keys
  are rewritten to `agent-<id>` of the educator's definition, so a later version
  changes the same student record. The pack is parsed again whenever it is read.
- Models are shared by the whole instance, so each sub-agent keeps the
  educator's model; the version stores the model ID per key.
- Course files are copied into the educator's file-store shard at publish time,
  up to 20 per version, so later edits change nothing until the next version.
  Only the latest version keeps bytes. An unchanged file moves to the new
  version instead of being copied; earlier versions keep names and hashes, which
  is enough to say what changed. Deleting the class removes the bytes after the
  deletion commits.
- Versions are numbered per class and never change. Two publishes at once give
  one a 409.

### A student's copy

- The course is offered only to current members. The offer lists every
  sub-agent with its model and the tools it would get, the files, the
  instructions and the educator's note. Clicking **Add course** is the student's
  explicit approval of exactly that list, which is how the copy meets the
  explicit-assignment rule without a per-item review.
- Adding creates ordinary records the student owns: a project named after the
  class, the sub-agents (selected on that project) and the files (attached to
  it). Every existing owner check, capability rule and isolation boundary
  applies unchanged. The educator gains no access to any of it.
- Tools are the sub-agent's requested tools that admin policy allows at that
  moment, and none when the model doesn't state tool support. A model that isn't
  available to the student stops the add with a message naming the sub-agent;
  nothing is substituted.
- A name clash gets the class name appended (`Tutor (Biology 101)`), because
  there is no review step in which to rename.
- `course_copies` records the version and project per student, and
  `course_copy_items` which record each course item became. Record IDs are not
  foreign keys: if the student deletes one, the next apply makes it again. If
  they delete the project, the course can be added again.

### Updates

- The student sees "Version N is available" with a list of what changed since
  their version: settings, and sub-agents and files added, removed or changed,
  plus the educator's note. They apply it when they choose.
- An apply names the version the student reviewed; if a newer one exists it is
  refused with a 409, so a student never applies something they haven't seen.
- An update changes course records in place, in one transaction. The project
  keeps its name and its chats; its instructions and settings are replaced and
  its context revision advances. Sub-agents keep their names and IDs; the rest
  of each definition is replaced and its revision advances. Removed sub-agents
  are deleted. Changed or removed files are replaced by new copies, and the old
  copies are deleted after the commit, through the normal file deletion, which
  also detaches them from chats.

### Course-managed records (US-67.1)

- A record is **course-managed** while all of these hold, read live on every
  guarded write: it is the project of the student's `course_copies` row, or a
  sub-agent or file recorded in that copy's `course_copy_items`; the copy still
  has a project; and the student is a current member of the class. No new
  ownership model: the records stay the student's own.
- One check, `courses.locks.require_not_course_managed`, refuses a student's
  change with 409 and `reason: "course_managed"` in the error body
  (`ErrorDetail.reason`, omitted for other errors). Guarded write paths:
  - project update (`PATCH /projects/{id}`: name, instructions, description,
    goal, accent, areas);
  - project file attach/detach and sub-agent select/deselect on the course
    project — the whole project is locked, including adding the student's own
    files or sub-agents to it; chats in it can still attach files;
  - sub-agent update, instructions update and delete (`/agents/sub-agents/{id}`);
  - file delete, single and bulk; a bulk delete containing a course file is
    refused as a whole.
- Not guarded, because they cannot reach an existing course record: settings
  import (instance settings and providers only), team-pack import (creates new
  records only), sub-agent and file creation, knowledge regeneration/cancel.
- The course update path (`copies.apply_course`) writes the records directly
  and stays the only way to change them. It deletes superseded files and removed
  sub-agents only after they stop being course items, so it never trips the lock.
- **Leaving.** Deleting the course project is always allowed and is how a
  student leaves the course: the copy keeps its version and items but no
  project, so nothing is locked any more. Adding the course again re-links the
  remaining sub-agents and files and locks them again.
- **Leaving the class unlocks, it does not delete.** When the student leaves, is
  removed, or the class is deleted, the copy stops being managed and every
  record becomes freely editable, matching the earlier rule that a removed
  student keeps their copy. Deleting records a student may rely on was rejected.
- Chats in the project stay the student's: messages, branches, forks, chat
  attachments, learning modes within class policy, and study tools.

## Consequences

- Students can no longer diverge from the course while they are in the class;
  an educator's update is the only change. A student who wants their own
  variant leaves the class or works in another project.

- A student who has left the class can edit what they kept; there are no more
  updates to overwrite it.
- Each student's copy costs its own storage and knowledge indexing. That is the
  price of keeping every ownership rule as it is.
- A removed student keeps their copy but gets no further updates. Deleting the
  class leaves copies with students, as their own records.
- Course files sit in the educator's file-store shard without a library row. They
  are reachable only through the course tables and are removed with the class
  or the educator's account.
