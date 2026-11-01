import { expect, test } from "./support/test";

test.use({ hasTouch: true, viewport: { width: 320, height: 568 } });

test("help popover opens by tap, fits a 320px screen and closes with Escape", async ({
  page,
}) => {
  await page.goto("/e2e/help");
  // Admin-only help is hidden without an admin audience.
  await expect(
    page.getByRole("button", { name: "Help: Tool policy" }),
  ).toHaveCount(0);

  const trigger = page.getByRole("button", { name: "Help: Persona" });
  await trigger.tap();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toHaveAccessibleName("Help: Persona");
  await dialog.getByRole("button", { name: "Learn more" }).tap();
  await expect(dialog.getByText(/isn't a memory/)).toBeVisible();

  const box = await dialog.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(320);

  await dialog.getByRole("button", { name: "Skill" }).tap();
  await expect(dialog).toHaveAccessibleName("Help: Skill");
  await expect(dialog.getByRole("heading", { name: "Skill" })).toBeFocused();
  await dialog.getByRole("button", { name: "Back" }).tap();
  await expect(dialog.getByRole("heading", { name: "Persona" })).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
});
