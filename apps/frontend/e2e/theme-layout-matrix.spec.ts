import { expect, test, type Locator } from "./support/test";
import { writeFile } from "node:fs/promises";
import { measure } from "./support/contrast";
import { reviewViewports, themes } from "./support/theme-matrix";

async function reachable(control: Locator) {
  await control.scrollIntoViewIfNeeded();
  await control.focus();
  await expect(control).toBeFocused();
  return control.evaluate((el) => {
    const rect = el.getBoundingClientRect();
    const hit = document.elementFromPoint(
      rect.x + rect.width / 2,
      rect.y + rect.height / 2,
    );
    let clipped = false;
    for (let parent = el.parentElement; parent; parent = parent.parentElement) {
      const style = getComputedStyle(parent);
      const bounds = parent.getBoundingClientRect();
      const x = bounds.left + parent.clientLeft;
      const y = bounds.top + parent.clientTop;
      if (
        /(auto|scroll|hidden|clip)/.test(style.overflowX) &&
        (rect.left < x || rect.right > x + parent.clientWidth)
      )
        clipped = true;
      if (
        /(auto|scroll|hidden|clip)/.test(style.overflowY) &&
        (rect.top < y || rect.bottom > y + parent.clientHeight)
      )
        clipped = true;
    }
    return {
      clipped,
      left: rect.left,
      right: rect.right,
      top: rect.top,
      bottom: rect.bottom,
      viewportWidth: innerWidth,
      viewportHeight: innerHeight,
      hit: hit === el || el.contains(hit),
      keyboard: el.matches(":focus-visible"),
      shadow: getComputedStyle(el).boxShadow,
    };
  });
}

