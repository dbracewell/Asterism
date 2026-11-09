import { expect, it } from "vitest";
import { cn } from "./utils";

it("lets a shape tier replace another instead of applying both", () => {
  expect(cn("rounded-control border", "rounded-chip")).toBe(
    "border rounded-chip",
  );
  expect(cn("rounded-md", "rounded-overlay")).toBe("rounded-overlay");
  expect(cn("rounded-control", "rounded-t-surface")).toBe(
    "rounded-control rounded-t-surface",
  );
});
