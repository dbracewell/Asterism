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
  expect(await highlighted(page, "claim-contradicted")).toEqual([
    "Water boils at 50 C.",
  ]);
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
