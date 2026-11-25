import AxeBuilder from "@axe-core/playwright";
import { readFile } from "node:fs/promises";
import { expect, test } from "./support/test";

// ADR-0081: mermaid blocks draw under the real page policy (the fixture fails
// on any CSP refusal), and untrusted diagram source can't escape the image.
test("mermaid blocks draw as images; broken and hostile ones stay inert", async ({
  page,
}) => {
  const untrusted: string[] = [];
  await page.route(/\/untrusted-markdown\//, (route) => {
    untrusted.push(route.request().url());
    return route.fulfill({ status: 200, body: "" });
  });
  await page.goto("/e2e/markdown");
  const diagrams = page
    .getByRole("region", { name: "Diagrams" })
    .or(page.locator('section[aria-label="Diagrams"]'));

  const water = diagrams.getByRole("img", { name: "Water cycle" });
  await expect(water).toBeVisible();
  // A malformed SVG would load as a broken image with no natural size.
  await expect
    .poll(() => water.evaluate((img: HTMLImageElement) => img.naturalWidth))
    .toBeGreaterThan(0);
  await expect(water).toHaveAttribute("src", /^data:image\/svg\+xml/);

  await expect(
    diagrams.getByText("Couldn't draw this diagram").first(),
  ).toBeVisible();
  await expect(
    diagrams.locator("pre", { hasText: "this is not a diagram" }),
  ).toBeVisible();

  // Hostile source: directives are ignored, HTML-looking labels are text and
  // click lines do nothing, so those three still draw; a style with a URL is
  // refused and shows as code. Nothing runs, restyles the page or loads.
  const blocks = diagrams.locator(
    '[data-slot="diagram-block"], [data-slot="code-block"]',
  );
  await expect(blocks).toHaveCount(6);
  expect(
    await blocks.evaluateAll((els) =>
      els.map((el) => el.getAttribute("data-slot")),
    ),
  ).toEqual([
    "diagram-block",
    "code-block",
    "diagram-block",
    "diagram-block",
    "diagram-block",
    "code-block",
  ]);
  expect(await page.evaluate(() => "__diagramPwned" in window)).toBe(false);
  expect(
    await page.evaluate(() => getComputedStyle(document.body).display),
  ).not.toBe("none");
  await expect(
    diagrams.locator("foreignObject, a[href^='javascript']"),
  ).toHaveCount(0);
  const contents = await diagrams.locator("figure img").evaluateAll((imgs) =>
    imgs.map((img) => {
      const src = decodeURIComponent((img as HTMLImageElement).src);
      const svg = new DOMParser().parseFromString(
        src.slice(src.indexOf(",") + 1),
        "image/svg+xml",
      );
      return {
        parsed: svg.documentElement.localName,
        active: svg.querySelectorAll(
          "script, foreignObject, image, img, a, use, iframe",
        ).length,
        outside: [...svg.querySelectorAll("*")].flatMap((el) =>
          [...el.attributes]
            .filter(
              (a) => /href$|^on/i.test(a.name) && !a.value.startsWith("#"),
            )
            .map((a) => a.name),
        ),
      };
    }),
  );
  expect(contents).toHaveLength(4);
  for (const svg of contents)
    expect(svg).toEqual({ parsed: "svg", active: 0, outside: [] });
  expect(untrusted).toEqual([]);
});

