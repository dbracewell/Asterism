import { expect, test } from "./support/test";

import { measure } from "./support/contrast";
import { themes } from "./support/theme-matrix";

// Prose and code blocks in every bundled theme, on both chat surfaces: text
// roles meet AA and a full-page screenshot is attached for visual review.
for (const theme of themes) {
  test(`${theme}: prose tables, links, quotes and code blocks`, async ({
    page,
    context,
  }, info) => {
    await context.addCookies([
      {
        name: "asterism-custom-theme-name",
        value: theme,
        url: "http://localhost:3100",
      },
    ]);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/e2e/prose");

    const results: Record<string, number> = {};
    for (const surface of ["background", "card"]) {
      const section = page.getByRole("region", {
        name: `Prose on ${surface}`,
      });
      await expect(section.getByRole("table")).toBeVisible();
      const targets = {
        header: section.getByRole("columnheader").first(),
        "odd-row": section.locator("tbody tr:nth-child(1) td").first(),
        "even-row": section.locator("tbody tr:nth-child(2) td").first(),
        link: section.getByRole("link", { name: "the Hipparcos survey" }),
        quote: section.locator("blockquote p"),
        "inline-code": section.locator("p code"),
        "code-language": section.locator("[data-slot=code-block] span").first(),
      };
      for (const [name, locator] of Object.entries(targets)) {
        const id = `${surface}-${name}`;
        await locator.evaluate(
          (element, id) => element.setAttribute("data-contrast", id),
          id,
        );
        const { ratio } = await measure(page, id);
        results[id] = Number(ratio.toFixed(2));
        expect(ratio, `${theme}: ${id}`).toBeGreaterThanOrEqual(4.5);
      }
      // Header and striped rows stay distinguishable from ordinary rows.
      const fills = await section
        .locator("thead th:first-child, tbody tr:nth-child(-n + 2)")
        .evaluateAll((nodes) =>
          nodes.map((node) => getComputedStyle(node).backgroundColor),
        );
      expect(fills).toHaveLength(3);
      expect(new Set(fills).size, `${theme}: ${surface} row fills`).toBe(3);
    }

    const screenshot = info.outputPath(`${theme}-prose.png`);
    await page.screenshot({ path: screenshot, fullPage: true });
    await info.attach(`${theme}-prose.png`, {
      path: screenshot,
      contentType: "image/png",
    });
    await info.attach(`${theme}-prose-contrast.json`, {
      body: JSON.stringify(results, null, 2),
      contentType: "application/json",
    });
  });
}

test("wraps long code lines on request without widening the page", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/e2e/prose");
  const section = page.getByRole("region", { name: "Prose on background" });
  const block = section.locator("[data-slot=code-block]");
  const code = block.getByRole("region", { name: "Scrollable code" });
  await expect(block.getByText("python")).toBeVisible();
  expect(
    await code.evaluate((node) => node.scrollWidth > node.clientWidth + 20),
  ).toBe(true);

  const toggle = block.getByRole("button", { name: "Wrap long lines" });
  await toggle.focus();
  await page.keyboard.press("Enter");
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  expect(
    await code.evaluate((node) => node.scrollWidth <= node.clientWidth + 1),
  ).toBe(true);
  await expect(block.getByText("sort ascending")).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);

  await page.keyboard.press("Enter");
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  expect(
    await code.evaluate((node) => node.scrollWidth > node.clientWidth + 20),
  ).toBe(true);
});
