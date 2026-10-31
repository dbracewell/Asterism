import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "./support/test";

const review = {
  suggestions: [
    {
      id: "goal",
      criterion: "goal",
      message: "Say exactly what you want written.",
      find: "about dogs",
      text: "a one-page care guide for a new puppy",
    },
    {
      id: "audience",
      criterion: "audience",
      message: "Say who the guide is for.",
      find: null,
      text: "The audience is [who will read this], for example first-time owners.",
    },
    {
      id: "output_format",
      criterion: "output_format",
      message: "Describe the shape of the answer.",
      find: null,
      text: "Use short headings and bullet points.",
    },
  ],
};

async function mock(page: Page, available = true) {
  const reviews: unknown[] = [];
  await page.route("**/api/py/skills/eligible*", (route) =>
    route.fulfill({
      json: {
        items: [],
        total: 0,
        page: 1,
        page_size: 100,
        policy_enabled: false,
        agent_revision: 1,
      },
    }),
  );
  await page.route("**/api/py/prompt-templates/frameworks", (route) =>
    route.fulfill({ json: { version: 1, items: [] } }),
  );
  await page.route("**/api/py/prompt-templates/?*", (route) =>
    route.fulfill({ json: { items: [], total: 0, page: 1, page_size: 100 } }),
  );
  await page.route("**/api/py/prompt-templates/coach", (route) =>
    route.fulfill({ json: { enabled: true, available } }),
  );
  await page.route("**/api/py/prompt-templates/coach/review", (route) => {
    reviews.push(route.request().postDataJSON());
    return route.fulfill({ json: review });
  });
  await page.route("**/api/py/test-skill-send", (route) =>
    route.fulfill({ json: { ok: true } }),
  );
  return reviews;
}

for (const [width, height] of [
  [1280, 800],
  [320, 568],
]) {
  test(`reviews a draft and applies suggestions without sending at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height });
    const reviews = await mock(page);
    await page.goto("/e2e/skill-chat");
    await expect(
      page.getByRole("button", { name: "Review prompt" }),
    ).toHaveCount(0);
    await page.getByRole("button", { name: "Turn coach on" }).click();

    const input = page.getByLabel("Message", { exact: true });
    await input.fill("Write about dogs.");
    await page.getByRole("button", { name: "Review prompt" }).click();
    const panel = page.getByRole("region", { name: "Prompt review" });
    await expect(panel.getByRole("listitem")).toHaveCount(3);
    expect(reviews).toEqual([{ prompt: "Write about dogs.", model_id: null }]);

    await panel.getByRole("button", { name: "Apply goal suggestion" }).click();
    await panel
      .getByRole("button", { name: "Apply output format suggestion" })
      .click();
    await expect(input).toHaveValue(
      "Write a one-page care guide for a new puppy.\n\nUse short headings and bullet points.",
    );
    await expect(panel.getByText("Applied")).toHaveCount(2);
    // Nothing is sent until the user sends.
    await expect(page.getByLabel("Last accepted payload")).toHaveText("");

    // The composer stays usable at narrow widths.
    const composer = page.locator("form").first();
    expect(
      await composer.evaluate((el) => el.scrollWidth - el.clientWidth),
    ).toBeLessThanOrEqual(0);
    expect(
      (
        await new AxeBuilder({ page })
          .include('[aria-label="Prompt review"]')
          .analyze()
      ).violations,
    ).toEqual([]);

    await page.getByLabel("Send message").click();
    await expect(page.getByLabel("Last accepted payload")).toContainText(
      '"prompt":"Write a one-page care guide for a new puppy.\\n\\nUse short headings and bullet points."',
    );
    await expect(panel).toBeHidden();
  });
}

test("the review action is unavailable without a usable model", async ({
  page,
}) => {
  const reviews = await mock(page, false);
  await page.goto("/e2e/skill-chat");
  await page.getByRole("button", { name: "Turn coach on" }).click();
  await page.getByLabel("Message", { exact: true }).fill("Write about dogs.");
  const button = page.getByRole("button", { name: "Review prompt" });
  await expect(button).toBeDisabled();
  await expect(button).toHaveAccessibleDescription(
    "Prompt review needs a draft model or a connected ChatGPT plan",
  );
  expect(reviews).toEqual([]);
});
