import { expect, it } from "vitest";
import { trendSummary } from "./mastery";

const points = (...scores: (number | null)[]) =>
  scores.map((score, index) => ({ at: index, score }));

it("summarizes the weekly trend in words", () => {
  expect(trendSummary(points(null, null))).toBe("Not practiced yet.");
  expect(trendSummary(points(null, 0.5))).toBe(
    "First practiced recently, at 50%.",
  );
  expect(trendSummary(points(null, 0.4, 0.55, 0.7))).toBe(
    "Up from 40% to 70% over the last 4 weeks.",
  );
  expect(trendSummary(points(0.9, 0.6))).toBe(
    "Down from 90% to 60% over the last 2 weeks.",
  );
  expect(trendSummary(points(0.8, 0.801))).toBe(
    "Steady at 80% over the last 2 weeks.",
  );
});
