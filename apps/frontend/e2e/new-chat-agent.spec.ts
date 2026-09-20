import { expect, test } from "@playwright/test";

test("selects a main agent for a new chat without exposing sub-agents", async ({
  page,
}) => {
  await page.goto("/e2e/new-chat-agent");

  await page.getByLabel("Main agent for new chat").click();
  await expect(page.getByRole("option", { name: "Default assistant" })).toBeVisible();
  await expect(page.getByRole("option", { name: "Writing assistant" })).toBeVisible();
  await expect(page.getByRole("option", { name: "Hidden worker" })).toHaveCount(0);

  await page.getByRole("option", { name: "Writing assistant" }).click();
  await page.getByRole("button", { name: "Start chat" }).click();
  await expect(page.getByRole("status")).toHaveText("Created with main-writer");
});
