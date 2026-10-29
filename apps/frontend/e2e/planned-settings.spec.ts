import { expect, test } from "./support/test";

for (const viewport of [
  { width: 1280, height: 720 },
  { width: 320, height: 300 },
]) {
  test(`five planned panes retain badges, keyboard access and honest scope at ${viewport.width}px`, async ({
    page,
  }, info) => {
    await page.setViewportSize(viewport);
    const requests: string[] = [];
    await page.route("**/api/py/**", (route) => {
      requests.push(
        `${route.request().method()} ${new URL(route.request().url()).pathname}`,
      );
      // Captioning is traversed by the keyboard; its real error/retry handling is
      // covered separately. No placeholder endpoint is supplied here.
      return route.fulfill({
        status: 503,
        json: { detail: "Fixture unavailable" },
      });
    });
    await page.goto(
      "/e2e/planned-settings?keep=one&keep=two&setting=group-settings",
    );
    const tabs = page.getByRole("tablist").last();
    const horizontal = viewport.width < 640;
    await expect(tabs).toHaveAttribute(
      "aria-orientation",
      horizontal ? "horizontal" : "vertical",
    );
    await expect(tabs.getByText("Planned", { exact: true })).toHaveCount(5);
    for (const label of [
      "Providers",
      "Theme Editor",
      "Tools",
      "Image Captioning",
    ]) {
      const tab = tabs.getByRole("tab", { name: label, exact: true });
      await expect(tab).toBeEnabled();
      await expect(tab.getByText("Planned", { exact: true })).toHaveCount(0);
    }

    const verify = async (label: string, title: string) => {
      const tab = tabs.getByRole("tab", {
        name: `${label} Planned`,
        exact: true,
      });
      await expect(tab).toBeFocused();
      await expect(tab).toHaveAttribute("aria-selected", "true");
      const panel = page.getByRole("tabpanel").last();
      await expect(panel.getByText(title, { exact: true })).toBeVisible();
      await expect(
        panel.getByText(/planned for a future release/),
      ).toBeVisible();
      await expect(
        panel.locator("button, input, select, textarea, form, a"),
      ).toHaveCount(0);
      expect(
        await panel.evaluate(
          (node) => node.scrollWidth <= node.clientWidth + 1,
        ),
      ).toBe(true);
      await expect
        .poll(() => new URL(page.url()).searchParams.getAll("keep"))
        .toEqual(["one", "two"]);
      // Verify the entire selected trigger, including the badge, fits the
      // navigation scroller and can actually be hit.
      const geometry = await tab.evaluate((node) => {
        const r = node.getBoundingClientRect();
        const hit = document.elementFromPoint(
          r.x + r.width / 2,
          r.y + r.height / 2,
        );
        const textFits = Array.from(node.querySelectorAll("span")).every(
          (span) => {
            const bounds = span.getBoundingClientRect();
            return Array.from(span.childNodes)
              .filter((child) => child.nodeType === Node.TEXT_NODE)
              .every((child) => {
                const range = document.createRange();
                range.selectNodeContents(child);
                return Array.from(range.getClientRects()).every(
                  (text) =>
                    text.left >= bounds.left - 1 &&
                    text.right <= bounds.right + 1 &&
                    text.left >= r.left - 1 &&
                    text.right <= r.right + 1,
                );
              });
          },
        );
        return {
          x: r.x,
          right: r.right,
          y: r.y,
          bottom: r.bottom,
          width: node.clientWidth,
          scrollWidth: node.scrollWidth,
          // Scroll offsets round to CSS pixels while flex widths are fractional.
          inViewport:
            r.x >= -1 &&
            r.right <= innerWidth + 1 &&
            r.y >= -1 &&
            r.bottom <= innerHeight + 1,
          hittable: hit === node || node.contains(hit),
          // Tabs have an off-edge decorative pseudo-element. Check actual
          // labels, icons and badges rather than counting that decoration.
          textFits,
          contentFits: Array.from(node.querySelectorAll("span, svg")).every(
            (child) => {
              const c = child.getBoundingClientRect();
              return (
                c.left >= r.left - 1 &&
                c.right <= r.right + 1 &&
                c.top >= r.top - 1 &&
                c.bottom <= r.bottom + 1
              );
            },
          ),
        };
      });
      expect(geometry, JSON.stringify(geometry)).toMatchObject({
        inViewport: true,
        hittable: true,
        contentFits: true,
        textFits: true,
      });
      expect(requests.filter((request) => !request.startsWith("GET "))).toEqual(
        [],
      );
    };
    const group = tabs.getByRole("tab", {
      name: "Groups Planned",
      exact: true,
    });
    await group.focus();
    await verify("Groups", "Groups");
    expect(requests).toEqual([]);
    await page.keyboard.press(horizontal ? "ArrowRight" : "ArrowDown");
    await verify("Users", "Users");
    await expect(
      page.getByText(/Admin and user access checks are already enforced/),
    ).toBeVisible();
    expect(requests).toEqual([]);
    await page.keyboard.press("End");
    await verify("Export", "Export");
    await page.keyboard.press(horizontal ? "ArrowLeft" : "ArrowUp");
    await verify("Code Execution", "Code execution");
    await page.keyboard.press(horizontal ? "ArrowLeft" : "ArrowUp"); // available Captioning
    await expect(
      tabs.getByRole("tab", { name: "Image Captioning", exact: true }),
    ).toBeFocused();
    await page.keyboard.press(horizontal ? "ArrowLeft" : "ArrowUp");
    await verify("Image Generation", "Image generation");
    await page.screenshot({
      path: info.outputPath("planned-settings.png"),
      fullPage: true,
    });
    await page.keyboard.press("Home");
    const providers = tabs.getByRole("tab", { name: "Providers", exact: true });
    await expect(providers).toBeFocused();
    await expect(providers).toHaveAttribute("aria-selected", "true");
  });
}
