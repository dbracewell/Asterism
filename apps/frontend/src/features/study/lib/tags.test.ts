import { expect, it } from "vitest";
import { formatTags, parseTags, tagProblem } from "./tags";

it("parses comma-separated topics like the server normalizes them", () => {
  expect(parseTags(" Cell  biology, energy , cell BIOLOGY,, ")).toEqual([
    "Cell biology",
    "energy",
  ]);
  expect(parseTags("")).toEqual([]);
  expect(formatTags(["Cells", "Energy"])).toBe("Cells, Energy");
});

it("reports the limits the server enforces", () => {
  expect(tagProblem(["a"])).toBeNull();
  expect(tagProblem(Array.from({ length: 9 }, (_, i) => `t${i}`))).toBe(
    "Use at most 8 topics.",
  );
  expect(tagProblem(["x".repeat(41)])).toMatch(/under 40 characters/);
});
