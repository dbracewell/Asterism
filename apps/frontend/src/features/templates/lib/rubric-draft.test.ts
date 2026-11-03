import { describe, expect, it } from "vitest";
import {
  addLevel,
  blankRubricDraft,
  hasRubricIssues,
  moveLevel,
  removeLevel,
  rubricFromDocument,
  rubricToDocument,
  validateRubric,
} from "./rubric-draft";

const document = {
  name: "Essay",
  description: "Checks an essay.",
  levels: ["High", "Low"],
  criteria: [
    { label: "Thesis", description: "", descriptors: ["Clear.", "Vague."] },
  ],
};

describe("rubric drafts", () => {
  it("round-trips a document", () => {
    expect(rubricToDocument(rubricFromDocument(document))).toEqual(document);
    expect(hasRubricIssues(validateRubric(rubricFromDocument(document)))).toBe(
      false,
    );
  });

  it("keeps descriptors aligned when levels change", () => {
    let draft = rubricFromDocument(document);
    draft = addLevel(draft);
    expect(draft.criteria[0].descriptors).toEqual(["Clear.", "Vague.", ""]);
    draft = moveLevel(draft, 0, 1);
    expect(draft.levels.map((level) => level.label)).toEqual([
      "Low",
      "High",
      "",
    ]);
    expect(draft.criteria[0].descriptors).toEqual(["Vague.", "Clear.", ""]);
    draft = removeLevel(draft, 2);
    expect(rubricToDocument(draft).criteria[0].descriptors).toEqual([
      "Vague.",
      "Clear.",
    ]);
  });

  it("mirrors the server's rules", () => {
    const draft = rubricFromDocument({
      ...document,
      name: "Two\nlines",
      levels: ["High", " high "],
      criteria: [
        { label: "Overall", description: "", descriptors: ["a", " "] },
        { label: "overall", description: "", descriptors: ["a", "b"] },
      ],
    });
    const issues = validateRubric(draft);
    expect(issues.general).toEqual([
      "Name must be a single line.",
      "Level names must be unique.",
    ]);
    expect(issues.criteria[draft.criteria[0].uid]).toEqual([
      '"Overall" is reserved for the overall feedback.',
      "Describe the high level.",
    ]);
    expect(issues.criteria[draft.criteria[1].uid]).toEqual([
      "Another criterion has this name.",
    ]);
    const blank = validateRubric(blankRubricDraft());
    expect(blank.general).toEqual([
      "Name is required.",
      "Description is required.",
    ]);
    expect(Object.values(blank.criteria)[0]).toHaveLength(5);
  });
});
