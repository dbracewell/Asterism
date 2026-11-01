# ADR-0033 — Study domain and spaced-repetition scheduling

Status: accepted for US-53.1 on 2026-11-01.

## Context

[EPIC-53](../epics/EPIC-53-STUDY-TOOLS-FROM-PROJECT-FILES.md) turns a learner's
project files into flashcards, quizzes and summaries. These records need an owner
and a home. Generated text must stay traceable to the file it came from, and
reviews need a scheduler that picks the next due date. Review history must not
become agent memory by accident.

## Decision

**A new `study` domain.** `asterism/domains/study/` owns decks and cards now, and
will own review logs (US-53.3), quizzes and attempts (US-53.4). It follows the
usual layout: `models.py`, `queries.py` (owner-scoped base selects),
`service.py`, `schemas.py` and `router.py`. Other domains do not import it, and
it reaches projects and files only through their published readers
(`projects.scope.require_owned_project` and `projects.scope.project_member_files`).

**Owned by the user, scoped to a project.** Every row carries a denormalized
`user_id`. Decks use a composite foreign key `(project_id, user_id) →
projects(id, user_id) ON DELETE CASCADE`. Cards use `(deck_id, user_id) →
study_decks(id, user_id) ON DELETE CASCADE`. The database therefore rejects a
deck in someone else's project or a card in someone else's deck, and deleting a
project (or a user, through projects) deletes its decks and cards. Children
added later (review logs, quizzes) follow the same pattern.

**One URL space under the project.** Routes live at
`/projects/{project_id}/study/decks[/{deck_id}[/cards[/{card_id}]]]`. Each request
first proves project ownership, then deck membership in that project. A foreign
project returns the same 404 as a missing one; a deck reached through another
project, or a card through another deck, returns the same 404 as a missing deck
or card. Ids cannot be probed.

**Citations are stored references, checked when read.** A card holds up to 8
citations as validated JSON: `file_id`, plus an optional chunk reference
(`chunk_id` and `artifact_generation` from `RetrievalHit`) and a short
`excerpt`. On write, every cited file must be in the project's live file scope
(400 otherwise). On read, each citation is marked `available` with the file's
current name, or unavailable if the file has since left the project or been
deleted. Citations are not foreign keys, so removing a file never silently
changes a card. Card text and excerpts are untrusted and render through
`MarkdownViewer`.

**Drafts are not cards.** US-53.2 generates drafts that live only in the client
until the learner accepts them; acceptance uses the ordinary card create route.
No route saves generated content without an explicit accept.

**Edits are last-write-wins.** Decks and cards belong to one learner and are
small, so they have no revision token. The project's `context_revision` is not
involved: study records are not execution context.

**Scheduling: FSRS behind a small interface.** We choose FSRS (the Free Spaced
Repetition Scheduler, version 6 with its published default parameters and a
desired retention of 0.9) over SM-2:

- FSRS rates recall as Again, Hard, Good, Easy, which is exactly the acceptance
  scale of US-53.3. SM-2 uses a 0–5 grade that we would have to map.
- FSRS models memory (stability, difficulty, retrievability) and produces
  better-calibrated intervals than SM-2's fixed ease factors.
- Its state is a few numbers per card, so it fits in card columns.

The algorithm sits behind a `Scheduler` protocol in `study/scheduling.py`:
`schedule(state, rating, now) -> (new_state, due_at)`. It is pure, with no
session or clock access, so tests can check the math against fixed vectors.
US-53.3 adds the per-card state columns (`due_at`, `stability`, `difficulty`,
`state`, `reps`, `lapses`, `last_reviewed_at`) and an append-only review log.
A new card is due immediately. Personal parameter optimization is out of scope;
swapping the algorithm means a new `Scheduler` and a database reset.

**Review history is a user record, not memory.** Review logs and attempts are
ordinary owned rows. No agent, prompt layer or retrieval path reads them
automatically; EPIC-58 will add explicit, opt-in use.

## Consequences

- Project deletion cascades through the database; the study domain needs no
  hook in the project lifecycle.
- Unavailable citations stay visible as unavailable instead of disappearing,
  which keeps the provenance honest when files change.
- The schema changes in later stories need the explicit development reset; there
  are no migrations.
