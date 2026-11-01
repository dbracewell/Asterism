import { expect, test, type Page } from "./support/test";

// US-61.5: every help center link lands on the entry it names.
const fixture = "/e2e/help-center";

function anchorTarget(page: Page, anchor: string) {
  return page.locator(`[id="${anchor}"]`);
}

/** Opens every help popover and records where its help center link points. */
async function popoverLinks(page: Page) {
  const triggers = page
    .getByRole("list", { name: "Help triggers" })
    .getByRole("button");
  const links: { title: string; href: string }[] = [];
  for (const trigger of await triggers.all()) {
    await trigger.click();
    const dialog = page.getByRole("dialog");
    const title = (await dialog.getAttribute("aria-label"))!.replace(
      /^Help: /,
      "",
    );
    const href = await dialog
      .getByRole("link", { name: "Open in help center" })
      .getAttribute("href");
    links.push({ title, href: href! });
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
  }
  return links;
}

for (const audience of ["learner", "admin"] as const) {
  test(`every help link resolves to its entry for a ${audience}`, async ({
    page,
  }) => {
    const query = audience === "admin" ? "?audience=admin" : "";
    await page.goto(`${fixture}${query}`);

    const links = await popoverLinks(page);
    expect(links.length).toBeGreaterThan(20);
    const titles = links.map((link) => link.title);
    expect(titles.includes("Tool policy")).toBe(audience === "admin");

    for (const { title, href } of links) {
      const [path, anchor] = href.split("#");
      expect(path, title).toBe("/help");
      // Arrive the way a learner does: a fresh load of the URL with its hash.
      await page.goto(`${fixture}${query}#${anchor}`);
      const target = anchorTarget(page, anchor);
      await expect(target, href).toHaveCount(1);
      await expect(target).toHaveAccessibleName(title);
      await expect(target).toBeInViewport();
    }

    // Links inside the help center (related terms, page guide terms and the
    // contents) all point at an anchor on the page.
    const inPage = await page
      .getByRole("main")
      .locator('a[href^="#"]')
      .evaluateAll((nodes) =>
        nodes.map((node) => node.getAttribute("href")!.slice(1)),
      );
    expect(inPage.length).toBeGreaterThan(50);
    for (const anchor of new Set(inPage)) {
      await expect(anchorTarget(page, anchor), anchor).toHaveCount(1);
    }
    if (audience === "learner") {
      await expect(anchorTarget(page, "admin.tools")).toHaveCount(0);
      await expect(anchorTarget(page, "page-admin.tools")).toHaveCount(0);
    }
  });
}

test("a related link clears the search and focuses its entry", async ({
  page,
}) => {
  await page.goto(fixture);
  const search = page.getByRole("searchbox", { name: "Search help" });
  await search.fill("isn't a memory");
  await expect(anchorTarget(page, "concept.skill")).toHaveCount(0);

  await anchorTarget(page, "concept.persona")
    .getByRole("navigation", { name: "Related" })
    .getByRole("link", { name: "Skill" })
    .click();
  await expect(search).toHaveValue("");
  const skill = anchorTarget(page, "concept.skill");
  await expect(skill).toBeFocused();
  await expect(skill).toBeInViewport();
  await expect(page).toHaveURL(/#concept\.skill$/);
});

test("the help center fits a 320px screen", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto(fixture);
  const overflow = await page
    .getByRole("main")
    .evaluate((node) => node.scrollWidth - node.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await page.getByRole("searchbox", { name: "Search help" }).fill("zzqq");
  await expect(page.getByText("No help matches your search")).toBeVisible();
  await page.getByRole("button", { name: "Clear search" }).click();
  await expect(anchorTarget(page, "concept.persona")).toBeVisible();
});
