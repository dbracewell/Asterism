import { expect, test, type Locator } from "@playwright/test";

// Hit testing catches controls clipped by ancestors even when the document fits.
async function reachable(control: Locator) {
  await expect(control).toBeEnabled();
  await control.scrollIntoViewIfNeeded();
  await control.focus();
  await expect(control).toBeFocused();
  await expect
    .poll(() =>
      control.evaluate((node) => {
        const rect = node.getBoundingClientRect();
        const hit = document.elementFromPoint(
          rect.x + rect.width / 2,
          rect.y + rect.height / 2,
        );
        return (
          rect.width > 0 &&
          rect.x >= 0 &&
          rect.right <= innerWidth &&
          rect.y >= 0 &&
          rect.bottom <= innerHeight &&
          (hit === node || node.contains(hit))
        );
      }),
    )
    .toBe(true);
}

for (const { width, height, pane } of [
  { width: 320, height: 300, pane: 320 },
  { width: 390, height: 800, pane: 390 },
  { width: 768, height: 300, pane: 768 },
  { width: 1440, height: 900, pane: 1440 },
  { width: 1440, height: 300, pane: 640 },
  { width: 1440, height: 600, pane: 240 },
]) {
  test(`settings and dialogs remain reachable at ${width}x${height} in a ${pane}px pane`, async ({
    page,
  }, info) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.setViewportSize({ width, height });
    await page.route("**/api/py/tools/active", (route) =>
      route.fulfill({ json: { items: [] } }),
    );
    await page.route(/\/api\/py\/files\/(?:\?.*)?$/, (route) =>
      route.fulfill({
        json: {
          files: [
            {
              id: "picker-file",
              filename: "picker.txt",
              original_name: "picker.txt",
              kind: "document",
              size: 12,
              projects: [],
            },
          ],
          total: 1,
          page: 1,
          page_size: 50,
        },
      }),
    );
    await page.goto(
      `/e2e/responsiveness?pane=${pane}&keep=one&keep=two&setting=themes`,
    );
    const tabs = page.getByRole("tablist");
    await expect(tabs).toHaveAttribute(
      "aria-orientation",
      pane < 656 ? "horizontal" : "vertical",
    );
    const create = page.getByRole("button", { name: "New theme", exact: true });
    await reachable(create);
    await create.click();
    const name = page.getByRole("textbox", { name: "Name", exact: true });
    await reachable(name);
    await name.fill("Responsive draft");
    await page.screenshot({ path: info.outputPath("theme-editor.png") });
    await reachable(page.getByRole("button", { name: "Save", exact: true }));
    const panel = page.getByRole("tabpanel");
    expect(
      await panel.evaluate((node) => node.scrollWidth <= node.clientWidth + 1),
    ).toBe(true);
    await page.getByRole("tab", { name: "Themes", exact: true }).focus();
    await page.keyboard.press(pane < 656 ? "ArrowLeft" : "ArrowUp");
    await expect(
      page.getByRole("tab", { name: "Dialogs", exact: true }),
    ).toBeFocused();
    await expect(
      page.getByRole("tab", { name: "Dialogs", exact: true }),
    ).toHaveAttribute("aria-selected", "true");
    await expect
      .poll(() => new URL(page.url()).searchParams.getAll("keep"))
      .toEqual(["one", "two"]);
    await page
      .getByRole("button", { name: "Open tall dialog", exact: true })
      .click();
    const dialog = page.getByRole("dialog");
    await reachable(
      dialog.getByRole("button", { name: "Close", exact: true }).last(),
    );
    await reachable(
      dialog
        .locator('[data-slot="dialog-footer"]')
        .getByRole("button", { name: "Close" }),
    );
    await page.keyboard.press("Enter");
    await expect(dialog).toHaveCount(0);
    await page.getByRole("button", { name: "Open tall confirmation" }).click();
    const confirmation = page.getByRole("alertdialog");
    await reachable(
      confirmation.getByRole("button", { name: "Confirm", exact: true }),
    );
    await reachable(
      confirmation.getByRole("button", { name: "Cancel", exact: true }),
    );
    await page.keyboard.press("Enter");
    await page.getByRole("button", { name: "Edit main configuration" }).click();
    await reachable(page.getByRole("button", { name: "Save configuration" }));
    await reachable(
      page
        .getByRole("dialog")
        .getByRole("button", { name: "Close", exact: true }),
    );
    await page.keyboard.press("Enter");
    await page
      .getByRole("button", { name: "Attach library files", exact: true })
      .click();
    await reachable(
      page.getByRole("button", { name: "Select all files", exact: true }),
    );
    await page
      .getByRole("button", { name: "Select all files", exact: true })
      .click();
    const attach = page.getByRole("button", {
      name: "Attach selected (1)",
      exact: true,
    });
    await reachable(attach);
    await attach.click();
    await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
      "Could not stage these files",
    );
    await reachable(
      page
        .getByRole("dialog")
        .getByRole("button", { name: "Close", exact: true }),
    );
    await page.keyboard.press("Enter");
    await page.getByRole("tab", { name: "General", exact: true }).click();
    for (const control of await page.getByRole("combobox").all())
      await reachable(control);
    await reachable(
      page.getByRole("button", { name: "Select a model...", exact: true }),
    );
    expect(
      await page
        .getByRole("tabpanel")
        .evaluate((node) => node.scrollWidth <= node.clientWidth + 1),
    ).toBe(true);
    await page.screenshot({ path: info.outputPath("settings.png") });
    expect(errors).toEqual([]);
  });
}

test("file grid and actions fit a 240px pane on a desktop viewport", async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 1440, height: 600 });
  await page.route(/\/api\/py\/files\/(?:\?.*)?$/, (route) =>
    route.fulfill({
      json: {
        files: [
          {
            id: "file",
            filename: "report.txt",
            original_name: "verylongfilename".repeat(15) + ".txt",
            kind: "document",
            size: 1234,
            projects: [],
          },
        ],
        total: 100,
        page: 1,
        page_size: 50,
      },
    }),
  );
  await page.route("**/api/py/files/report.txt/knowledge", (route) =>
    route.fulfill({ json: { status: "ready", caption: { status: "none" } } }),
  );
  await page.goto("/e2e/responsiveness?pane=240&setting=files");
  await page.getByRole("button", { name: "Icon view" }).click();
  const file = page.locator("article");
  await expect(file).toBeVisible();
  await reachable(file.getByRole("link", { name: /^Open / }));
  await reachable(
    file.getByRole("link", { name: "Download report.txt", exact: true }),
  );
  await reachable(
    file.getByRole("button", { name: "Regenerate embedding and caption" }),
  );
  expect(
    await page
      .getByRole("tabpanel")
      .evaluate((node) => node.scrollWidth <= node.clientWidth + 1),
  ).toBe(true);
  await reachable(file);
  await page.keyboard.press("Space");
  await expect(file).toHaveAttribute("aria-pressed", "true");
  await reachable(page.getByRole("button", { name: "Next", exact: true }));
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await reachable(page.getByRole("button", { name: "Previous", exact: true }));
  await page.screenshot({ path: info.outputPath("file-grid.png") });
  await page.getByRole("button", { name: "List view", exact: true }).click();
  await reachable(file.getByRole("link", { name: /^Open / }));
  expect(
    await page
      .getByRole("tabpanel")
      .evaluate((node) => node.scrollWidth <= node.clientWidth + 1),
  ).toBe(true);
});
