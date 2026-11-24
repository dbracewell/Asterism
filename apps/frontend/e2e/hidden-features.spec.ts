import { randomUUID } from "node:crypto";
import { ISOLATED_BASE_URL, bearer, register } from "./support/classes";
import { expect, test } from "./support/test";

// EPIC-97 against the real stack: a fresh installation has every feature
// policy off, so a student sees none of their entry points. An admin turns
// memory, canvas and skills on, and the student's open tab shows them without
// a reload once it is visible again (EPIC-96). CI runs specs one at a time, so
// changing these installation-wide policies is safe; they are restored.
test.skip(
  process.env.ASTERISM_ISOLATED_E2E !== "true",
  "Use scripts/run-isolated-e2e.mjs for real authentication",
);

test("a student sees no entry point for a feature that is off, then sees it once it is on", async ({
  browser,
  context,
  page,
}) => {
  test.setTimeout(90_000);
  await register(context, `Hidden student ${randomUUID().slice(0, 8)}`);
  await page.clock.install();
  await page.goto("/settings?t=user&setting=general");
  const nav = page.getByRole("tablist").last();
  await expect(nav.getByRole("tab", { name: "General" })).toBeVisible();
  await expect(nav.getByRole("tab", { name: "Skills" })).toHaveCount(0);
  await expect(nav.getByRole("tab", { name: "ChatGPT" })).toHaveCount(0);
  await expect(page.getByText("Show thinking")).toBeVisible();
  await expect(page.getByRole("checkbox", { name: "Canvas" })).toHaveCount(0);

  // Sub-agents follow the tool allowlist, which other specs set up, so they are
  // checked in unit and mocked tests instead.

  await nav.getByRole("tab", { name: "Your Asterism" }).click();
  await expect(page.getByRole("region", { name: "About you" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Memory" })).toHaveCount(0);

  // Help leaves out what is off, too.
  const help = await context.newPage();
  await help.goto("/help");
  await help.getByRole("searchbox", { name: "Search help" }).fill("memory");
  await expect(
    help.getByRole("heading", { name: "Memory", exact: true }),
  ).toHaveCount(0);
  await help.close();

  const admin = await browser.newContext({ baseURL: ISOLATED_BASE_URL });
  await register(admin, `Hidden admin ${randomUUID().slice(0, 8)}`, true);
  const adminPage = await admin.newPage();
  const headers = await bearer(adminPage);
  const policy = (path: string, data: object) =>
    adminPage.request.put(`/api/py/settings/app/${path}`, { headers, data });
  const set = async (enabled: boolean) => {
    for (const response of await Promise.all([
      policy("memory", { enabled, group_ids: null }),
      policy("canvas", { enabled }),
      policy("skills", { enabled }),
    ]))
      expect(response.ok()).toBeTruthy();
  };
  await set(true);
  try {
    // The open tab catches up once its answer is 30s old and it is shown again.
    await page.clock.fastForward(31_000);
    await page.evaluate(() =>
      window.dispatchEvent(new Event("visibilitychange")),
    );
    await expect(page.getByRole("region", { name: "Memory" })).toBeVisible();
    await expect(
      page.getByRole("checkbox", { name: "Use memory" }),
    ).toBeEnabled();
    await expect(nav.getByRole("tab", { name: "Skills" })).toBeVisible();
    await nav.getByRole("tab", { name: "General" }).click();
    await expect(page.getByRole("checkbox", { name: "Canvas" })).toBeVisible();
    const helpOn = await context.newPage();
    await helpOn.goto("/help");
    await helpOn.getByRole("searchbox", { name: "Search help" }).fill("memory");
    await expect(
      helpOn.getByRole("heading", { name: "Memory", exact: true }),
    ).toBeVisible();
    await helpOn.close();
  } finally {
    await set(false);
    await admin.close();
  }
});
