import { expect, test, type Locator } from "./support/test";

async function target(control: Locator) {
  await control.scrollIntoViewIfNeeded();
  const box = await control.boundingBox();
  expect(box!.width).toBeGreaterThanOrEqual(24);
  expect(box!.height).toBeGreaterThanOrEqual(24);
  expect(
    await control.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const hit = document.elementFromPoint(
        r.x + r.width / 2,
        r.y + r.height / 2,
      );
      return hit === el || el.contains(hit);
    }),
  ).toBe(true);
}

for (const theme of [
  "atlas",
  "night-atlas",
  "dracula",
  "one_dark",
  "catppuccin-latte-mauve",
]) {
  test(`${theme}: inherited fonts, semantic image states and motion`, async ({
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
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("**/api/py/files/info/*", async (route) => {
      const url = route.request().url();
      if (url.includes("loading")) return; // Keep the query pending until this isolated page closes.
      if (url.includes("error"))
        return route.fulfill({
          status: 404,
          json: { detail: "Missing image" },
        });
      return route.fulfill({
        json: {
          filename: "fixture.png",
          thumbnail: url.includes("missing")
            ? null
            : "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a3ioAAAAASUVORK5CYII=",
        },
      });
    });
    await page.goto("/e2e/semantic-ui");
    await page.evaluate(() => document.fonts.ready);
    const logo = page.getByRole("heading", { name: "ASTERISM" });
    expect(
      await logo.evaluate((el) => getComputedStyle(el).fontFamily),
    ).toMatch(/Schibsted/);
    const fonts = await page
      .locator("pre, pre code, pre code span")
      .evaluateAll((nodes) =>
        nodes.map((el) => getComputedStyle(el).fontFamily),
      );
    expect(fonts.length).toBeGreaterThan(2);
    for (const font of fonts) expect(font).toMatch(/JetBrains/);
    expect(
      await page
        .locator("code")
        .first()
        .evaluate((el) => getComputedStyle(el).fontFamily),
    ).toMatch(/JetBrains/);
    await expect(
      page.getByRole("alert").filter({ hasText: "Failed to load image" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Enlarge Test diagram" }),
    ).toBeVisible();
    const failure = page
      .getByRole("alert")
      .filter({ hasText: "No thumbnail" })
      .first();
    await expect(failure).toBeVisible();
    expect(await failure.evaluate((el) => getComputedStyle(el).color)).toBe(
      await page.evaluate(() => {
        const el = document.createElement("span");
        el.style.color = "var(--destructive)";
        document.body.append(el);
        const color = getComputedStyle(el).color;
        el.remove();
        return color;
      }),
    );
    await expect(
      page.getByRole("status", { name: "Loading image" }),
    ).toBeVisible();
    await page.emulateMedia({ reducedMotion: "reduce" });
    const animationNames = await page
      .locator('[class*="animate-"]')
      .evaluateAll((nodes) =>
        nodes.map((el) => getComputedStyle(el).animationName),
      );
    expect(animationNames.length).toBeGreaterThan(0);
    expect(animationNames.every((name) => name === "none")).toBe(true);
    const zoom = page.getByRole("button", { name: "Enlarge Test diagram" });
    await zoom.focus();
    await page.keyboard.press("Enter");
    await expect(
      page.getByRole("dialog", { name: "Test diagram" }),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(zoom).toBeFocused();
    await page.screenshot({
      path: info.outputPath(`${theme}.png`),
      fullPage: true,
    });
    expect(errors).toEqual([]);
  });
}

for (const width of [320, 1280]) {
  test(`named settings and keyboard-visible sidebar actions at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 800 });
    await page.route("**/api/py/settings/user/*", (route) =>
      route.fulfill({ json: { key: "show_thinking", value: true } }),
    );
    await page.goto("/e2e/responsiveness?setting=general");
    const gallery = page.getByRole("radiogroup", {
      name: "Theme",
      exact: true,
    });
    const size = page.getByRole("combobox", { name: "Font Size" });
    await expect(gallery).toBeVisible();
    await expect(size).toBeVisible();
    await expect(
      page.getByRole("combobox", { name: "Default Model", exact: true }),
    ).toBeVisible();
    // One tab stop; arrow keys move focus and selection between tiles.
    const first = gallery.getByRole("radio").first();
    await first.focus();
    // Radix checks the radio that receives focus while the arrow is held.
    await page.keyboard.down("ArrowRight");
    const second = gallery.getByRole("radio").nth(1);
    await expect(second).toBeFocused();
    await expect(second).toBeChecked();
    await page.keyboard.up("ArrowRight");
    expect(
      await second.evaluate(
        (el) =>
          el.matches(":focus-visible") &&
          getComputedStyle(el).boxShadow !== "none",
      ),
    ).toBe(true);
    await expect(
      gallery.getByRole("link", { name: /^Edit .* theme$/ }),
    ).toHaveCount(1);
    await expect(
      page.getByRole("checkbox", { name: "Show Thinking" }),
    ).toBeEnabled();
    await page.goto("/e2e/responsiveness?setting=themes");
    const duplicate = page.getByRole("button", { name: /^Duplicate / }).first();
    await target(duplicate);
    await duplicate.focus();
    await page.keyboard.press("Enter");
    await expect(
      page.getByRole("textbox", { name: "Name", exact: true }),
    ).toHaveValue(/ Copy$/);
    const color = page.getByRole("button", { name: "Edit Border color" });
    await color.scrollIntoViewIfNeeded();
    await color.focus();
    await page.keyboard.press("Enter");
    const hex = page.getByRole("textbox", { name: "Border hex color" });
    await expect(hex).toBeVisible();
    await page.keyboard.press("Tab");
    await hex.focus();
    expect(
      await hex.evaluate(
        (el) =>
          el.matches(":focus-visible") &&
          getComputedStyle(el).boxShadow !== "none",
      ),
    ).toBe(true);
    await page.keyboard.press("Escape");
    await expect(color).toBeFocused();
    await page.route("**/api/py/files/info/*", (route) =>
      route.fulfill({ json: { filename: "fixture.png" } }),
    );
    await page.goto("/e2e/semantic-ui");
    const copy = page.getByRole("button", { name: "Copy", exact: true });
    await target(copy);
    const add = page.getByRole("button", { name: "Add to Projects" });
    await add.focus();
    expect(
      await add.evaluate((el) => {
        let node: Element | null = el;
        while (node) {
          if (Number(getComputedStyle(node).opacity) === 0) return false;
          node = node.parentElement;
        }
        return true;
      }),
    ).toBe(true);
    await target(add);
    await page.evaluate(() => {
      document.documentElement.style.fontSize = "12px";
    });
    await target(copy);
    await target(add);
  });
}
