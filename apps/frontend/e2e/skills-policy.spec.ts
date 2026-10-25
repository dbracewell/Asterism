import { expect, test } from "./support/test";
test.use({ hasTouch: true });
test.beforeEach(async ({ page }) => {
  await page.route("**/api/py/**", (route) =>
    route.fulfill({
      status: 404,
      json: { detail: "Unmocked policy test request" },
    }),
  );
});
for (const width of [1280, 320]) {
  test(`administrator enables and disables assigned skill discovery at ${width}px`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: width === 320 ? 360 : 800 });
    let enabled = false;
    const writes: unknown[] = [];
    await page.route("**/api/py/settings/app/skills", async (route) => {
      if (route.request().method() === "PUT") {
        const body = route.request().postDataJSON();
        writes.push(body);
        enabled = body.enabled;
      }
      return route.fulfill({ json: { enabled } });
    });
    await page.route("**/api/py/skills/eligible*", (route) =>
      route.fulfill({
        json: {
          items: enabled
            ? [
                {
                  id: "00000000-0000-4000-8000-000000000001",
                  name: "review",
                  description: "Review carefully",
                  revision: 1,
                  created_at: 1,
                  updated_at: 1,
                },
              ]
            : [],
          total: enabled ? 1 : 0,
          page: 1,
          page_size: 100,
          policy_enabled: enabled,
          agent_revision: 1,
        },
      }),
    );
    await page.route("**/api/py/settings/app/providers*", (route) =>
      route.fulfill({ json: { providers: [] } }),
    );
    await page.goto("/e2e/skill-chat");
    await page.getByLabel("Message", { exact: true }).fill("/");
    await expect(
      page.getByText("Skill activation is disabled by an administrator."),
    ).toBeVisible();
    await page.goto(
      "/e2e/skills?admin=true&t=admin&setting=skills&keep=x&keep=y",
    );
    const toggle = page.getByRole("switch", {
      name: "Enable skill activation",
    });
    await expect(toggle).not.toBeChecked();
    await toggle.check();
    await page.getByRole("button", { name: "Save skill policy" }).click();
    await expect(page.getByText("Skill policy saved.")).toBeVisible();
    expect(writes).toEqual([{ enabled: true }]);
    expect(new URL(page.url()).searchParams.getAll("keep")).toEqual(["x", "y"]);
    await page.reload();
    await expect(toggle).toBeChecked();
    await page.screenshot({
      path: testInfo.outputPath(`skills-policy-${width}.png`),
      fullPage: true,
    });
    await page.goto("/e2e/skill-chat");
    await page.getByLabel("Message", { exact: true }).fill("/");
    await expect(page.getByRole("option", { name: /review/ })).toBeVisible();
    await page.goto("/e2e/skills?admin=true&t=admin&setting=skills");
    await toggle.uncheck();
    await page.getByRole("button", { name: "Save skill policy" }).click();
    await expect(page.getByText("Skill policy saved.")).toBeVisible();
    expect(writes).toEqual([{ enabled: true }, { enabled: false }]);
    await page.goto("/e2e/skill-chat");
    await page.getByLabel("Message", { exact: true }).fill("/");
    await expect(
      page.getByText("Skill activation is disabled by an administrator."),
    ).toBeVisible();
  });
}
test("ordinary users cannot open the skills policy pane", async ({ page }) => {
  let reads = 0;
  await page.route("**/api/py/settings/app/skills", (route) => {
    reads++;
    return route.fulfill({ status: 403, json: { detail: "Forbidden" } });
  });
  await page.route("**/api/py/skills/**", (route) =>
    route.fulfill({ json: { items: [], total: 0, page: 1, page_size: 10 } }),
  );
  await page.goto("/e2e/skills?t=admin&setting=skills");
  await expect(page.getByRole("tab", { name: "Admin Settings" })).toHaveCount(
    0,
  );
  await expect(
    page.getByRole("switch", { name: "Enable skill activation" }),
  ).toHaveCount(0);
  expect(reads).toBe(0);
});
