# Classes and courses

This guide explains how educators run classes in Asterism: who may be an
educator, how students join, how an educator publishes a course that each student
gets their own copy of, how a course restricts learning modes, and what class
insights may reveal. Read it before changing the `classes` or `courses` domains or
anything that guards a course-managed record.

## Concepts

- **An educator** is a user in the `educator` group, or an administrator. Users ask
  for educator access on the Classes page, and an administrator approves it.
- **A class** belongs to the educator who created it. Only they manage it; another
  educator's class reads as not found.
- **Members** are students who joined with the class code or an invite link.
- **A course** is a project the educator publishes to their class, as numbered,
  unchanging versions.
- **A course copy** is a student's own copy of a course, made when they choose
  **Add course**: an ordinary project, sub-agents and files that they own.
- **Course-managed records** are the parts of a student's copy that only course
  updates may change, while the student is in the class.

The governing idea is that nothing is shared between accounts. Every project,
sub-agent and file belongs to one user, and every ownership check applies as
usual. A course works by copying, never by giving a student access to the
educator's records, or the educator access to the student's.

## How it works

### Becoming an educator

A user asks for access from the Classes page (`POST /educator-access`), which
writes a row to `educator_requests`. An administrator decides in Admin Settings →
Educators, and the decision is a group change: approving moves the user into the
`educator` group and deletes the request, denying deletes the request, and revoking
moves them back to `student`. Educator routes read the group live on every request,
so revoking takes effect at once ([ADR-0058](../adr/0058-user-groups.md)).

A revoked educator's classes stay, unmanaged, so students keep them, but their
invites stop working.

### Joining a class

**With a code.** Each class has a join code: 10 characters from a 32-letter
alphabet that leaves out 0, O, 1 and I, about 50 bits. A student with an account
enters it on the Classes page (`POST /classes/join`). The educator can show the code
again, replace it, or turn joining off. A wrong code, a disabled code and a blocked
student all get the same error, so codes can't be used to probe for classes. Ten
wrong codes in 15 minutes block that student for the rest of the window.

**With an invite link.** For students without an account, an educator creates up
to 50 invite links at a time, each with a label such as the student's name. A link
holds a random 32-character token; only its SHA-256 hash is stored, so it is shown
once. It expires after 14 days and can be withdrawn until used. Opening it at
`/invite/{token}` creates an ordinary account and joins the class, once
([ADR-0053](../adr/0053-classes-and-educators.md)):

