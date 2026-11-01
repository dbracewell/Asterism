import type { FeedbackSection } from "@/lib/client";
import { describe, expect, it } from "vitest";
import { parseFeedback } from "./feedback-sections";

const sections: FeedbackSection[] = [
  { id: "correct", heading: "What you got right" },
  { id: "gaps", heading: "What was missing or wrong" },
  { id: "follow_up", heading: "Follow-up questions" },
];

const reply = `### What you got right
Plants use sunlight and water.

### What was missing or wrong
You left out carbon dioxide.

### Follow-up questions
1. Which gas do plants take in?`;

describe("parseFeedback", () => {
  it("splits a structured reply into its sections", () => {
    expect(parseFeedback(reply, sections)).toEqual({
      preamble: "",
      sections: [
        {
          id: "correct",
          heading: "What you got right",
          body: "Plants use sunlight and water.",
        },
        {
          id: "gaps",
          heading: "What was missing or wrong",
          body: "You left out carbon dioxide.",
        },
        {
          id: "follow_up",
          heading: "Follow-up questions",
          body: "1. Which gas do plants take in?",
        },
      ],
    });
  });

  it("accepts other heading levels, bold, a colon and keeps a preamble", () => {
    const varied = `Nice effort.\n\n## **what you got right**:\nA\n#### What was missing or wrong\nB\n# Follow-up questions\n1. Why?`;
    const parsed = parseFeedback(varied, sections);
    expect(parsed?.preamble).toBe("Nice effort.");
    expect(parsed?.sections.map((section) => section.body)).toEqual([
      "A",
      "B",
      "1. Why?",
    ]);
  });

  it("returns the sections received so far while streaming", () => {
    const partial = "### What you got right\nPlants use sun";
    expect(parseFeedback(partial, sections)?.sections).toEqual([
      { id: "correct", heading: "What you got right", body: "Plants use sun" },
    ]);
  });

  it("ignores replies that are not structured feedback", () => {
    expect(
      parseFeedback("Explain photosynthesis in your own words.", sections),
    ).toBeNull();
    // A heading text inside a sentence is not a heading.
    expect(
      parseFeedback("Tell me What you got right last time.", sections),
    ).toBeNull();
    expect(parseFeedback(reply, [])).toBeNull();
  });

  it("ignores replies whose first section is missing or out of order", () => {
    expect(
      parseFeedback(
        "### What was missing or wrong\nB\n### Follow-up questions\n1. Why?",
        sections,
      ),
    ).toBeNull();
    expect(
      parseFeedback(
        "### What you got right\nA\n### Follow-up questions\n1. Why?\n### What was missing or wrong\nB",
        sections,
      ),
    ).toBeNull();
  });
});
