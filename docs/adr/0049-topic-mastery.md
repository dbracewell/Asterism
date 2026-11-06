# ADR-0049 — Topic mastery

Status: accepted and implemented for US-58.3 on 2026-11-06
([EPIC-58](../epics/EPIC-58-LEARNING-GOALS-REFLECTION-AND-PROGRESS.md)).

## Context

Learners want to see which topics they have mastered, how that changes over
time, and to practise a topic directly. EPIC-58 says topics come from deck and
quiz tags, and that mastery is derived from EPIC-53 review and quiz data, never
from chat content.

## Decision

- **Tags.** Decks and quizzes gain `tags` (a JSON list, at most 8 tags of 1–40
  characters). The schema normalizes them (trim, collapse whitespace, drop
  case-insensitive repeats); topics match by the case-folded tag and display
  the first spelling seen.
- **Items.** A topic's items are the cards of its decks and the original
  questions of its quizzes. Practice copies (`source_question_id` or
  `source_card_id`) count towards the item they re-ask, as they do for weak
  spots, so practising never inflates a topic's size.
- **Scores.** Each item's latest graded outcome becomes a 0–1 score: quiz
  verdicts correct 1, partial 0.5, incorrect 0 (ungraded ignored); card ratings
  Again 0, Hard 0.6, Good 0.9, Easy 1. A topic's `score` is the mean over its
  practiced items, and `practiced`/`total` is its coverage.
- **Levels.** `not_started` with no practice; `needs_work` below 0.5;
  `mastered` at 0.8 or more with at least 80% coverage; otherwise
  `developing`. Requiring coverage keeps one easy card from marking a large
  topic mastered.
- **Trend.** Eight weekly points ending now, each recomputed from the events up
  to that point (latest outcome per item as of then).
- **Derived on read.** `GET …/study/topics` computes everything from review logs
  and quiz answers in the project. Nothing is stored, agents never read it, and
  chat content is never used.
- **Practice.** `POST …/study/topics/practice` copies the topic's weakest items
  first (latest score below 1, lowest then oldest), then unpractised items,
  then the rest by oldest practice. They go into a quiz with the new origin
  `topic`, no model, and the topic as its tag, reusing the weak-spot copy
  helpers (multiple-choice options reshuffled, cards asked as short answers
  graded against the back).

## Consequences

- Schema change (`study_decks.tags`, `study_quizzes.tags`, the `topic` origin)
  needs the development reset.
- Mastery is a transparent heuristic, not a psychometric model. The weights and
  thresholds are constants in `study/mastery.py` and `study/queries.py`.
- Computation is per request over the project's study data. That is adequate at
  study-tool scale, and can be cached later without changing the contract.
