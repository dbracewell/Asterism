import type { Page } from "@playwright/test";
import { expect, test } from "./support/test";

// US-101.2: Admin Settings → Setup walks through every step with Skip and
// Next, and progress kept on the server lets setup resume where it stopped.
// The server's progress is a route double here; the backend tests store it.
async function routeProgress(page: Page) {
  const steps: Record<string, { state: string; at: number }> = {
    providers: { state: "done", at: 1 },
  };
  const writes: { step: string; state: string | null }[] = [];
  await page.route("**/api/py/**", (route) =>
    route.fulfill({ status: 503, json: { detail: "Fixture unavailable" } }),
  );
  await page.route("**/api/py/settings/app/setup", (route) =>
    route.fulfill({ json: { steps } }),
  );
  await page.route("**/api/py/settings/app/setup/steps/*", async (route) => {
    const step = route.request().url().split("/").at(-1)!;
    const { state } = route.request().postDataJSON();
    writes.push({ step, state });
    if (state) steps[step] = { state, at: 2 };
    else delete steps[step];
    await route.fulfill({ json: { steps } });
  });
  return { steps, writes };
}

const current = (page: Page) =>
  page.getByRole("region", { name: /./ }).filter({ hasText: /^Step \d+ of/ });

test("an administrator skips, reviews and resumes setup steps", async ({
  page,
}) => {
  const progress = await routeProgress(page);
  await page.goto("/e2e/planned-settings?setting=setup");

  const steps = page.getByRole("navigation", { name: "Setup steps" });
  await expect(steps.getByRole("status")).toHaveText(/1 of 12 steps reviewed/);
  // The first-run provider steps already reviewed Providers.
  await expect(
    steps.getByRole("button", { name: /Providers and models/ }),
  ).toContainText("Reviewed");
  await expect(
    current(page).getByRole("heading", { name: "Groups and budgets" }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Skip for now" }).click();
  await expect(
    current(page).getByRole("heading", { name: "Usage time zone" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Next" }).click();
  await expect(
    current(page).getByRole("heading", { name: "Tools and search" }),
  ).toBeVisible();
  expect(progress.writes).toEqual([
    { step: "group-settings", state: "skipped" },
    { step: "usage", state: "done" },
  ]);
  await expect(
    steps.getByRole("button", { name: /Groups and budgets/ }),
  ).toContainText("Skipped");

  // Coming back later resumes at the first step nobody reviewed.
  await page.goto("/e2e/planned-settings?setting=setup");
  await expect(
    current(page).getByRole("heading", { name: "Tools and search" }),
  ).toBeVisible();
  await expect(steps.getByRole("status")).toHaveText(/3 of 12 steps reviewed/);

  // Any step can be opened from the list; captioning says what search needs.
  await steps.getByRole("button", { name: /Image captioning/ }).click();
  await expect(current(page)).toContainText(
    "While it is off, pictures are kept and can be attached to chats, but search can't find them.",
  );
  await expect(
    current(page).getByRole("link", {
      name: "Read more in the guide: Image captioning",
    }),
  ).toHaveAttribute(
    "href",
    "/help/guide/08-for-administrators/policies#image-captioning",
  );

  // The last step is context compaction; Next from it reviews it.
  await steps.getByRole("button", { name: /Context compaction/ }).click();
  await page.getByRole("button", { name: "Next" }).click();

  // The summary sorts what is left from what was skipped or reviewed.
  await steps.getByRole("button", { name: "Summary" }).click();
  await expect(page.getByRole("list", { name: "Skipped (1)" })).toContainText(
    "Groups and budgets",
  );
  await expect(page.getByRole("list", { name: "Reviewed (3)" })).toContainText(
    "Context compaction",
  );
  await page
    .getByRole("list", { name: "Skipped (1)" })
    .getByRole("button", { name: "Groups and budgets" })
    .click();
  await expect(
    current(page).getByRole("heading", { name: "Groups and budgets" }),
  ).toBeVisible();
});

test("Next saves a step's edits and Skip discards them (US-102.3)", async ({
  page,
}) => {
  const progress = await routeProgress(page);
  let timezone = "UTC";
  let skills = false;
  await page.route("**/api/py/usage/settings", async (route) => {
    if (route.request().method() === "PUT")
      timezone = route.request().postDataJSON().timezone;
    await route.fulfill({ json: { timezone } });
  });
  await page.route("**/api/py/settings/app/skills", async (route) => {
    if (route.request().method() === "PUT")
      skills = route.request().postDataJSON().enabled;
    await route.fulfill({ json: { enabled: skills } });
  });
  await page.goto("/e2e/planned-settings?setting=setup&step=usage");

  // Save and continue saves the time zone before moving on.
  const zone = page.getByLabel("Timezone (IANA name)");
  await zone.fill("Europe/London");
  await page.getByRole("button", { name: "Save and continue" }).click();
  await expect(
    current(page).getByRole("heading", { name: "Tools and search" }),
  ).toBeVisible();
  expect(timezone).toBe("Europe/London");
  expect(progress.writes).toEqual([{ step: "usage", state: "done" }]);
  await expect(
    page
      .getByRole("navigation", { name: "Setup steps" })
      .getByRole("button", { name: /Usage time zone/ }),
  ).toContainText("Reviewed");

  // Skip asks first, and discarding leaves Skills off.
  await page
    .getByRole("navigation", { name: "Setup steps" })
    .getByRole("button", { name: /Skills/ })
    .click();
  await page.getByRole("switch").click();
  await page.getByRole("button", { name: "Skip for now" }).click();
  await page
    .getByRole("alertdialog", { name: "Discard unsaved changes?" })
    .getByRole("button", { name: "Discard changes" })
    .click();
  await expect(
    current(page).getByRole("heading", { name: "Canvas" }),
  ).toBeVisible();
  expect(skills).toBe(false);
  expect(progress.writes.at(-1)).toEqual({ step: "skills", state: "skipped" });
});

test("the walkthrough fits a phone screen", async ({ page }) => {
  await routeProgress(page);
  await page.setViewportSize({ width: 360, height: 740 });
  await page.goto("/e2e/planned-settings?setting=setup");
  await expect(
    current(page).getByRole("heading", { name: "Groups and budgets" }),
  ).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});
