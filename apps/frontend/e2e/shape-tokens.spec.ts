import { expect, test } from "./support/test";

// US-41.4 baselines: shape tiers and elevation on the palette review harness
// (composer, settings controls, cards, chips, popover and markdown surfaces).
const viewports = [
  { name: "desktop", width: 1100, height: 1100 },
  { name: "mobile", width: 390, height: 1400 },
];

for (const theme of ["atlas", "night-atlas", "dracula"]) {
  for (const viewport of viewports) {
    test(`${theme}: shape tiers at ${viewport.name}`, async ({
      page,
      context,
    }) => {
      await context.addCookies([
        {
          name: "asterism-custom-theme-name",
          value: theme,
          url: "http://localhost:3100",
        },
      ]);
      await page.setViewportSize(viewport);
      await page.route("**/api/py/chat/models", (route) =>
        route.fulfill({
          json: [
            {
              id: "contrast-model",
              name: "Palette chat model",
              provider_id: "contrast-provider",
              provider_name: "Synthetic provider",
              provider_type: "generic_openai",
              available: true,
            },
          ],
        }),
      );
      await page.goto("/e2e/theme-contrast");
      await expect(
        page.getByRole("heading", { name: `Palette review: ${theme}` }),
      ).toBeVisible();
      await expect(
        page.getByRole("combobox", { name: "Chat model", exact: true }),
      ).toHaveText("Palette chat model (Synthetic provider)");

      // Tiers stay ordered: control < surface < overlay (composer).
      const radius = (selector: string) =>
        page
          .locator(selector)
          .first()
          .evaluate((el) =>
            parseFloat(getComputedStyle(el).borderTopLeftRadius),
          );
      const control = await radius("[data-slot=button]");
      const surface = await radius(".rounded-surface");
      const overlay = await radius(".rounded-overlay");
      expect(control).toBeCloseTo(0.8 * 0.45 * 16, 1);
      expect(surface).toBeCloseTo(1.4 * 0.45 * 16, 1);
      expect(overlay).toBeCloseTo(1.8 * 0.45 * 16, 1);

      await page.mouse.move(0, 0);
      await expect(page).toHaveScreenshot(
        `shape-tokens-${theme}-${viewport.name}.png`,
        { clip: { x: 0, y: 0, width: viewport.width, height: 1100 } },
      );
    });
  }
}
