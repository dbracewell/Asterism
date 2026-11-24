import { expect, it } from "vitest";
import { remainingStepsSummary, SETUP_STEPS } from "./steps";

it("summarises the steps after providers from the step list (US-102.2)", () => {
  expect(remainingStepsSummary()).toEqual({
    count: SETUP_STEPS.length - 1,
    text: `Groups and budgets, Tools and search, Image captioning and ${SETUP_STEPS.length - 4} more.`,
  });
});
