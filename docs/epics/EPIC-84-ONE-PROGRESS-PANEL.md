# EPIC-84: One progress panel

Status: proposed (2026-11-17). Source: user decision on the
[feature overlap review](../reviews/2026-11-17-feature-overlap-review.md), finding 4.

## Objective

Weak spots ([ADR-0036](../adr/0036-weak-spots-and-practice.md)), topic mastery
([ADR-0049](../adr/0049-topic-mastery.md)) and unclear items from reflections
([ADR-0050](../adr/0050-unclear-items-feed-review.md)) are three views of the
same study record. Today they are two separate panels in the project Study tab
(`ProjectTopicMastery`, `ProjectWeakSpots`) plus a dialog in the reflection
list (`UnclearPracticeDialog`), with two practice routes that build the same
kind of copy quiz. Combine them into one **Progress** panel with one practice
action.

## Current state

- `GET …/study/topics` derives topic levels, score, coverage and an eight-week
  trend; `POST …/study/topics/practice` builds a `topic`-origin copy quiz.
- `GET …/study/weak-spots` derives items whose latest outcome is a miss (or an
  `unclear` flag); `POST …/weak-spots/practice` builds a `weak_spots`-origin
  copy quiz from up to 20 of them.
- `POST /projects/{id}/study/unclear-cards` adds one confirmed card from a
  reflection's unclear text, optionally flagged as a weak spot. It is reached
  only from the reflection list.
- Both practice routes share the copy helpers (reshuffled options, cards asked
  as short answers).

## Decisions

- **One panel, three parts**, in this order:
  1. **Topics:** level, score, coverage and trend per topic (unchanged rules).
  2. **Needs practice:** the weak-spot list, filterable by topic. Items flagged
     from a reflection keep their "Flagged as unclear" label.
  3. **From your reflections:** unclear items from this project's reflections
     that have not become cards yet, each with **Add card** (the existing
     one-card-per-request flow and dedupe).
- **One practice action.** `POST …/study/practice` with an optional `topic`.
  No topic: the most recent weak spots (today's weak-spot practice). A topic:
  that topic's weakest items first (today's topic practice). Both quiz origins
  become one `practice` origin, tagged with the topic when given. The two old
  routes are removed.
- **One read.** `GET …/study/progress` returns topics, weak spots (with each
  item's topics) and pending unclear items in one response, so the panel loads
  once and the parts agree. The derivation rules in ADR-0036/0049/0050 do not
  change: everything is derived on read and nothing new is stored.
- **Pending unclear items** are computed on the server: the project's
  reflections with unclear text, split into items with the same rule the client
  uses today (one per line, list markers removed), minus items that already
  have a card with that `source_reflection_id` and front.
- The reflection list keeps a link to "Practice in Progress" instead of its own
  dialog.
- No migration: change the quiz origin constraint directly and reset.
- One ADR amends ADR-0036, ADR-0049 and ADR-0050.

## User stories

### US-84.1: Progress read and one practice route (backend)

- [ ] ADR-0067 "Progress panel": the combined read, pending unclear items, one
      practice route and origin; amend ADR-0036/0049/0050.
- [ ] `GET …/study/progress`: topics, weak spots with topic tags, pending unclear
      items; build from the existing owner-scoped selects in `study/queries.py`.
- [ ] Move the unclear-item splitting rule to the server and cover it with tests.
- [ ] `POST …/study/practice {topic?}` reusing the copy helpers; replace the
      `weak_spots` and `topic` origins with `practice`.
- [ ] Remove `GET …/study/topics`, `GET …/study/weak-spots` and both old practice
      routes; update tests; regenerate OpenAPI and the Hey API client.

### US-84.2: Progress panel (frontend)

- [ ] `ProjectProgress` replaces `ProjectTopicMastery` and `ProjectWeakSpots` in
      the project Study tab, with the three parts above and a topic filter that
      also scopes **Practice**.
- [ ] Move the Add card flow from `UnclearPracticeDialog` into the panel; the
      reflection list links to it instead.
- [ ] Empty states: no practice yet, nothing weak, no unclear items.
- [ ] Update the study e2e harness, unit tests and Playwright specs.

### US-84.3: Help and docs

- [ ] Replace the weak-spots and topic-mastery help entries with one Progress
      entry; update the reflections help text.
- [ ] Update architecture and README sections that describe study progress.
