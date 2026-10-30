import { expect, test } from "./support/test";

const viewports = [
  { name: "desktop", width: 1280, height: 800 },
  { name: "mobile", width: 390, height: 800 },
];

for (const theme of ["atlas", "night-atlas", "dracula"]) {
  for (const viewport of viewports) {
    test(`${theme}: type system at ${viewport.name}`, async ({
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
      await page.route("**/api/py/files/info/*", (route) =>
        route.fulfill({ status: 404, json: { detail: "Missing image" } }),
      );
      await page.goto("/e2e/semantic-ui");
      await page.evaluate(() => document.fonts.ready);

      const families = await page.evaluate(() => {
        const fonts = new Set<string>();
        document.fonts.forEach((face) => {
          if (face.status === "loaded") fonts.add(face.family);
        });
        return [...fonts];
      });
      expect(families.join(" ")).not.toMatch(/Inter|Geist|Montserrat/);
      expect(families.join(" ")).toMatch(/Schibsted/);
      // Capture the settled page: every missing image has resolved to its
      // error state rather than a loading spinner.
      await expect(page.getByText("Failed to load image")).toHaveCount(4);

      await expect(page).toHaveScreenshot(
        `typography-${theme}-${viewport.name}.png`,
        { animations: "disabled", maxDiffPixelRatio: 0.01 },
      );
    });
  }
}