test("the diagram toolbar switches views, expands and downloads SVG and PNG", async ({
  page,
}) => {
  await page.goto("/e2e/markdown");
  const diagrams = page.locator('section[aria-label="Diagrams"]');
  const figure = diagrams.locator('[data-slot="diagram-block"]').first();
  const water = figure.getByRole("img", { name: "Water cycle" });
  await expect(water).toBeVisible();

  // Code view and back, with focus kept on the toggle.
  await figure.getByRole("button", { name: "Show code" }).click();
  const code = diagrams.locator('[data-slot="code-block"]').first();
  await expect(code).toContainText("accTitle: Water cycle");
  await expect(
    code.getByRole("button", { name: "Show diagram" }),
  ).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(water).toBeVisible();
  await expect(figure.getByRole("button", { name: "Show code" })).toBeFocused();

  // Full size in a dialog, named and described by the diagram.
  await figure.getByRole("button", { name: "Expand diagram" }).click();
  const dialog = page.getByRole("dialog", { name: "Water cycle" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("Water evaporates");
  await expect(dialog.getByRole("img", { name: "Water cycle" })).toBeVisible();
  const axe = await new AxeBuilder({ page })
    .include('[role="dialog"]')
    .analyze();
  expect(axe.violations).toEqual([]);
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();

  const save = async (format: "SVG" | "PNG") => {
    await figure.getByRole("button", { name: "Download diagram" }).click();
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("menuitem", { name: `${format} image` }).click(),
    ]);
    const path = await download.path();
    return { name: download.suggestedFilename(), bytes: await readFile(path) };
  };

  const svg = await save("SVG");
  expect(svg.name).toBe("water-cycle.svg");
  const markup = svg.bytes.toString("utf8");
  expect(markup).toMatch(/^<svg[^>]+xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
  expect(markup).toMatch(/<title[^>]*>Water cycle<\/title>/);
  expect(markup).not.toMatch(/<script|foreignObject/);

  const png = await save("PNG");
  expect(png.name).toBe("water-cycle.png");
  expect(png.bytes.subarray(1, 4).toString("ascii")).toBe("PNG");
  // IHDR width and height: twice the diagram's own size.
  const natural = await water.evaluate((img: HTMLImageElement) => [
    img.naturalWidth,
    img.naturalHeight,
  ]);
  expect([png.bytes.readUInt32BE(16), png.bytes.readUInt32BE(20)]).toEqual(
    natural.map((side) => side * 2),
  );

  // Every code block on a page is a region named "Scrollable code" (since
  // before diagrams), so region names repeat; diagram regions carry the
  // diagram's own name.
  const toolbar = await new AxeBuilder({ page })
    .include('section[aria-label="Diagrams"]')
    .disableRules(["landmark-unique"])
    .analyze();
  expect(toolbar.violations).toEqual([]);
});

test("a wide diagram scrolls inside its block at 320px", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto("/e2e/markdown");
  const figure = page
    .locator('section[aria-label="Diagrams"] [data-slot="diagram-block"]')
    .first();
  await expect(figure.getByRole("img", { name: "Water cycle" })).toBeVisible();
  const region = figure.getByRole("region", {
    name: "Scrollable diagram: Water cycle",
  });
  const sizes = await region.evaluate((el) => ({
    scroll: el.scrollWidth,
    client: el.clientWidth,
    figure: el.closest("figure")!.getBoundingClientRect().right,
  }));
  expect(sizes.scroll).toBeGreaterThan(sizes.client);
  expect(sizes.figure).toBeLessThanOrEqual(320);
  await region.focus();
  await page.keyboard.press("ArrowRight");
  await expect
    .poll(() => region.evaluate((el) => el.scrollLeft))
    .toBeGreaterThan(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});

test("a diagram slightly wider than the column shrinks to fit instead of scrolling", async ({
  page,
}) => {
  await page.setViewportSize({ width: 600, height: 800 });
  await page.goto("/e2e/markdown");
  const figure = page
    .locator('section[aria-label="Diagrams"] [data-slot="diagram-block"]')
    .first();
  const image = figure.getByRole("img", { name: "Water cycle" });
  await expect(image).toBeVisible();
  const region = figure.getByRole("region", {
    name: "Scrollable diagram: Water cycle",
  });
  const sizes = await region.evaluate((el) => {
    const img = el.querySelector("img")!;
    return {
      scroll: el.scrollWidth,
      client: el.clientWidth,
      shown: img.getBoundingClientRect().width,
      natural: img.naturalWidth,
    };
  });
  expect(sizes.shown).toBeLessThan(sizes.natural);
  expect(sizes.shown).toBeGreaterThanOrEqual(sizes.natural * 0.75 - 1);
  expect(sizes.scroll).toBeLessThanOrEqual(sizes.client);
});
