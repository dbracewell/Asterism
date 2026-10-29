import { expect, test } from "./support/test";
import { authViewports, exerciseAuth } from "./support/auth-reachability";

test("fresh installation renders administrator setup form", async ({
  page,
}) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "ASTERISM" })).toBeVisible();
  await expect(page.getByText("Set up your Asterism instance")).toBeVisible();
  const steps = page.getByRole("list", { name: "First-run setup" });
  await expect(steps.getByRole("listitem")).toHaveCount(3);
  await expect(steps.locator('[aria-current="step"]')).toContainText(
    "Create the administrator account",
  );
  await expect(page.getByLabel("Email")).toBeVisible();
  await expect(page.getByLabel("Password")).toBeVisible();
  await expect(page.getByText("Admin Passkey", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign up" })).toBeVisible();
});

// These cases run only in the fresh-install dependency project, before any
// account-creating Chromium specs. Failed setup validation creates no users.
test.use({ hasTouch: true });
for (const scenario of authViewports) {
  test(`setup controls, errors and keyboard focus at ${scenario.width}x${scenario.height}, ${(scenario.fontSize / 16) * 100}% text`, async ({
    page,
  }, info) => {
    await exerciseAuth(page, scenario, true, info);
  });
}
