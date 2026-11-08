import { expect, test } from "./support/test";

// US-74.1: headings hug their content, lists sit close to their lead-in, and
// loose lists are as compact as tight ones.
test("Markdown spacing stays compact", async ({ page }, info) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/e2e/prose");
  const section = page.getByRole("region", { name: "Compact prose" });
  await expect(section.getByRole("heading", { name: "Science" })).toBeVisible();

  const gaps = await section.locator(".prose").evaluate((root) => {
    const box = (selector: string, index = 0) =>
      root.querySelectorAll(selector)[index]!.getBoundingClientRect();
    const gap = (above: DOMRect, below: DOMRect) => below.top - above.bottom;
    const lists = root.querySelectorAll(":scope > ul");
    const items = (list: Element) =>
      [...list.querySelectorAll(":scope > li")].map((li) =>
        li.getBoundingClientRect(),
      );
    const loose = items(lists[0]!);
    const tight = items(lists[1]!);
    return {
      techAbove: gap(box(":scope > ul", 0), box("h3", 0)),
      techBelow: gap(box("h3", 0), box(":scope > p", 1)),
      listAfterParagraph: gap(
        box(":scope > p", 0),
        lists[0]!.getBoundingClientRect(),
      ),
      looseItem: gap(loose[0]!, loose[1]!),
      tightItem: gap(tight[0]!, tight[1]!),
      nestedMargin: Number.parseFloat(
        getComputedStyle(root.querySelector("li > ul")!).marginTop,
      ),
      margins: Object.fromEntries(
        ["h2", "h3", ":scope > p"].map((selector) => {
          const style = getComputedStyle(root.querySelector(selector)!);
          return [selector, [style.marginTop, style.marginBottom]];
        }),
      ),
      looseParagraphMargin: Number.parseFloat(
        getComputedStyle(root.querySelector("li > p")!).marginTop,
      ),
    };
  });

  await info.attach("prose-spacing.json", {
    body: JSON.stringify(gaps, null, 2),
    contentType: "application/json",
  });

  expect(gaps.techAbove).toBeGreaterThan(gaps.techBelow * 2);
  expect(gaps.margins).toEqual({
    h2: ["0px", "12px"],
    h3: ["24px", "8px"],
    ":scope > p": ["0px", "8px"],
  });
  // Rendered gaps include half-leading on each side of the margin.
  expect(gaps.techBelow).toBeLessThanOrEqual(14);
  expect(gaps.listAfterParagraph).toBeLessThanOrEqual(12);
  expect(gaps.looseParagraphMargin).toBe(0);
  expect(Math.abs(gaps.looseItem - gaps.tightItem)).toBeLessThanOrEqual(1);
  expect(gaps.looseItem).toBeLessThanOrEqual(6);
  expect(gaps.nestedMargin).toBeLessThanOrEqual(4);

  const screenshot = info.outputPath("compact-prose.png");
  await section.screenshot({ path: screenshot });
  await info.attach("compact-prose.png", {
    path: screenshot,
    contentType: "image/png",
  });
});
