# EPIC-67: Read-only course projects

Status: complete (US-67.1 and US-67.2 confirmed and merged 2026-11-08). Source: user request (2026-11-08).

## Objective

A student who adds a course from a class gets ordinary records they own
([ADR-0054](../adr/0054-course-packs.md)), so today they can rename the project,
rewrite its instructions, change its sub-agents and swap its files. A course
should behave the way the educator published it. Make the course-managed parts
of a student's copy read-only, while the student can still chat in it, update it
and leave the course.

## Ownership and delivery

- The lock is enforced in the backend services, not only hidden in the UI. Every
  write path that can reach a course-managed record (project update, sub-agent
  selection, sub-agent definition update/delete, project file attach/detach and
  delete, settings import, team-pack import onto the project) checks it.
- "Course-managed" is derived from `course_copies` / `course_copy_items`, which
  already record which records each course item became. No new ownership model.
- Only the course update path (applying a newer version) may change locked
  records. Deleting the whole project stays allowed: that is how a student leaves
  a course copy, and the course can be added again.
- Chats in the project stay fully the student's: messages, branches, forks,
  chat attachments, learning modes within class policy, study tools.
- Breaking change accepted: existing course copies become locked on deploy (no
  migration; reset data if needed).

## US-67.1: Lock course-managed records in the backend

As an educator, I want students' course projects to stay as I published them.

Estimate: 1.5 days. Dependencies: none.

Acceptance: for a project that is a live course copy, attempts to change its
name, instructions, settings, sub-agent selections, the course sub-agents'
definitions, or its course files are refused with one clear error code
(`course_managed`). Deleting the project still works and clears the copy. The
course update path still replaces records in place. A course sub-agent cannot be
deleted or edited from Settings → Sub-agents either. Locks are read live, so a
copy whose class was deleted or that the student left stops being locked (decide
and record in the ADR whether leaving a class unlocks or deletes the copy).

- [x] Amend ADR-0054 with the lock rule, the list of guarded write paths and the leave/delete behavior.
- [x] Add a single `require_not_course_managed` check in the courses domain and call it from each guarded service.
- [x] Tests: every guarded path refuses for course records, allows for the student's own records, and the update path still works.

## US-67.2: Show course projects as read-only

As a student, I want to see which parts of my course project I can't change and why.

Estimate: 1 day. Dependencies: US-67.1.

Acceptance: the project workspace shows a "Managed by <class>" badge. Settings,
instructions, sub-agent and file controls for course items are disabled with an
explanation instead of failing on save. The sub-agent settings list marks course
sub-agents the same way. Leaving the course (deleting the project) is offered
with a confirmation. Help and glossary describe the lock.

- [x] Expose a `course_managed` flag (and class name) on project, sub-agent and file responses; regenerate the client.
- [x] Disable and explain the locked controls; add the leave-course action.
- [x] Update help; add unit tests and an E2E: student adds a course, can chat, cannot edit it.
