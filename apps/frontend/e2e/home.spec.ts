import { expect, test } from "@playwright/test";

test("home page renders auth form", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "ASTERISM" })).toBeVisible();
  await expect(page.getByLabel("Email")).toBeVisible();
  await expect(page.getByLabel("Password")).toBeVisible();
  await expect(page.getByRole("button", { name: "Login" })).toBeVisible();
});
