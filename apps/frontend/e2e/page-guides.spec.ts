import { ISOLATED_BASE_URL, bearer, register } from "./support/classes";
import { expect, test } from "./support/test";

// US-66.1: pages that used to borrow another page's guide now open their own.
test.skip(
  process.env.ASTERISM_ISOLATED_E2E !== "true",
  "Signs in against the isolated backend",
);

test("each page opens its own guide by button and with ?", async ({
  browser,
}) => {
  const context = await browser.newContext({ baseURL: ISOLATED_BASE_URL });
  try {
    await register(context, "Guide reader");
    const page = await context.newPage();
    await page.goto("/projects");
    const created = await page.request.post("/api/py/projects/", {
      headers: await bearer(page),
      data: { name: "Guides" },
    });
    expect(created.ok()).toBeTruthy();
    const { id } = await created.json();
    const pages = [
      ["/classes", "Classes"],
      ["/team-packs", "Import team pack"],
      ["/help", "Help center"],
      [`/projects/${id}/study/quizzes/new`, "New practice quiz"],
      [`/projects/${id}/study/summaries/new`, "Summarize files"],
    ] as const;
    for (const [path, title] of pages) {
      await page.goto(path);
      await page.getByRole("button", { name: "Help for this page" }).click();
      const sheet = page.getByRole("dialog", { name: `Help: ${title}` });
      await expect(sheet).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(sheet).toBeHidden();
      await page.locator("body").press("?");
      await expect(sheet).toBeVisible();
      await page.keyboard.press("Escape");
    }
  } finally {
    await context.close();
  }
});
