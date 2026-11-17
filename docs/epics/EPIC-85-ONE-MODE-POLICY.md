# EPIC-85: One mode policy (stricter rule wins)

Status: proposed (2026-11-17). Source: user decision on the
[feature overlap review](../reviews/2026-11-17-feature-overlap-review.md), finding 3.

## Objective

Two mechanisms restrict learning modes today: the learner's own lock
([ADR-0031](../adr/0031-self-imposed-mode-lock.md)) and the educator's course
policy ([ADR-0055](../adr/0055-class-mode-policy.md)). They are checked in
different places (`accept_hint_level` / `next_lock_state` versus
`apply_class_policy` / `require_class_policy` in `chat/learning_modes.py`), and
shown by different components (`chat-mode-lock.tsx`, `course-mode-policy.tsx`).
Replace them with one effective policy per chat, built from both sources, where
the stricter rule wins.

## The two sources today

|                 | Learner lock                                         | Course policy                                    |
| --------------- | ---------------------------------------------------- | ------------------------------------------------ |
| Stored on       | `chats.learning_mode_locked`                         | `classes.allowed_modes`, `classes.answer_reveal` |
| Applies to      | one chat                                             | the student's course project while a member      |
| Modes           | any learning mode except Standard                    | the listed modes (null = all)                    |
| Answer reveal   | allowed after an explicit override (5 s delay in UI) | allowed or not                                   |
| Who can lift it | the learner, with an override                        | only the educator                                |

## Decisions

- **One function.** `effective_mode_policy(user_id, chat) -> ModePolicy`
  returns `allowed_modes`, `reveal` (`allowed` / `override_required` /
  `forbidden`) and the sources that contributed, each with who set it and
  whether the learner can lift it. It reads both sources live on every call,
  as course policy is today.
- **Stricter wins.** Allowed modes are the catalog ∩ course list ∩ (when
  locked) every learning mode except Standard. Reveal is the strictest of the
  sources: `forbidden` beats `override_required` beats `allowed`.
- **One check.** Send, mode change, hint request and every run (first
  execution, resume, regeneration) call the same check against the effective
  policy. Refusals are one 409 shape that names every source that refused
  ("Biology 101 (Dr Teach): Tutor or Explain-back only" and/or "You locked this
  chat").
- **Overrides lift only the learner's part.** `override_lock` releases or
  bypasses the learner source; it never relaxes the course source. Switching to
  Standard still releases the learner lock, and is refused if the course
  forbids Standard.
- **Empty intersection.** A lock cannot be set if the result would allow no
  mode (a course that allows only Standard). If a course change later empties
  it, sends are refused and the refusal offers releasing the learner lock.
- **Storage stays where it is.** The learner flag stays on the chat and the
  course rule stays on the class; only reading, checking and display are
  unified. The lock is still not part of a turn's pinned snapshot.
- **One UI.** A single policy notice/control in the chat header and composer
  lists each source, shows the learner's Unlock (with the existing delayed
  confirm) only when the learner source is present, and drives the mode picker's
  disabled modes and the reveal button state.
- One ADR supersedes the enforcement sections of ADR-0031 and ADR-0055 (their
  storage and scope decisions stand).

## User stories

### US-85.1: Effective policy and one check (backend)

- [ ] ADR-0068 "Effective mode policy": combination rules, reveal ordering,
      override scope, empty intersection, refusal shape.
- [ ] `effective_mode_policy` in the chat/learning-mode domain, reading the
      course source through `courses/policy.py`.
- [ ] Replace `accept_hint_level`'s lock check, `next_lock_state`'s course gaps,
      `apply_class_policy` and `require_class_policy` with calls to the one check.
- [ ] `ChatInfo.mode_policy` replaces `learning_mode_locked` in responses;
      `GET /course-policy/projects/{id}` is removed (the new-chat page reads the
      project's effective policy from one route).
- [ ] Tests: each source alone, both together, override cannot lift the course,
      Standard switch under a course that forbids it, empty intersection,
      tightening after acceptance stops resume/regenerate. Regenerate the client.

### US-85.2: One policy control (frontend)

- [ ] One `ModePolicyNotice` replaces `chat-mode-lock.tsx` and
      `course-mode-policy.tsx` in the header, composer and new-chat page.
- [ ] Mode picker and hint controls read `mode_policy` (disabled modes, reveal
      hidden / delayed / shown).
- [ ] Update unit tests and Playwright specs.

### US-85.3: Help and docs

- [ ] Merge the mode-lock and course-policy help entries into one.
- [ ] Update architecture docs and the classes/educator README sections.
