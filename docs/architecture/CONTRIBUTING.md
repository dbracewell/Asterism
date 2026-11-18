# Writing architecture guides

These guides explain how Asterism works to someone who has just joined the
project: a capable engineer who knows Python and TypeScript but not this codebase
or its history. Each guide should let that reader understand one part of the
system well enough to change it safely.

This page describes how a guide is laid out, how to write one, and how to keep it
true. The rest of the documentation follows the same terminology; see
[`docs/terminology.md`](../terminology.md).

## What belongs in a guide

A guide describes the system **as it is now**: what a part does, why it is built
that way, the rules it must never break, and where its code lives.

Some things belong elsewhere:

| Content                                                                  | Where it goes                                                                                                                           |
| ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| Why a decision was made, and the alternatives considered                 | An [ADR](../adr/). The guide gives one sentence and a link.                                                                             |
| Which story added a behavior, and when                                   | The epic and the [archive](../archive/). Guides do not mention stories.                                                                 |
| Test runs, verification results, benchmark numbers from a particular day | [`docs/reviews/`](../reviews/). A guide may link to the latest one.                                                                     |
| Planned work                                                             | [`todo.md`](../../todo.md) and the epics. A guide may say "not implemented" in one line when a reader would otherwise assume it exists. |
| How to install and run the app                                           | [`docs/deployment.md`](../deployment.md) and the README.                                                                                |
| How to use the app                                                       | The user guide in `docs/guide/`.                                                                                                        |

## The layout of a guide

Every guide uses the sections below, in this order. Leave out a section that has
nothing to say; do not add filler to it.

1. **Title and opening paragraph.** Two to four sentences: what this part of the
   system is for, and who needs to read the guide. A reader should be able to
   decide from this paragraph alone whether they are in the right place.
2. **Concepts.** The handful of ideas the rest of the guide depends on, each
   defined in a sentence or two. Use the names in the terminology list.
3. **How it works.** The main flow, from the outside in: what triggers it, what
   happens step by step, and what comes out. Start with a diagram if there is a
   flow, then explain it in prose. Use a short worked example when a rule is
   abstract.
4. **Rules and security.** The invariants this part maintains and the checks it
   performs: who may read or change what, what is rechecked live, what can never
   grant a capability. State each as a plain rule.
5. **Limits and failures.** Bounds (sizes, counts, timeouts), what happens when
   they are hit, and how errors reach the user.
6. **Where the code lives.** A short list of the files to read first, in the
   order a newcomer should read them, each linked, with a phrase saying what it
   holds.
7. **Related decisions and guides.** ADRs and other guides, one line each.

Reference material that a reader looks up rather than reads, such as a list of
API routes or socket packets, goes in a table near the end of "How it works" or
in its own section after it.

## How to write

**Explain before you specify.** Say what something is for before you say how it
is built. "Each accepted message keeps a copy of the About you text, so that later
edits never change an answer that was already given" tells the reader why the
copy exists. "`accepted_about` is immutable" alone does not.

**Write sentences, not fragments.** Lists are for things that really are lists:
steps in order, a set of options, a set of rules. When ideas depend on each other,
use a paragraph so the connecting words ("so", "because", "unless") can carry the
logic.

**One idea per sentence.** If a sentence needs a semicolon and two parentheses,
it is probably two or three sentences.

**Define a term the first time you use it,** or link to where it is defined. Do
not use a term from another guide without a link.

**Use the same word for the same thing.** If the terminology list calls it the
_execution file scope_, do not switch to "file ceiling", "allowed files" and
"scope" in the next three paragraphs. If a new term is needed, add it to the
terminology list in the same change.

**Be concrete.** Name the setting, the route, the table, the default value. "A
bounded queue" is vaguer than "a queue of 256 packets that drops the oldest".

**Prefer the active voice and present tense.** "The controller sends a status
packet every 0.5 seconds", not "status packets will be emitted".

**Keep sentences about the code, not about the writer.** Avoid "we", "now",
"currently", "new" and "no longer". They date quickly, and the guide describes
the present anyway.

## Diagrams

Use a diagram for any flow with more than three steps, any lifecycle with states,
and any boundary between components. Write diagrams as Mermaid fenced blocks
(` ```mermaid `), so they render on GitHub and change in plain-text diffs.

- **Sequence diagrams** for requests that cross components.
- **State diagrams** for lifecycles (jobs, file processing, accounts).
- **Flowcharts** for decisions and for topology.

Keep each diagram small enough to read without scrolling, around a dozen nodes.
Explain the diagram in the prose that follows it; a diagram supports the text
and does not replace it.

## Code references

Link to files with relative paths, for example
[`controller.py`](../../apps/backend/asterism/domains/chat/controller.py). Name the
class or function in backticks next to the link. Do not link to line numbers;
they move with every change.

Only name code that exists. `pnpm docs:check` checks that each linked file exists,
but it cannot check a name in backticks, so search for it before you write it.

## Keeping guides true

- **Update the guide in the same change as the behavior.** A pull request that
  changes how a documented part works also changes its guide.
- **Check every claim against the code or a test,** not against an older guide or
  an ADR. ADRs record decisions; the code may have moved on.
- **Run `pnpm docs:check`** before you open the pull request. It checks relative
  links, anchors and images across `README.md` and `docs/`, and CI runs it too.
- **Add a new guide to the [index](README.md)** in the right place in the reading
  order and the "if you want to know" table.

## An example

This paragraph from an earlier version of the execution-context guide is accurate,
but hard to read:

> Each accepted user message pins the user's About you text and revision
> (`accepted_about`); a trigger keeps it immutable. A blank text adds no profile
> layer. Resume uses the pinned or recorded text and checks only ownership;
> regeneration reads the current text. `MessageExecution.about` and
> `ContextProvenance.about_revision` record the revision only. [...] Children
> inherit the recorded layer through `ExecutionScope.about_layer` without
> expanding capabilities.

The same content, written to this guide's rules:

> When a user sends a message, Asterism copies their current About you text onto
> it (`accepted_about`). The copy cannot change afterwards: a database trigger
> refuses updates. This means that editing About you never changes the context an
> earlier answer was given.
>
> The copy decides what each kind of run sees:
>
> - **Resume** continues an interrupted turn, so it uses the copy on that turn.
> - **Regenerate** asks for a fresh answer, so it reads the user's current text.
> - **A sub-agent** called during the turn receives the same text as the main
>   agent, through `ExecutionScope.about_layer`. It gains no extra capabilities
>   from it.
>
> An empty About you text adds nothing to the prompt. The execution records
> (`MessageExecution.about` and `ContextProvenance.about_revision`) store only the
> revision number, never the text.

The rewrite says why the copy exists before saying how it is enforced, gives
each run type its own line with the reason for its behavior, and moves the code
names next to the ideas they implement.
