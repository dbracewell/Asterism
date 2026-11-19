import { describe, expect, it } from "vitest";
import { reflowPassage } from "./passage-text";

const paragraphs = (text: string) => {
  const result = reflowPassage(text);
  return result.kind === "paragraphs" ? result.paragraphs : null;
};

describe("reflowPassage", () => {
  it("joins PDF lines that each sit apart, keeping a short heading on its own", () => {
    const pdf = [
      "The chloroplast",
      "A chloroplast is surrounded by two membranes. Inside are stacks of thylakoids,",
      "called grana, where the light-dependent reactions take place. The fluid around",
      "them is the stroma, where the Calvin cycle runs. Chloroplasts contain their own",
      "DNA and ribosomes.",
    ].join("\n\n");
    expect(paragraphs(pdf)).toEqual([
      "The chloroplast",
      "A chloroplast is surrounded by two membranes. Inside are stacks of thylakoids, " +
        "called grana, where the light-dependent reactions take place. The fluid around " +
        "them is the stroma, where the Calvin cycle runs. Chloroplasts contain their own " +
        "DNA and ribosomes.",
    ]);
  });

  it("treats blank lines as paragraphs when lines wrap with single newlines", () => {
    expect(
      paragraphs("First line\nwraps here.\n\nSecond paragraph\ncontinues."),
    ).toEqual(["First line wraps here.", "Second paragraph continues."]);
  });

  it("keeps headings, list items, quotes and table rows on their own lines", () => {
    expect(
      paragraphs(
        "# Light reactions\nWater is split\nto release oxygen.\n- ATP\n- NADPH\n> A quote\n| a | b |\n| 1 | 2 |",
      ),
    ).toEqual([
      "# Light reactions",
      "Water is split to release oxygen.",
      "- ATP",
      "- NADPH",
      "> A quote",
      "| a | b |",
      "| 1 | 2 |",
    ]);
  });

  it("starts a new paragraph after a sentence in spaced text", () => {
    expect(
      paragraphs("Results.\n\nThe rate levelled off\n\nafter 60% light."),
    ).toEqual(["Results.", "The rate levelled off after 60% light."]);
  });

  it("joins a word hyphenated across lines without a space", () => {
    expect(paragraphs("the thyla-\nkoid membrane")).toEqual([
      "the thyla-koid membrane",
    ]);
  });

  it("leaves text with a code block exactly as stored", () => {
    const text = "Run:\n```\nnpm test\n```";
    expect(reflowPassage(text)).toEqual({ kind: "preformatted", text });
  });

  it("returns no paragraphs for blank text", () => {
    expect(paragraphs(" \n\n ")).toEqual([]);
  });
});
