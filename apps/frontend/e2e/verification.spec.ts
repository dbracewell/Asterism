import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "./support/test";

const highlighted = (page: import("@playwright/test").Page, name: string) =>
  page.evaluate(
    (key) =>
      [...(CSS.highlights.get(key) ?? [])].map((range) =>
        (range as Range).toString(),
      ),
    name,
  );

test("the verification panel highlights claims while open and is accessible", async ({
  page,
}) => {
  const requests: string[] = [];
  page.on("request", (request) => {
    if (/untrusted-evidence|\/api\/py\//.test(request.url()))
      requests.push(request.url());
  });
  await page.goto("/e2e/verification");
  const trigger = page.getByRole("button", { name: /Verification/ });
  await expect(trigger).toContainText("1 contradicted · 1 supported");
  expect(await highlighted(page, "claim-supported")).toEqual([]);

  await trigger.focus();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("list", { name: "Verified claims" }),
  ).toBeVisible();
  await expect
    .poll(() => highlighted(page, "claim-supported"))
    .toEqual(["The sky is blue."]);
  expect(await highlighted(page, "claim-contradicted")).toContain(
    "Water boils at 50 C.",
  );
  // The styles are live, not dropped by the CSS pipeline.
  expect(
    await page.evaluate(() =>
      document.adoptedStyleSheets.some((sheet) =>
        [...sheet.cssRules].some((rule) =>
          rule.cssText.includes("::highlight(claim-contradicted)"),
        ),
      ),
    ),
  ).toBe(true);

  const evidence = page
    .getByRole("link", { name: "Evidence: notes.md" })
    .first();
  await evidence.focus();
  await expect(page.getByRole("tooltip")).toContainText(
    'The sky is blue <img src="/untrusted-evidence/x">.',
  );
  expect(
    (await new AxeBuilder({ page }).include("main").analyze()).violations,
  ).toEqual([]);

  await page
    .getByRole("switch", { name: "Highlight claims in the answer" })
    .click();
  await expect.poll(() => highlighted(page, "claim-supported")).toEqual([]);
  expect(requests).toEqual([]);
});

test("an exercise checks the learner's selection and highlights the revealed error", async ({
  page,
}) => {
  const bodies: unknown[] = [];
  await page.route("**/api/auth/token", (route) =>
    route.fulfill({ json: { token: "fixture-only" } }),
  );
  await page.route("**/api/py/**", (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/messages/open-exercise/exercise/attempts")) {
      bodies.push(route.request().postDataJSON());
      return route.fulfill({
        json: {
          valid: true,
          attempts: [{ selection: "50 C", result: "found", at: 1 }],
          found: true,
          revealed: false,
        },
      });
    }
    return route.fulfill({ status: 404, json: { detail: "Not found" } });
  });
  await page.goto("/e2e/verification");

  const open = page.getByRole("region", { name: "Open exercise" });
  await expect(open.getByText("Exercise", { exact: true })).toBeVisible();
  // Select "50 C" in the rendered answer, then check it.
  await open.locator("strong").evaluate((strong) => {
    const range = document.createRange();
    range.selectNodeContents(strong);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
  });
  await open.getByRole("button", { name: "Check selection" }).click();
  await expect.poll(() => bodies).toEqual([{ selection: "50 C" }]);

  const revealed = page.getByRole("region", { name: "Revealed exercise" });
  await expect(revealed).toContainText("What is true: Water boils at 100 C");
  await expect
    .poll(() =>
      page.evaluate(() =>
        [...(CSS.highlights.get("claim-contradicted") ?? [])].map((range) =>
          (range as Range).toString(),
        ),
      ),
    )
    .toContain("It boils at 50 C at sea level.");
  expect(
    (await new AxeBuilder({ page }).include("main").analyze()).violations,
  ).toEqual([]);
});
