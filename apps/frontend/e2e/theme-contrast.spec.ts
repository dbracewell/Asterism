import { expect, test } from "@playwright/test";
import { writeFile } from "node:fs/promises";

import { themes } from "./support/theme-matrix";
import { measure } from "./support/contrast";
import { contrastRatio, themeTextPairs } from "../src/features/theme/contrast";

for (const theme of themes) {
  test(`${theme}: paired roles and rendered controls`, async ({
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
    await page.setViewportSize({ width: 1100, height: 1100 });
    await page.route("**/api/py/chat/models", (route) =>
      route.fulfill({
        json: [
          {
            id: "contrast-model",
            name: "Palette chat model",
            provider_id: "contrast-provider",
            provider_name: "Synthetic provider",
            available: true,
            supports_tools: true,
            supports_vision: true,
          },
          {
            id: "contrast-alternative",
            name: "Alternative chat model",
            provider_id: "contrast-provider",
            provider_name: "Synthetic provider",
            available: true,
          },
        ],
      }),
    );
    await page.goto("/e2e/theme-contrast");
    await expect(
      page.getByRole("heading", { name: `Palette review: ${theme}` }),
    ).toBeVisible();
    const response = await page.request.get(`/api/theme?name=${theme}`);
    expect(response.ok()).toBe(true);
    const palette = await response.json();
    const chatSelect = page.getByRole("combobox", {
      name: "Chat model",
      exact: true,
    });
    await expect(chatSelect).toHaveText(
      "Palette chat model (Synthetic provider)",
    );
    await chatSelect.evaluate((el) =>
      el.setAttribute("data-contrast", "chat-select"),
    );
    for (const [testId, id] of [
      ["appearance-theme", "appearance-theme"],
      ["appearance-size", "appearance-size"],
    ]) {
      await page
        .getByTestId(testId)
        .getByRole("combobox")
        .evaluate((el, id) => el.setAttribute("data-contrast", id), id);
    }
    await page
      .locator("#review-settings-model")
      .evaluate((el) => el.setAttribute("data-contrast", "settings-model"));
    await page
      .getByTestId("composer")
      .locator(":scope > div")
      .evaluate((el) => el.setAttribute("data-contrast", "composer-container"));
    await page
      .getByTestId("composer")
      .locator("form")
      .evaluate((el) => el.setAttribute("data-contrast", "composer"));
    await page
      .getByRole("textbox", { name: "Message", exact: true })
      .evaluate((el) => el.setAttribute("data-contrast", "composer-input"));
    const results: {
      state: string;
      threshold: number;
      ratio: number;
      [key: string]: unknown;
    }[] = [];
    async function check(
      id: string,
      state = "rest",
      kind:
        | "text"
        | "placeholder"
        | "border"
        | "ring"
        | "fill"
        | "glyph" = "text",
    ) {
      const result = await measure(page, id, kind);
      const threshold =
        kind === "border" ||
        kind === "ring" ||
        kind === "fill" ||
        kind === "glyph"
          ? 3
          : 4.5;
      results.push({ id, state, threshold, ...result });
    }
    // Same ten paired roles as the original audit, measured without rounding.
    const opaque = themeTextPairs.map(([fg, bg]) => ({
      id: `${fg}/${bg}`,
      ratio: contrastRatio(palette.colors[fg], palette.colors[bg]),
      threshold: 4.5,
      state: "opaque pair",
    }));
    results.push(...opaque);
    for (const id of [
      "primary",
      "secondary",
      "outline",
      "destructive",
      "link",
      "card-muted",
      "muted",
      "error",
      "popover",
      "sidebar-primary",
      "sidebar-label",
      "sidebar-selected",
      "tab-selected",
      "tab-inactive",
      "badge-link",
      "select",
      "destructive-muted",
      "badge-primary",
      "badge-secondary",
      "badge-destructive",
      "badge-outline",
      "badge-link",
      "appearance-theme",
      "appearance-size",
      "settings-model",
      "composer",
      "composer-input",
      "chat-select",
    ])
      await check(id);
    for (const id of ["input", "textarea", "group-control", "composer-input"])
      await check(id, "rest", "placeholder");
    for (const id of [
      "input",
      "textarea",
      "select",
      "input-group",
      "outline",
      "appearance-theme",
      "appearance-size",
      "composer-container",
    ])
      await check(id, "rest", "border");
    for (const id of [
      "primary",
      "secondary",
      "outline",
      "destructive",
      "destructive-muted",
      "sidebar-hover",
      "tab-selected",
      "tab-inactive",
      "badge-link",
      "select",
    ]) {
      await page.locator(`[data-contrast="${id}"]`).hover();
      // Let production transitions finish before recording computed styles.
      await page.waitForTimeout(250);
      await check(id, "hover");
    }
    await page.locator('[data-contrast="settings-model"]').click();
    const menuId = await page
      .locator('[data-contrast="settings-model"]')
      .getAttribute("aria-controls");
    const menu = page.locator(`[id="${menuId}"]`);
    await menu
      .getByRole("button", { name: /Palette model/ })
      .evaluate((el) => el.setAttribute("data-contrast", "settings-option"));
    await menu
      .getByRole("textbox", { name: "Filter models" })
      .evaluate((el) => el.setAttribute("data-contrast", "settings-filter"));
    await check("settings-option", "selected");
    await check("settings-filter", "rest", "placeholder");
    await page.locator('[data-contrast="settings-option"]').hover();
    await page.waitForTimeout(250);
    await check("settings-option", "hover");
    await page.keyboard.press("Tab");
    await page.locator('[data-contrast="settings-filter"]').focus();
    await page.waitForTimeout(250);
    await check("settings-filter", "keyboard focus", "ring");
    await page.locator('[data-contrast="settings-model"]').click();
    await page
      .locator('[data-contrast="composer-input"]')
      .fill("Palette draft");
    await chatSelect.hover();
    await page.waitForTimeout(250);
    await check("chat-select", "hover in primary panel");
    await chatSelect.click();
    const alternative = page.getByRole("option", {
      name: "Alternative chat model (Synthetic provider)",
      exact: true,
    });
    await alternative.hover();
    await alternative.evaluate((el) =>
      el.setAttribute("data-contrast", "chat-option"),
    );
    await page.waitForTimeout(250);
    await check("chat-option", "highlighted option");
    await alternative.click();
    await expect(chatSelect).toHaveText(
      "Alternative chat model (Synthetic provider)",
    );
    await page.mouse.move(0, 0);
    await page.waitForTimeout(250);
    await check("chat-select", "changed selection in primary panel");
    for (const id of [
      "input",
      "textarea",
      "group-control",
      "select",
      "primary",
      "outline",
      "destructive",
      "checkbox",
      "switch",
      "tab-selected",
      "badge-link",
      "appearance-theme",
      "appearance-size",
      "composer-input",
      "sidebar-selected",
    ]) {
      await page.keyboard.press("Tab");
      await page.locator(`[data-contrast="${id}"]`).focus();
      await expect(page.locator(`[data-contrast="${id}"]`)).toBeFocused();
      await page.waitForTimeout(250);
      expect(
        await page
          .locator(`[data-contrast="${id}"]`)
          .evaluate((el) => el.matches(":focus-visible")),
      ).toBe(true);
      const ringId =
        id === "group-control"
          ? "input-group"
          : id === "composer-input"
            ? "composer-container"
            : id;
      await check(ringId, "keyboard focus", "ring");
      expect(results.at(-1)?.shadow).not.toBe("none");
    }
    // Capture normal input boundaries and the settled, verified keyboard focus.
    const screenshot = info.outputPath(`${theme}.png`);
    await page.screenshot({ path: screenshot, fullPage: true });
    await check("checkbox", "checked mark", "glyph");
    for (const state of ["checked", "unchecked"]) {
      await check("switch", state, "fill");
      await check("switch-thumb", state, "fill");
      await page.locator('[data-contrast="switch"]').click();
      await page.waitForTimeout(250);
    }
    await page.locator('[data-contrast="checkbox"]').click();
    await check("checkbox", "unchecked", "border");
    await page.locator('[data-contrast="checkbox"]').click();
    for (const id of ["input", "textarea", "select"]) {
      await page
        .locator(`[data-contrast="${id}"]`)
        .evaluate((el) => el.setAttribute("aria-invalid", "true"));
      await check(id, "invalid", "border");
    }
    await page.locator('[data-contrast="select"]').click();
    await page.getByRole("option", { name: "Review model" }).focus();
    await check("select-option", "option focused");
    await page.keyboard.press("Enter");
    await expect(page.locator('[data-contrast="select"]')).toHaveText(
      "Review model",
    );
    await check("select", "selected");
    const report = info.outputPath(`${theme}.json`);
    await writeFile(
      report,
      JSON.stringify(
        {
          theme,
          palette,
          method:
            "WCAG sRGB luminance, actual browser computed colors with ancestor alpha compositing; text 4.5:1, control boundaries/focus 3:1. Scoped review, not full application conformance.",
          results,
        },
        null,
        2,
      ) + "\n",
    );
    await info.attach("contrast-evidence", {
      path: report,
      contentType: "application/json",
    });
    await info.attach("palette-review", {
      path: screenshot,
      contentType: "image/png",
    });
    const failures = results.filter(
      (result) => result.ratio < result.threshold,
    );
    expect(failures, JSON.stringify(failures, null, 2)).toEqual([]);
  });
}
