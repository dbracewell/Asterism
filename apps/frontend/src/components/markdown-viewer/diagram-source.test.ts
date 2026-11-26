import { prepareDiagramSource } from "@asterism/diagram-policy/diagram-source.js";
import { describe, expect, it } from "vitest";

// EPIC-108: models put accessibility lines above the type, where mermaid
// refuses the diagram; mind maps refuse them anywhere.
describe("prepareDiagramSource", () => {
  it("moves accessibility lines from above the type to just below it", () => {
    const prepared = prepareDiagramSource(
      "accTitle: Bill\naccDescr: How a bill becomes law.\nflowchart TD\n  a --> b\n",
    );
    expect(prepared).toEqual({
      source:
        "flowchart TD\naccTitle: Bill\naccDescr: How a bill becomes law.\n  a --> b\n",
      title: "Bill",
      description: "How a bill becomes law.",
    });
  });

  it("leaves a diagram already in order, or without the lines, unchanged", () => {
    const ordered = "flowchart LR\n  accTitle: Water\n  a --> b\n";
    expect(prepareDiagramSource(ordered)).toEqual({
      source: ordered,
      title: "Water",
      description: null,
    });
    const plain = "sequenceDiagram\n  a->>b: hi\n";
    expect(prepareDiagramSource(plain)).toEqual({
      source: plain,
      title: null,
      description: null,
    });
    expect(prepareDiagramSource("accTitle: Only\n").source).toBe(
      "accTitle: Only\n",
    );
  });

  it("drops them from mind maps wherever they are but keeps the names", () => {
    const prepared = prepareDiagramSource(
      "accTitle: Government\nmindmap\n  accDescr: Three branches\n  root((Gov))\n    Courts\n",
    );
    expect(prepared).toEqual({
      source: "mindmap\n  root((Gov))\n    Courts\n",
      title: "Government",
      description: "Three branches",
    });
  });

  it("moves a block description whole and reads its text", () => {
    const prepared = prepareDiagramSource(
      "accDescr {\n  Water evaporates,\n  and falls.\n}\nflowchart LR\n  a --> b\n",
    );
    expect(prepared.source).toBe(
      "flowchart LR\naccDescr {\n  Water evaporates,\n  and falls.\n}\n  a --> b\n",
    );
    expect(prepared.description).toBe("Water evaporates, and falls.");
    expect(
      prepareDiagramSource('accDescr { One line }\npie\n  "a": 1\n')
        .description,
    ).toBe("One line");
  });

  it("finds the type after front matter, comments and blank lines", () => {
    const source =
      '\n---\ntitle: Water\n---\n%% a comment\naccTitle: Water cycle\n%%{init: {"theme": "dark"}}%%\nflowchart LR\n  a --> b\n';
    expect(prepareDiagramSource(source).source).toBe(
      '\n---\ntitle: Water\n---\n%% a comment\n%%{init: {"theme": "dark"}}%%\nflowchart LR\naccTitle: Water cycle\n  a --> b\n',
    );
  });

  it("never changes any other line", () => {
    const source =
      'accTitle: T\nflowchart TD\n  a["<b>x</b>"] --> b\n  click a "javascript:alert(1)"\n  style b fill:url(/x)\n';
    const prepared = prepareDiagramSource(source).source.split("\n");
    expect([...prepared].sort()).toEqual([...source.split("\n")].sort());
  });
});
