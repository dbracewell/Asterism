import { expect, it } from "vitest";
import { unclearItems } from "./unclear-items";

it("splits lines, removes list markers and drops repeats", () => {
  expect(
    unclearItems(
      "- Tonicity\n\n* Why cells burst\n2. Osmosis vs diffusion\nTonicity",
    ),
  ).toEqual(["Tonicity", "Why cells burst", "Osmosis vs diffusion"]);
  expect(unclearItems("One paragraph about - dashes.")).toEqual([
    "One paragraph about - dashes.",
  ]);
  expect(unclearItems("  \n ")).toEqual([]);
});
