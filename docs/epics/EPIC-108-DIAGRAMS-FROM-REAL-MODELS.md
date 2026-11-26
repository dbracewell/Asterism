# EPIC-108: Diagrams that real models draw

Status: complete (2026-11-26). Source: user request (2026-11-25), the
follow-up to [EPIC-103](EPIC-103-MERMAID-DIAGRAMS.md): check the diagram
guidance against real models.

## Objective

When the main agent answers with a diagram, the diagram draws, has a useful
name and description, and looks the same in the app and in exports, whichever
supported model wrote it.

## Where things stand (verified 2026-11-25)

The user tried three prompts on their main model:

- "how a bill becomes a law" (a flowchart)
- the same process as a timeline
- a mind map of the three branches of government

The model wrote mermaid each time, with good labels, title and description.
**None of the three drew.** Testing mermaid 12.3.0 in the export renderer's
Chromium showed why:

| Diagram | `accTitle`/`accDescr` before the type line | after it |
| --- | --- | --- |
| flowchart, sequence, gantt, pie | doesn't draw | draws, named from `accTitle` |
| timeline | doesn't draw | draws, but mermaid ignores the title |
| mindmap | doesn't draw | still doesn't draw: not supported |

- `DIAGRAM_GUIDANCE` says "Start each diagram with accTitle: and accDescr:
  lines", which the model followed literally.
- Mermaid needs the diagram type first, and mind maps reject the accessibility
  lines wherever they are.
- An untitled flowchart is named "Diagram: flowchart-v2", mermaid's internal
  type name.

## Decisions

- **Prepare the source before drawing, in one shared place.**
  `packages/diagram-policy/diagram-source.js` (`prepareDiagramSource`) is
  used by the app's viewer and the export renderer's page, like the sanitizer.
  - It moves `accTitle`/`accDescr` statements, including the `accDescr { … }`
    block form, from above the type line to just below it.
  - It removes them from diagram types that reject them (mindmap).
  - It returns the title and description it found, and the sanitizer uses
    them when the drawn SVG carries no name (mindmap, timeline).
  - It only moves or drops those lines, so it can't widen what a diagram may
    do; the locked configuration and the sanitizer still apply.
  - The code view, copy and downloads keep the source as written.
- **Clean type names.** The fallback name drops mermaid's version suffix:
  "Diagram: flowchart".
- **Say it right, with an example.** The guidance puts the type line first,
  then the accessibility lines, shown in a three-line example, and says mind
  maps get their title in words.

## User stories

### US-108.1: Accessibility lines in any order

- [x] `prepareDiagramSource` in the shared package (moves, drops, returns the
      title and description). The app's renderer and the export renderer's
      page both use it. `check:image` lists the package's scripts and draws a
      diagram whose title comes before the type
- [x] The sanitizer names an untitled diagram from the prepared title, and
      drops `-v2` from type names
- [x] `DIAGRAM_GUIDANCE`: type line first, example, mind maps
- [x] Tests:
      - unit (`diagram-source.test.ts`): moves, mind maps, block `accDescr`,
        front matter and comments, nothing else changes
      - E2E: a "Diagrams from models" harness section; the user's three kinds
        draw, are named, keep their source in the code view and pass axe
      - backend with the real renderer: the same diagrams, the block form,
        front matter, an untitled flowchart, the guidance example
- [x] ADR-0081 and ADR-0082 notes, package README, release notes

### US-108.2: A reusable check on real models

Only one model is configured (a local Inkling-2-Mini on an OpenAI-compatible
server), so the user chose a reusable check over a one-off survey.

- [x] `scripts/evaluate_diagrams.py` with `domains/chat/diagram_evaluation.py`:
      - seven fixed prompts under the main agent's runtime prompt: process,
        cycle, sequence, timeline, mind map, hierarchy, and a control that
        shouldn't get a diagram
      - each mermaid block is drawn with the export renderer
      - it reports diagram, drew, named, accessibility-first, types and words,
        prints a table and writes JSON with `--json`
      - `--repeat` and `--prompt` options; informational, never gates CI
- [x] Unit tests for the scorer (`test_diagram_evaluation.py`); backend README
      section
- [x] Ran it on the local model and fixed the guidance; results below

#### Results: Inkling-2-Mini (local), 3 runs of 7 prompts

| Run | Passed | Diagrams drawn | Named | Lines before type |
| --- | --- | --- | --- | --- |
| US-108.1 guidance | 18 of 21 | 18 of 18 | 15 of 18 | 0 |
| after the change below | 21 of 21 | 18 of 18 | 18 of 18 | 0 |

- **Every diagram drew, and no answer put the accessibility lines first.**
  US-108.1's instructions work, and the renderer would have fixed the order
  anyway.
- **All three mind maps were unnamed.** The US-108.1 guidance told the model
  mind maps can't have `accTitle`/`accDescr`, so it left them out. The
  renderer already drops those lines from a mind map and names the picture
  from them, so the guidance now asks for them on every diagram.
- **The control never got a diagram.**
- **Diagram types:** the model mostly picks a flowchart. For the timeline it
  used `timeline` in 2 of 6 answers; for the sequence, `sequenceDiagram` in 1
  of 6; for the mind map, `mindmap` in 4 of 6. These all draw and are named,
  so the guidance doesn't push a type.
