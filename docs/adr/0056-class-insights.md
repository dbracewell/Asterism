# ADR-0056 — Aggregate misconception insights

Status: accepted and implemented for US-60.5 on 2026-11-07
([EPIC-60](../epics/EPIC-60-EDUCATOR-AND-CLASS-POLICY.md)). Builds on
[ADR-0036](0036-weak-spots-and-practice.md) and
[ADR-0049](0049-topic-mastery.md) (study scores) and
[ADR-0054](0054-course-packs.md) (course copies).

## Context

An educator wants to know where the class struggles without reading chats or
seeing any one student's results. Study data (card ratings and quiz verdicts)
already gives every practiced item a 0–1 score.

## Decision

**Topics are course files.** Students' own deck and quiz tags differ from
student to student, so they can't be combined. Course files can: each student's
copy of a course file maps back to its course file name through
`course_copy_items`. A student's score for a topic is the mean of the latest
scores of their practiced cards and original quiz questions that cite their
copy of that file, the same scoring as topic mastery. Practice citing a
student's own files is left out.

**Consent, off by default.** `class_members.insights_consent` starts false. The
student switches it on or off on the Classes page, which says what is shared
and with whom. Withdrawing applies to the next read: nothing is stored or
cached. A removed student drops out.

**Thresholds and rounding.**

- Nothing is computed until at least 5 current members consent
  (`MIN_GROUP_SIZE`). Below that the educator sees only how many have opted in.
- A topic is shown only when at least 5 consenting students practiced it; the
  rest are counted as "too few students to show".
- Each topic shows the number of students, the average score and the share of
  students below 0.5 (the "needs work" line in ADR-0049), both rounded to the
  nearest 10%.

**What is never read or returned.** No chat content, card or question text,
answers, timings or per-student figures. Per-student scores exist only inside
the aggregation function.

**A published study reader.** ADR-0033 keeps other domains out of `study`. This
adds one exception: `study.insights.scores_by_cited_file`, which returns one
learner's per-file scores and nothing else. Only the course insights aggregate
calls it.

## Consequences

- Thresholds limit, but cannot remove, inference. An educator who watches the
  numbers change as one known student opts in or out could learn something
  about that student. Rounding and the per-topic threshold make this coarse.
  The consent text tells students exactly what is shared.
- Insights reflect students who added the course and practiced from its files.
  Students who study only from their own files contribute nothing.
- Only cards and quiz questions count, not reflections or chats, so "weak
  topics" means weak practice results, not misconceptions in conversation.
- The schema change needs the development reset.
