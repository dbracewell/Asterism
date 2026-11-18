# EPIC-88: A normal project README

Status: proposed (2026-11-18). Source: user request (2026-11-18).

## Objective

Make the root `README.md` a conventional project README. Someone landing on the
repository should learn in a minute what Asterism is, see what it looks like, get
it running with Docker or for local development, and know where to go next.

Detail that serves operators or contributors moves to the documents written for
them. Nothing is deleted without a new home.

## Where things stand (verified 2026-11-18)

| Area             | Today                                                                                         | Gap                                                                                                    |
| ---------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Opening          | Two technical paragraphs on agents, provenance and FTS composition                            | No plain statement of what the project is for or who uses it; no screenshot                            |
| Status narration | Paragraphs on EPIC-31 to EPIC-35, US-33.x and US-34.3                                         | Project history, not README content                                                                    |
| Accuracy         | "Current versus planned" table marks Groups, Users, Image Generation and Export as Planned    | All four ship; only Code Execution is Planned. User settings list omits Templates, Rubrics and ChatGPT |
| Length           | About 470 lines: `.env` grammar, secrets, edge limits, sizing table, backup, usage, About you | Operator and contributor detail crowds out the quick start                                             |
| Destinations     | [`docs/deployment.md`](../deployment.md) exists (242 lines)                                   | No contributor/development guide to receive the local-development and quality-check detail             |

## Decisions

- **README sections:** title and one-sentence description, screenshot, what it
  does (a short feature list in plain words), quick start with Docker, local
  development, documentation map (user guide, deployment, development,
  architecture, ADRs), license.
- **Short quick starts.** The Docker path is the few commands from copying
  `.env` to opening the app. The local path is install, configure, migrate,
  `pnpm dev`. Each links to the full guide for everything else.
- **Content moves, not deletion.** Configuration catalog, strict `.env` syntax,
  edge protections, sizing, backup and upgrade go to `docs/deployment.md`. Local
  development, quality checks and E2E helpers go to a new `docs/development.md`.
  Usage, budgets and About you behavior already live in ADRs and EPIC-87 guides.
- **No status narration.** Epic progress stays in `todo.md` and `docs/archive`.

## User stories

Suggested order: US-88.1 → 88.2.

### US-88.1: Give displaced content a home

As an operator or contributor, the detail I relied on in the README is still
easy to find.

- [ ] Map every README section to its destination in a checklist in the PR
      description; nothing is dropped silently.
- [ ] Create `docs/development.md`: prerequisites, setup, migrations, `pnpm dev`
      and focused commands, mprocs, quality checks, isolated E2E and CI helpers.
- [ ] Merge configuration, `.env` grammar, file secrets, edge protections,
      sizing and admission settings, backup and upgrade into
      `docs/deployment.md` where they are not already there; remove duplicates.
- [ ] Update links elsewhere in `docs/` that point at README anchors.

### US-88.2: Rewrite the README

As a visitor, I understand what Asterism is and can run it.

- [ ] Rewrite `README.md` to the agreed sections; keep the CI badge.
- [ ] Add one screenshot of the chat workspace (from the EPIC-89 screenshot
      pipeline once it exists; a manual capture from a disposable demo instance
      until then).
- [ ] Feature list reflects shipped features only; link "planned" items to
      `todo.md` rather than listing them.
- [ ] Verify both quick starts from a clean clone with disposable storage, and
      record the result in the PR.
- [ ] `pnpm docs:check` (EPIC-87) and `pnpm format:check` pass.
