# EPIC-108: Diagrams that real models draw

Status: in progress (2026-11-25). Source: user request (2026-11-25), the
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

### US-108.2: Check the guidance on more models (proposed)

- [ ] Run a fixed set of diagram prompts (process, cycle, sequence, timeline,
      mind map, hierarchy) on each enabled model. Record whether it answered
      with a diagram, whether it drew, and whether it has a title.
- [ ] Adjust the guidance for any failure common to several models; record
      the results in this epic
