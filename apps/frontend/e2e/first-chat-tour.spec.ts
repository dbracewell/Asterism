import type { Page } from "@playwright/test";
import type { ChatModelChoice } from "../src/lib/client";
import { mockDefaultPersonas } from "./support/personas";
import { expect, test } from "./support/test";

// US-61.4: the optional first-chat tour on the new-chat page.
const model: ChatModelChoice = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Alpha",
  provider_id: "33333333-3333-4333-8333-333333333333",
  provider_name: "Provider",
  provider_type: "generic_openai",
  available: true,
  supports_vision: false,
  supports_tools: false,
  context_window: 4096,
};

async function mock(page: Page, { skills }: { skills: boolean }) {
  await mockDefaultPersonas(page);
  await page.route("**/api/py/chat/models*", (route) =>
    route.fulfill({ json: [model] }),
  );
  await page.route("**/api/py/skills/eligible*", (route) =>
    route.fulfill({
      json: {
        items: [],
        total: 0,
        page: 1,
        page_size: 100,
        policy_enabled: skills,
        agent_revision: 1,
      },
    }),
  );
  const saved: unknown[] = [];
  await page.route("**/api/py/settings/user/first_chat_tour", (route) => {
    const body = route.request().postDataJSON() as { value: unknown };
    saved.push(body.value);
    return route.fulfill({
      json: { key: "first_chat_tour", value: body.value },
    });
  });
  return saved;
}

for (const [width, height] of [
  [1280, 800],
  [320, 568],
]) {
  test(`a new learner can take the tour at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    const saved = await mock(page, { skills: true });
    await page.goto("/e2e/chat-model-session?draft=true&learner=new");

    const offer = page.getByRole("region", { name: "New here?" });
    await offer.getByRole("button", { name: "Start tour" }).click();

    const dialog = page.getByRole("dialog");
    for (let step = 1; ; step++) {
      await expect(
        dialog.getByText(`Step ${step} of 6`, { exact: true }),
      ).toBeVisible();
      // The step and its highlight stay on screen.
      const box = (await dialog.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(width);
      expect(box.y).toBeGreaterThanOrEqual(0);
      await expect(page.getByTestId("tour-highlight")).toBeVisible();
      const next = dialog.getByRole("button", { name: /^(Next|Finish)$/ });
      await expect(next).toBeFocused();
      if ((await next.textContent()) === "Finish") break;
      await next.click();
    }
    await expect(dialog).toHaveAccessibleName("More options");
    await dialog.getByRole("button", { name: "Finish" }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByLabel("Message", { exact: true })).toBeFocused();
    await expect.poll(() => saved).toEqual(["completed"]);
    await expect(offer).toBeHidden();
  });
}

test("the skills step is skipped while skills are off, and Escape dismisses", async ({
  page,
}) => {
  const saved = await mock(page, { skills: false });
  await page.goto("/e2e/chat-model-session?draft=true&learner=new");
  await page.getByRole("button", { name: "Start tour" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("Step 1 of 5", { exact: true })).toBeVisible();
  for (let step = 0; step < 4; step++) {
    await expect(dialog).not.toHaveAccessibleName("Skills");
    await dialog.getByRole("button", { name: "Next" }).click();
  }
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect.poll(() => saved).toEqual(["dismissed"]);
});

test("a returning learner is not offered the tour", async ({ page }) => {
  await mock(page, { skills: false });
  await page.goto("/e2e/chat-model-session?draft=true");
  await expect(page.getByLabel("Message", { exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "New here?" })).toHaveCount(0);
});

test("a tour link replays the tour for a learner who finished it", async ({
  page,
}) => {
  const saved = await mock(page, { skills: false });
  await page.goto("/e2e/chat-model-session?draft=true&tour=first-chat");
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("Step 1 of 5", { exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "Skip tour" }).first().click();
  await expect(dialog).toBeHidden();
  await expect(page).toHaveURL(/draft=true$/);
  // Skipping a replay keeps the earlier completion.
  expect(saved).toEqual([]);
});
