import { expect, it } from "vitest";
import { availableTourSteps, firstChatTourSteps } from "./tour";

// EPIC-97: a step about a feature that is off for the person is skipped.
function page() {
  const root = document.createElement("div");
  for (const step of firstChatTourSteps) {
    const target = document.createElement("div");
    target.dataset.tour = step.target;
    root.append(target);
  }
  return root;
}

it("skips steps for features that are off", () => {
  const ids = (has: (feature: string) => boolean) =>
    availableTourSteps(has, page()).map((step) => step.id);
  expect(ids(() => true)).toContain("skills");
  expect(ids((feature) => feature !== "skills")).not.toContain("skills");
  expect(ids(() => false)).toEqual([
    "composer",
    "learning-mode",
    "model",
    "options",
  ]);
});
