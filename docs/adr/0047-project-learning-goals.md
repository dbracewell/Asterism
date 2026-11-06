# ADR-0047 — Project learning goals

Status: accepted and implemented for US-58.1 on 2026-11-06
([EPIC-58](../epics/EPIC-58-LEARNING-GOALS-REFLECTION-AND-PROGRESS.md)).

## Context

A learner wants a project to carry what they are working toward, shown on the
project page, and to share it with a chat when it helps. EPIC-58 requires goals
to be explicit user-owned records that agents read only when the learner
includes them, with that use recorded, and never an automatic memory
(AGENTS.md §3.3).

## Decision

- **Storage.** `projects.goal` (text, ≤ 1,000 characters) and
  `projects.goal_target_date` (date, nullable). Projects are owned by one user,
  so the goal is partitioned by user and project like the rest of the project's
  metadata. It is metadata, not execution context: editing it does not advance
  `context_revision` and does not change project instructions.
- **Explicit inclusion per turn.** A send may set `include_goal: true`. The
  server snapshots the project's current goal into `messages.accepted_goal`
  (`GoalSnapshot`: project ID, trimmed text, target date) in the acceptance
  transaction. It is immutable, never inherited by later turns, and copied to
  comparison columns. A General chat, or a project without a goal, gets 400.
- **What the model reads.** The snapshot is a text part after the learner's
  message ("Learner's goal for this project", the text, the target date and a
  note that it is the learner's aim, not an instruction). It adds no prompt
  layer and grants no capabilities. Because it is pinned, resume and
  regeneration use the recorded goal.
- **Provenance.** Messages expose `goal`; the transcript labels the turn "Goal
  included", and the AI-use log (ADR-0046) lists it.
- **UI.** Project settings edit the goal and target date; the overview shows
  them with the days remaining. Project chats show a **Goal** toggle when the
  project has a goal. It follows the latest turn until the learner changes it,
  and on the new-chat page it starts off.

## Consequences

- Schema change (`projects.goal`, `projects.goal_target_date`,
  `messages.accepted_goal`) needs the development reset.
- The goal is never added automatically, so a chat that should know it needs the
  toggle on for that message.
