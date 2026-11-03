import { expect, it } from "vitest";
import { draftSegments } from "./draft-segments";

it("splits text at span boundaries, sharing overlaps", () => {
  const segments = draftSegments("abcdefghij", [
    { id: "c1", start: 2, end: 6 },
    { id: "c2", start: 4, end: 8 },
  ]);
  expect(segments.map(({ text, ids }) => [text, ids])).toEqual([
    ["ab", []],
    ["cd", ["c1"]],
    ["ef", ["c1", "c2"]],
    ["gh", ["c2"]],
    ["ij", []],
  ]);
});

it("ignores empty spans and clamps out-of-range ones", () => {
  expect(
    draftSegments("abc", [
      { id: "c1", start: 1, end: 1 },
      { id: "c2", start: 2, end: 99 },
    ]).map(({ text, ids }) => [text, ids]),
  ).toEqual([
    ["ab", []],
    ["c", ["c2"]],
  ]);
  expect(draftSegments("", [])).toEqual([]);
});
