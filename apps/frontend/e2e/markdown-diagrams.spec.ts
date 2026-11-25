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
