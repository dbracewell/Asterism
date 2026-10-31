# EPIC-58: Learning goals, reflection and progress

Status: proposed. Source: product direction discussion (2026-10-31), learner track.

## Objective

Help learners set goals, reflect on what they learned, and see their progress.
A project can carry a learning goal with a target date. Short reflections at the
end of a session capture what is still unclear. Mastery is tracked per topic
from study results.

## Ownership and delivery

- Goals, reflections and mastery are **explicit user-owned records**, partitioned
  by user, profile and project. They are not an automatic memory engine. Agents
  read them only when the learner explicitly includes them ("Use my reflections"),
  and access is checked again on every read, consistent with the memory rules in
  AGENTS.md section 3.3.
- Mastery is derived from EPIC-53 review and quiz data, never from chat content.

## US-58.1: Project learning goals

As a learner, I want my project to know what I'm working toward.

Estimate: 1.5 days. Dependencies: none.

Acceptance: a project can have a goal statement and an optional target date,
shown on the project page. The learner can include the goal in a chat's context
explicitly. The goal is recorded in provenance when used.

- [ ] Add goal fields to projects and the explicit context inclusion; regenerate the client.
- [ ] Build goal editing and display; test inclusion and provenance.

## US-58.2: Session reflections

As a learner, I want to capture what I learned and what's still unclear.

Estimate: 1.5 days. Dependencies: none.

Acceptance: an optional "Reflect" action at the end of a session asks for a
short reflection with two prompts: "What did I learn?" and "What's still
unclear?". It can suggest a draft based on the chat, which the learner edits
before saving. Reflections are listed per project, and the learner can edit or
delete them.

- [ ] Implement the reflection records and the optional draft suggestion.
- [ ] Build the reflect flow and list; test owner and profile partitioning.

## US-58.3: Topic mastery

As a learner, I want to see which topics I've mastered.

Estimate: 2 days. Dependencies: EPIC-53.

Acceptance: topics come from deck and quiz tags. The project page shows a
mastery level per topic based on review ratings and quiz results, with trends
over time. Selecting a topic starts practice on it.

- [ ] Implement mastery computation over study data; build the progress view; add tests.

## US-58.4: Unclear items feed review

As a learner, I want the things I flagged as unclear to come back for practice.

Estimate: 1 day. Dependencies: US-58.2, US-53.5.

Acceptance: "still unclear" items from reflections can be turned into cards or
weak-spot practice, with the learner confirming each one.

- [ ] Add the conversion action and confirmation; test it end to end.
