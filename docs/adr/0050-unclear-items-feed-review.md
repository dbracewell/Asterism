# ADR-0050 — Unclear items feed review

Status: accepted and implemented for US-58.4 on 2026-11-06
([EPIC-58](../epics/EPIC-58-LEARNING-GOALS-REFLECTION-AND-PROGRESS.md)).

## Context

Learners want what they flagged as "still unclear" in a reflection (ADR-0048) to
come back for practice as cards or weak-spot practice, confirming each one.
A weak spot (ADR-0036) is defined by a recorded miss, and a new card has none.

## Decision

- **One confirmed card per request.** `POST /projects/{id}/study/unclear-cards`
  takes `{reflection_id, deck_id?, front, back, weak_spot}` and creates exactly
  one card. There is no bulk route and no model call. The client splits the
  answer into items (one per line, list markers removed) and each item has its
  own **Add card** action, enabled only once the learner has written an answer.
- **Deck.** `deck_id` names a deck in the project. Null uses the project's
  "Unclear items" deck, created on first use. The card is due at once.
- **Weak spots without a fake review.** `weak_spot` sets
  `study_cards.flagged_unclear_at`. `select_weak_spots` treats that as one more
  event with outcome `unclear`, so the usual rule applies: the latest outcome
  decides, and any later recall clears it. If an outcome lands in the same
  second, the real outcome wins. A synthetic Again rating was rejected because
  it would change scheduling, lapses and mastery. The flag is not a scored
  event, so mastery (ADR-0049) still counts the card as unpracticed.
- **Provenance and repeats.** `study_cards.source_reflection_id` records the
  source as a plain ID, so deleting the reflection keeps the card. The same
  reflection and front is a 409, so confirming an item twice never adds a second
  card. A reworded front counts as a new card.
- **Scope.** The reflection must be owned (404) and in this project (400), and
  must have unclear text (400). Decks belong to projects, so General reflections
  do not offer this action.

## Consequences

- Schema change (two `study_cards` columns) needs the development reset.
- The dialog does not remember added items after it closes; adding one again
  shows the 409 message.