for (const theme of themes)
  for (const viewport of reviewViewports) {
    test(`${theme}: ${viewport.name} ${viewport.width}x${viewport.height}, pane ${viewport.pane}, text ${viewport.fontSize}px`, async ({
      page,
      context,
    }, info) => {
      const errors: string[] = [];
      const untrustedRequests: string[] = [];
      const evidence: Record<string, unknown> = {
        theme,
        viewport,
        controls: [],
      };
      page.on("pageerror", (error) => errors.push(error.message));
      await page.route(/untrusted-markdown/, (route) => {
        untrustedRequests.push(route.request().url());
        return route.abort();
      });
      await context.addCookies([
        {
          name: "asterism-custom-theme-name",
          value: theme,
          url: "http://localhost:3100",
        },
      ]);
      await page.setViewportSize(viewport);
      await page.emulateMedia({
        reducedMotion: viewport.reducedMotion ? "reduce" : "no-preference",
      });
      await page.route("**/api/py/chat/models", (route) =>
        route.fulfill({
          json: [
            {
              id: "contrast-model",
              name: "Matrix model",
              provider_id: "matrix",
              provider_name: "Synthetic",
              available: true,
            },
          ],
        }),
      );
      try {
        await page.goto(`/e2e/theme-contrast?pane=${viewport.pane}`);
        await expect(
          page.getByRole("heading", { name: `Palette review: ${theme}` }),
        ).toBeVisible();
        await expect(
          page.getByRole("combobox", { name: "Chat model", exact: true }),
        ).toHaveText("Matrix model (Synthetic)");
        await page.evaluate((size) => {
          document.documentElement.style.fontSize = `${size}px`;
        }, viewport.fontSize);
        await page.evaluate(() => document.fonts.ready);
        const root = page.getByTestId("palette-review");
        const overflow = await root.evaluate((el) => ({
          client: el.clientWidth,
          scroll: el.scrollWidth,
          document: document.documentElement.scrollWidth,
          viewport: innerWidth,
        }));
        evidence.overflow = overflow;
        expect(
          overflow.scroll,
          `${theme}/${viewport.name}: review pane overflow`,
        ).toBeLessThanOrEqual(overflow.client + 1);
        expect(overflow.document).toBeLessThanOrEqual(overflow.viewport);
        const panelBounds = await page
          .locator('[data-slot="card"], [data-slot="card-content"]')
          .evaluateAll((nodes) =>
            nodes.map((el) => ({
              slot: el.getAttribute("data-slot"),
              width: el.clientWidth,
              scroll: el.scrollWidth,
              left: el.scrollLeft,
            })),
          );
        evidence.overflowingElements = await page
          .locator('[data-slot="card"] *')
          .evaluateAll((nodes) =>
            nodes
              .filter(
                (el) =>
                  el.clientWidth > 0 &&
                  el.scrollWidth > el.clientWidth + 1 &&
                  !el.closest('[aria-label="Review rich content"]'),
              )
              .map((el) => ({
                slot: el.getAttribute("data-slot"),
                tag: el.tagName,
                text: el.textContent?.slice(0, 80),
                width: el.clientWidth,
                scroll: el.scrollWidth,
                classes: el.className,
              }))
              .slice(0, 20),
          );
        evidence.panels = panelBounds;
        for (const panel of panelBounds)
          expect(
            panel.scroll,
            `${theme}/${viewport.name}: ${panel.slot} has hidden horizontal overflow`,
          ).toBeLessThanOrEqual(panel.width + 1);
        const observations: Array<
          { name: string } & Awaited<ReturnType<typeof reachable>>
        > = [];
        evidence.controls = observations;
        for (const name of [
          "Project name",
          "Notes",
          "Model",
          "Theme",
          "Text size",
          "Include attachments",
          "Enable tools",
        ]) {
          const labelled = page.getByLabel(name, { exact: true });
          // The theme gallery is a radio group; its tab stop is the checked tile.
          const control =
            name === "Theme"
              ? labelled.getByRole("radio", { checked: true })
              : labelled;
          await page.keyboard.press("Tab");
          const geometry = await reachable(control);
          observations.push({ name, ...geometry });
          expect(geometry.hit, `${name}: clipped or covered`).toBe(true);
          expect(geometry.clipped, `${name}: clipped by an ancestor`).toBe(
            false,
          );
          expect(geometry.left).toBeGreaterThanOrEqual(0);
          expect(geometry.right).toBeLessThanOrEqual(geometry.viewportWidth);
          expect(geometry.top).toBeGreaterThanOrEqual(0);
          expect(geometry.bottom).toBeLessThanOrEqual(geometry.viewportHeight);
          expect(geometry.keyboard, `${name}: missing keyboard focus`).toBe(
            true,
          );
          expect(geometry.shadow, `${name}: missing focus indicator`).not.toBe(
            "none",
          );
        }
        evidence.controls = observations;
        const model = page.getByRole("combobox", {
          name: "Model",
          exact: true,
        });
        await model.scrollIntoViewIfNeeded();
        await model.focus();
        await page.keyboard.press("Enter");
        const option = page.getByRole("option", {
          name: "Review model",
          exact: true,
        });
        await expect(option).toBeInViewport({ ratio: 1 });
        await expect(option).toBeFocused();
        await page.keyboard.press("Enter");
        await expect(model).toHaveText("Review model");
        await expect(model).toBeFocused();
        const advanced = page.getByRole("tab", {
          name: "Advanced",
          exact: true,
        });
        const tabGeometry = await reachable(advanced);
        evidence.lastTab = tabGeometry;
        expect(tabGeometry.hit).toBe(true);
        expect(tabGeometry.clipped).toBe(false);
        await page.keyboard.press("Enter");
        await expect(advanced).toHaveAttribute("aria-selected", "true");
        const region = page.getByRole("region", {
          name: "Review rich content",
          exact: true,
        });
        await region.scrollIntoViewIfNeeded();
        await region.focus();
        await expect(region).toBeFocused();
        const code = region.getByRole("region", { name: "Scrollable code" });
        await code.scrollIntoViewIfNeeded();
        expect(
          await code
            .locator("code")
            .evaluate((el) => getComputedStyle(el).fontFamily),
        ).toMatch(/JetBrains/);
        expect(
          await page
            .getByRole("heading", { name: "ASTERISM" })
            .evaluate((el) => getComputedStyle(el).fontFamily),
        ).toMatch(/Schibsted/);
        await page.keyboard.press("Tab");
        const save = page.locator('[data-contrast="primary"]');
        await reachable(save);
        // Reuse the compositing probe for a normal-size action and its keyboard ring.
        const text = await measure(page, "primary");
        const ring = await measure(page, "primary", "ring");
        evidence.contrast = { text, ring };
        expect(text.ratio, `${theme}: primary text`).toBeGreaterThanOrEqual(
          4.5,
        );
        expect(
          ring.ratio,
          `${theme}: primary focus ring`,
        ).toBeGreaterThanOrEqual(3);
        if (viewport.reducedMotion) {
          const animation = await page
            .locator('[class*="animate-"]')
            .evaluateAll((nodes) =>
              nodes.map((el) => getComputedStyle(el).animationName),
            );
          evidence.animation = animation;
          expect(animation.length).toBeGreaterThan(0);
          expect(animation.every((name) => name === "none")).toBe(true);
        }
        expect(
          await region
            .locator(
              'script,iframe,img,form,style,link,input:not([type="checkbox"][disabled]),video',
            )
            .count(),
        ).toBe(0);
        expect(untrustedRequests).toEqual([]);
        expect(errors).toEqual([]);
      } finally {
        evidence.errors = errors;
        evidence.untrustedRequests = untrustedRequests;
        const path = info.outputPath("matrix-evidence.json");
        await writeFile(path, JSON.stringify(evidence, null, 2) + "\n");
        await info.attach("theme-layout-evidence", {
          path,
          contentType: "application/json",
        });
        await page.screenshot({ path: info.outputPath("matrix.png") });
      }
    });
  }
