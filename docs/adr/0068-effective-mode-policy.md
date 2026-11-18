# ADR-0068 — Effective mode policy

Status: accepted for US-85.1 on 2026-11-17
([EPIC-85](../epics/EPIC-85-ONE-MODE-POLICY.md)). Supersedes the enforcement
sections of [ADR-0031](0031-self-imposed-mode-lock.md) (learner lock) and
[ADR-0055](0055-class-mode-policy.md) (class mode policy). Their storage and
scope decisions stand.

## Context

Two sources restrict a chat's learning modes: the learner's own lock
(`chats.learning_mode_locked`) and the class policy of a course project
(`classes.allowed_modes`, `classes.answer_reveal`). Each had its own checks
(`accept_hint_level`, `next_lock_state`, `apply_class_policy`,
`require_class_policy`), its own refusal wording and its own read route.

## Decision

**One policy.** `chat/mode_policy.py` builds a `ModePolicy` for a chat from
both sources, read live on every call:

- `allowed_modes`: the catalog ∩ the course list (when the student is a
  current member of the class that owns their course copy) ∩, when locked,
  every learning mode except Standard. May be empty.
- `reveal`: the strictest source. `forbidden` (course reveals off) beats
  `override_required` (learner lock) beats `allowed`.
- `sources`: each contributor, with `kind` (`learner` / `course`), `set_by`
  (the educator's current name, or "You"), `class_name`, the modes it allows,
  its reveal rule and `learner_can_lift`.

**One check.** `require_allowed(policy, mode, reveal, override_lock)` is called
for sends (new chat and follow-up), mode changes, hint requests and every run
(first execution, resume of a recorded execution, regeneration).

- **Sends:** the chat's mode must be allowed. An explicit answer request needs
  every source to allow a reveal; the learner's source with `override_lock`.
  A branch already at the answer level continues at the worked-example level
  when the policy forbids reveals.
- **Mode changes:** the learner rules run first (Standard cannot be locked,
  releasing a lock needs `override_lock`, selecting Standard releases it), then
  the new mode is checked against the policy with the resulting lock state.
- **Runs:** checked with the learner source lifted. The lock gated the turn
  when it was accepted and is not part of a turn's pinned snapshot, so a lock
  set later never stops a recorded run; the course source still does.

**Override scope.** `override_lock` lifts only sources the learner can lift
(their own lock). It never relaxes a course rule. Switching to Standard
releases the lock, and is refused when the course forbids Standard; nothing
changes then.

**Empty intersection.** A lock cannot be set when it would leave no allowed
mode. If a course change later empties it, sends are refused and the refusal
says to unlock the chat.

**Refusal shape.** One 409, `reason: "mode_policy"`, whose detail names every
source that refused, for example: "Not allowed by this chat's mode policy.
You locked this chat; confirm the override to show the answer. Biology 101
(Dr Teach): answers can't be revealed."

**Visibility.** `ChatInfo.mode_policy` replaces `learning_mode_locked` on
single-chat responses (it is null in chat lists). `GET /chat/mode-policy`
(optional `project_id`) returns the policy a new chat in that project starts
under; `GET /course-policy/projects/{id}` is removed.

## Consequences

- Clients derive the lock from a `learner` source and course limits from a
  `course` source; one notice can show both (US-85.2).
- Storage is unchanged: the flag stays on the chat, the rule on the class.
- Earlier turns stay readable; a tightened course policy stops their runs, a
  loosened one lets them go ahead.
