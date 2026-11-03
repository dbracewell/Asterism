import { describe, expect, it } from "vitest";
import { parseRubricFeedback } from "./rubric-feedback";

const rubric = {
  levels: ["Exemplary", "Proficient", "Developing", "Beginning"],
  criteria: ["Thesis", "Evidence", "Style and conventions"],
};
const format = { level_label: "Estimated level", overall_heading: "Overall" };

const reply = `### Thesis
Estimated level: Proficient

> Uniforms should be required.

Clear, but say why.

### Evidence
**Estimated level:** developing

> a study said

Name the study.

### Style and conventions
Estimated level: **Exemplary**.

Clean sentences.

### Overall
Strong start; find a source.`;

describe("parseRubricFeedback", () => {
  it("splits criteria in order and reads each level", () => {
    const parsed = parseRubricFeedback(reply, rubric, format)!;
    expect(parsed.preamble).toBe("");
    expect(
      parsed.criteria.map(({ criterion, level, levelIndex }) => [
        criterion,
        level,
        levelIndex,
      ]),
    ).toEqual([
      ["Thesis", "Proficient", 1],
      ["Evidence", "developing", 2],
      ["Style and conventions", "Exemplary", 0],
    ]);
    expect(parsed.criteria[0].body).toBe(
      "> Uniforms should be required.\n\nClear, but say why.",
    );
    expect(parsed.overall).toBe("Strong start; find a source.");
  });

  it("keeps an unknown or missing level visible", () => {
    const parsed = parseRubricFeedback(
      reply
        .replace("Estimated level: Proficient", "Estimated level: Great")
        .replace("**Estimated level:** developing\n", ""),
      rubric,
      format,
    )!;
    expect(parsed.criteria[0]).toMatchObject({
      level: "Great",
      levelIndex: null,
    });
    expect(parsed.criteria[1]).toMatchObject({ level: null, levelIndex: null });
    expect(parsed.criteria[1].body).toContain("Name the study.");
  });

  it("renders partial replies while streaming", () => {
    const partial = reply.slice(0, reply.indexOf("### Evidence") + 20);
    const parsed = parseRubricFeedback(partial, rubric, format)!;
    expect(parsed.criteria.map((item) => item.criterion)).toEqual([
      "Thesis",
      "Evidence",
    ]);
    expect(parsed.overall).toBeNull();
  });

  it("returns null for replies that are not rubric feedback", () => {
    expect(
      parseRubricFeedback(
        "Please choose a rubric with the Rubric control.",
        rubric,
        format,
      ),
    ).toBeNull();
    expect(
      parseRubricFeedback(
        "**Example rewrite**\n\nUniforms reduce visible inequality.",
        rubric,
        format,
      ),
    ).toBeNull();
    // Out of order: Evidence before Thesis.
    const swapped = reply
      .replace("### Thesis", "### Tmp")
      .replace("### Evidence", "### Thesis")
      .replace("### Tmp", "### Evidence");
    expect(parseRubricFeedback(swapped, rubric, format)).toBeNull();
    expect(
      parseRubricFeedback(reply, { ...rubric, criteria: [] }, format),
    ).toBeNull();
  });
});
