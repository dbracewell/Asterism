# ADR-0067 — Progress panel

Status: accepted; backend implemented in US-84.1 on 2026-11-17
([EPIC-84](../epics/EPIC-84-ONE-PROGRESS-PANEL.md)). Amends
[ADR-0036](0036-weak-spots-and-practice.md),
[ADR-0049](0049-topic-mastery.md) and
[ADR-0050](0050-unclear-items-feed-review.md).

## Context

Weak spots (ADR-0036), topic mastery (ADR-0049) and unclear items from
reflections (ADR-0050) are three views of one study record. They had two reads,
two practice routes that built the same kind of copy quiz, two quiz origins and
a dialog that only the reflection list could reach. The learner had to visit
three places to see how a project was going.

## Decision

### One read

`GET /projects/{id}/study/progress` (`studyProgressGet`) returns, for one owned
project:

- `topics`: level, score, coverage, counts and eight-week trend per topic, with
  the ADR-0049 rules unchanged.
- `weak_spots`: the most recent weak spots (at most 50) and their `total`, with
  the ADR-0036 rules unchanged. Each item carries `topics`, the keys of the
  topics its original question or card belongs to, so the client can filter
  by topic. A copy counts towards its original, so its topics are the original's.
- `unclear`: pending unclear items (at most 50) and their `total`.
- `computed_at`: the time used for the trend.

Everything is derived on read; nothing new is stored. The response is
`no-store`. A foreign or missing project is 404.

### Pending unclear items

The project's reflections with unclear text, newest first, are split into
items on the server: one item per line, list markers (`-`, `*`, `•`, `1.`,
`1)`) removed, blank lines and repeats within a reflection dropped. An item is
pending until a card exists with that reflection as `source_reflection_id` and
the item as its front, which is the duplicate check `POST …/unclear-cards`
already uses. A card added with a reworded front leaves the item pending; the
learner can add it again under the original wording or ignore it. Each item
returns its `reflection_id`, `chat_id`, `reflected_at` and `text`. Reflection
text is untrusted and grants nothing.

The Add card flow (`POST …/unclear-cards`) is unchanged.

### One practice route and origin

`POST /projects/{id}/study/practice` (`studyPracticeCreate`) with
`{topic?, question_count}` (1–20, default 10) copies items into a quiz without
a model call, with the existing copy helpers (reshuffled options, cards asked as
short answers, only live citations):

- No `topic`: the most recent weak spots. 400 when there are none. Title
  "Practice: weak spots", no tags.
- A `topic` (matched case-insensitively after whitespace collapse): that
  topic's weakest items first, by the ADR-0049 order. 404 for an unknown topic,
  400 when it has no items. Title "Practice: <label>", tagged with the label.

Both save origin `practice`. The `weak_spots` and `topic` origins are gone; the
`ck_study_quizzes_origin` constraint allows `generated` (with a model name) or
`practice`. Copies still name their original, so answering a copy clears or
scores the original.

### Removed

`GET …/study/topics`, `GET …/study/weak-spots`, `POST …/study/topics/practice`
and `POST …/study/weak-spots/practice`, with their request and list schemas.

## Consequences

- One query loads the whole panel, so the topics, weak spots and pending items
  shown together come from the same state.
- The topic filter on weak spots works on the returned 50 items. A project with
  more than 50 weak spots can show fewer in a topic than it has; practising
  that topic still reads all of its items.
- No migration: reset the database for the origin constraint change.