1. The invite server action creates the Better Auth account, adding the system key
   that lets Better Auth accept an invite sign-up
   ([authentication](auth-and-security.md#creating-accounts)).
2. It calls `POST /class-invites/redeem`, which claims the invite with a conditional
   update and creates the backend user and membership in one transaction.
3. If the claim fails, because another sign-up used the invite first, the action
   deletes the new account. Of two sign-ups racing for one invite, exactly one keeps
   an account.

Unknown, used, expired and withdrawn invites, and invites from an educator who lost
access, all get the same message. Invite sign-ups are refused until an administrator
exists, and are limited to 10 per 15 minutes per address. An invite can't attach an
existing account; a signed-in visitor is told to use the class code.

**Membership.** `class_members` has a composite key, so a student can't join twice.
Removing a student sets `removed_at`, which stops them rejoining with the code until
the educator chooses "Allow back". A student who leaves deletes their row but can't
undo a removal. An educator can't join their own class as a student.

**Privacy.** Students see the class and who runs it, never the roster or the code.
Educators see their own rosters with names; only administrators see email
addresses. Nothing in the `classes` domain reads chats, projects or files.

### Publishing a course

An educator publishes one of their own projects to one of their classes
(`/classes/{class_id}/course`, [ADR-0054](../adr/0054-course-packs.md)). A version
holds:

- the project's instructions and settings;
- the sub-agents selected on the project, each with its model;
- up to 20 attached files, copied into the educator's storage at publish time.

The version is built by the team-pack export ([team packs](team-packs.md)), so it
passes the same allowlist, size limits and credential screening as a shared pack.
Versions are numbered per class and never change. Only the latest version keeps
file bytes; an unchanged file moves to the new version rather than being copied
again, and older versions keep names and hashes so changes can be listed. Skills,
prompt templates and rubrics aren't part of a course yet.

### Adding a course

A current member sees the offer: every sub-agent with its model and the tools it
would get, the files, the instructions and the educator's note. Choosing **Add
course** (`POST /classes/joined/{class_id}/course`) is the student's approval of
exactly that list. It creates ordinary records the student owns:

- a project named after the class;
- the sub-agents, selected on that project;
- the files, attached to it, and processed like any upload.

Each sub-agent gets only the tools it asked for that admin policy allows at that
moment, and none if its model doesn't state tool support. If a model isn't
available to the student, the add stops and names the sub-agent; nothing is
substituted. A name that clashes gets the class name added, as in
`Tutor (Biology 101)`.

`course_copies` records which version and project a student has, and
`course_copy_items` which of their records came from which course item. These
aren't foreign keys: if the student deletes a record, the next update creates it
again.

### Updating a course

When a newer version exists, the student sees "Version N is available" with what
changed: settings, and sub-agents and files added, removed or changed, plus the
educator's note. They apply it when they choose. An apply names the version the
student reviewed and is refused with a 409 if a newer one has appeared, so a
student never applies something they haven't seen.

An update changes the course records in place, in one transaction. The project
keeps its name and chats, gets the new instructions and settings, and its context
revision goes up. Sub-agents keep their names and IDs and get the new definition.
Removed sub-agents are deleted. Changed or removed files are replaced by new copies,
and the old copies are deleted afterwards through the normal file deletion, which
also detaches them from chats.

### Course-managed records

While a student is in the class, their course project, and the sub-agents and files
recorded in their copy, are **course-managed**. The check
`require_not_course_managed`
([`courses/locks.py`](../../apps/backend/asterism/domains/courses/locks.py)) refuses
the student's own changes to them with a 409 and `reason: "course_managed"`:

- editing the project (name, instructions, description, goal, accent, areas);
- attaching or detaching files and selecting or deselecting sub-agents on the
  project, including the student's own;
- editing or deleting a course sub-agent;
- deleting a course file, alone or in a bulk delete.

The check is read live on every guarded write. Course updates are the only way to
change these records. Chats in the course project stay fully the student's:
messages, branches, attachments to chats, learning modes within the course policy,
and study tools.

The interface shows the lock from `managed_by_class` on project, sub-agent and file
responses: a "Managed by" badge, disabled settings, and "Leave course" in place of
"Delete project". The badge only informs; the services refuse on their own.

**Leaving.** Deleting the course project is always allowed and is how a student
leaves the course; adding it again relinks what remains. **Leaving the class
unlocks without deleting:** when a student leaves or is removed, or the class is
deleted, everything they copied becomes freely editable and stays theirs.

### Restricting learning modes

An educator can limit which learning modes a course allows and whether answers may
be revealed, with `PUT /classes/{class_id}/mode-policy`
([ADR-0055](../adr/0055-class-mode-policy.md)). The policy is stored on the class
(`allowed_modes`, `answer_reveal`) and applies only to a student's course project
while they are a member. It never reaches their other projects or General chats,
and it can only narrow: it never enables a mode, grants a capability or adds prompt
text. [Learning modes](learning-modes.md#mode-policy-the-learners-lock-and-course-rules)
explains how it combines with the learner's own lock.

### Class insights

Insights tell an educator which course files the class finds hard, without
revealing any one student ([ADR-0056](../adr/0056-class-insights.md)).

- **Topics are course files.** A student's score for a topic is the average of the
  latest scores of their practiced flashcards and quiz questions that cite their copy
  of that file. Practice from their own files is left out.
- **Opt-in.** Sharing is off until the student turns it on on the Classes page
  (`/classes/joined/{class_id}/insights-consent`). Turning it off applies to the next
  read; nothing is stored or cached.
- **Thresholds.** Nothing is computed until 5 current members have opted in. A topic
  is shown only when 5 opted-in students have practiced it. Each topic shows the
  number of students, the average score and the share below 0.5, rounded to the
  nearest 10%.
- **Never returned:** chat content, card or question text, answers, timings, or any
  per-student figure.

The study domain publishes one reader for this, `scores_by_cited_file`, which
returns one learner's scores per file and is called only by the insights aggregate.

Thresholds and rounding make inference coarse but can't rule it out: an educator
watching the numbers as one known student opts in could learn something. The consent
text tells students exactly what is shared.

## Rules

- Nothing is shared between accounts. A course is a copy; the educator gains no
  access to a student's records, and the student none to the educator's.
- Educator access is the group, read live. Only a class's own educator manages it.
- A student approves a course's exact contents before anything is created, and every
  update before it is applied.
- Course-managed records change only through course updates, and only while the
  student is in the class.
- A course policy only narrows what a course project may do.
- Insights are opt-in, thresholded and rounded, and never return per-student data.

## Where the code lives

1. [`classes/service.py`](../../apps/backend/asterism/domains/classes/service.py) and
   [`classes/educators.py`](../../apps/backend/asterism/domains/classes/educators.py):
   classes, membership and educator access.
2. [`classes/invites.py`](../../apps/backend/asterism/domains/classes/invites.py): invite
   links and redemption.
3. [`courses/publish.py`](../../apps/backend/asterism/domains/courses/publish.py):
   publishing versions.
4. [`courses/copies.py`](../../apps/backend/asterism/domains/courses/copies.py): adding
   and updating a student's copy.
5. [`courses/locks.py`](../../apps/backend/asterism/domains/courses/locks.py):
   course-managed records.
6. [`courses/insights.py`](../../apps/backend/asterism/domains/courses/insights.py):
   class insights.

## Related

- [ADR-0053](../adr/0053-classes-and-educators.md): classes, joining and invites
- [ADR-0054](../adr/0054-course-packs.md): courses and copies
- [ADR-0055](../adr/0055-class-mode-policy.md): course mode policy
- [ADR-0056](../adr/0056-class-insights.md): class insights
- [Learning modes](learning-modes.md)
