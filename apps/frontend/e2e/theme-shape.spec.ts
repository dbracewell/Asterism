import { expect, test } from "./support/test";

const viewports = [
  { name: "desktop", width: 1280, height: 1000 },
  { name: "mobile", width: 390, height: 1400 },
];

// Dracula omits shape values, so it also exercises the Atlas fallback.
for (const [theme, label] of [
  ["atlas", "Atlas"],
  ["night-atlas", "Night Atlas"],
  ["dracula", "Dracula"],
] as const) {
  for (const viewport of viewports) {
    test(`${theme}: shape controls preview at ${viewport.name}`, async ({
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
      await page.goto("/e2e/themes");
      const root = await page.evaluate(() => {
        const style = getComputedStyle(document.documentElement);
        return ["--radius", "--elevation", "--spacing"].map((key) =>
          style.getPropertyValue(key).trim(),
        );
      });
      expect(root).toEqual(["0.45rem", "1", "0.25rem"]);

      await page.getByRole("button", { name: label, exact: true }).click();
      await expect(page.getByLabel("Corner radius (rem)")).toHaveValue("0.45");
      const preview = page.getByTestId("theme-preview");
      const card = preview.locator("> div");
      const measure = () =>
        card.evaluate((el) => {
          const style = getComputedStyle(el);
          return {
            radius: style.borderTopLeftRadius,
            padding: style.paddingTop,
            shadow: style.boxShadow,
          };
        });
      const soft = await measure();
      expect(soft.radius).toBe("10.08px"); // rounded-surface = 1.4 × 0.45rem
      expect(soft.padding).toBe("16px");
      expect(soft.shadow).toMatch(/rgba\(0, 0, 0, 0\.08\)/); // shadow-raised

      await page.getByLabel("Corner radius (rem)").fill("1");
      await page.getByLabel("Shadows").click();
      await page.getByRole("option", { name: "Flat" }).click();
      await page.getByLabel("Density").click();
      await page.getByRole("option", { name: "Compact" }).click();
      const flat = await measure();
      expect(flat.radius).toBe("22.4px");
      expect(flat.padding).toBe("14.4px");
      expect(flat.shadow).not.toMatch(/rgba\(0, 0, 0, 0\.[1-9]/);
      // The draft stays scoped to the preview until it is saved.
      expect(
        await page.evaluate(() =>
          getComputedStyle(document.documentElement)
            .getPropertyValue("--radius")
            .trim(),
        ),
      ).toBe("0.45rem");

      await page.getByLabel("Corner radius (rem)").fill("2");
      await expect(preview).toHaveCount(0);
      await page.getByLabel("Corner radius (rem)").fill("0");
      // Keep the sticky "Unsaved changes" bar from covering the preview.
      await preview.evaluate((el) => el.scrollIntoView({ block: "start" }));
      await expect(preview).toHaveScreenshot(
        `theme-shape-${theme}-${viewport.name}.png`,
      );
    });
  }
}
