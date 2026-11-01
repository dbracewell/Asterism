import { describe, expect, it } from "vitest";
import {
  optionLetter,
  percentLabel,
  pointsLabel,
  questionCountLabel,
} from "./quiz";

describe("quiz labels", () => {
  it("formats points with half credit", () => {
    expect(pointsLabel(3, 4)).toBe("3 of 4");
    expect(pointsLabel(2.5, 4)).toBe("2.5 of 4");
  });

  it("formats percentages, counts and option letters", () => {
    expect(percentLabel(0.625)).toBe("63%");
    expect(percentLabel(0)).toBe("0%");
    expect(questionCountLabel(1)).toBe("1 question");
    expect(questionCountLabel(5)).toBe("5 questions");
    expect([0, 1, 5].map(optionLetter)).toEqual(["A", "B", "F"]);
  });
});
