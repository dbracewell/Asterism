import type { Page } from "@playwright/test";
import type { LearningModeCatalog } from "../../src/lib/client";
import { defaultPersonas } from "../../src/test/personas";

export const learningModes: LearningModeCatalog = {
  modes: [
    {
      id: "standard",
      name: "Standard",
      description: "Answers your questions directly.",
      version: 1,
    },
    {
      id: "tutor",
      name: "Tutor",
      description: "Guides you with questions and hints instead of answers.",
      version: 2,
      hint_levels: ["nudge", "hint", "worked_example", "answer"],
    },
    {
      id: "explain_back",
      name: "Explain-back",
      description: "You explain a topic; it tells you what you missed.",
      version: 1,
    },
    {
      id: "review",
      name: "Review my work",
      description: "Gives feedback on your attempt.",
      version: 1,
    },
  ],
};

/**
 * Synthetic chat harnesses need an owned persona just like their model
 * fixtures, and the composer's learning-mode catalog beside it.
 */
export async function mockDefaultPersonas(page: Page) {
  await page.route(/\/api\/py\/users\/personas(?:\?.*)?$/, (route) =>
    route.fulfill({ json: defaultPersonas }),
  );
  await page.route(/\/api\/py\/learning-modes(?:\?.*)?$/, (route) =>
    route.fulfill({ json: learningModes }),
  );
}
