# ADR-0031 — Self-imposed learning-mode lock

Status: accepted for US-52.5 on 2026-11-01.

## Context

A learner who commits to a learning mode wants the chat to stop them skipping
ahead: switching to Standard, or revealing an answer or corrected solution
([ADR-0029](0029-branch-local-hint-levels.md)), should take a deliberate step.
The lock is the learner's own choice and they can always remove it. Locks set
by an educator are a separate policy layer (EPIC-60).

## Decision

**State.** `chats.learning_mode_locked` is a boolean beside the learning-mode
selection. The lock belongs to the chat, not a branch: it governs what the
learner may do next, not what a turn recorded. A check constraint stops a chat
being locked in Standard. `ChatInfo.learning_mode_locked` exposes it. The lock
adds no prompt text and is not part of a turn's pinned snapshot or provenance.

**Changing it.** `PUT /chat/{id}/learning-mode` takes an optional `locked` and
an `override_lock` flag, with the same expected revision and idle-runtime guard
as a mode change. Locking or unlocking bumps `learning_mode_revision`, so lock
and mode changes cannot race. The rules are:

- `locked` omitted keeps the current lock. Switching between learning modes
  keeps it.
- Standard cannot be locked (400). Selecting Standard releases the lock in the
  same change.
- Releasing a lock, by `locked: false` or by selecting Standard, needs
  `override_lock: true` (409 otherwise).

**Reveals.** While the chat is locked, a `HintRequest` for `answer` needs
`override_lock: true` as well as `confirm_reveal` (409 otherwise). Lower levels
and resets are not gated. A reveal does not release the lock. The send
fingerprint already covers the whole hint request, so a retried override
acknowledges the original turn.

**Delay.** The server requires the explicit override; the UI adds the delay.
Each override (Unlock in the header, Switch to Standard in the mode picker,
Show answer / Show solution) is an `AlertDialog` whose confirm button stays
disabled for five seconds after the dialog opens, with a visible countdown.
Reopening restarts it. A server-side waiting period would only stop the learner
from calling their own API, so the lock does not add one.

**Visibility.** The chat header shows the lock control at every width whenever
the chat is in a learning mode: "Lock mode" when unlocked (a confirmation
explains what locking does), "<Mode> locked" when locked.

## Consequences

- An answer revealed before locking stays on its branch, and regenerating that
  turn keeps its level. The lock only gates new reveals.
- New chats start unlocked. The learner locks a chat once it exists.
- EPIC-60 class policy can narrow further; it must not reuse this flag, because
  learners can always clear their own lock.
- Schema changes need the explicit development reset; no migrations.
