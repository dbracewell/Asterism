import { expect, test } from "@playwright/test";

test("fresh installation renders administrator setup form", async ({
  page,
}) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "ASTERISM" })).toBeVisible();
  await expect(page.getByText("Setup your ASTERISM instance")).toBeVisible();
  await expect(page.getByLabel("Email")).toBeVisible();
  await expect(page.getByLabel("Password")).toBeVisible();
  await expect(page.getByText("Admin Passkey", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign up" })).toBeVisible();
});
